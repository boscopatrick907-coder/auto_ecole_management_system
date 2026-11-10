import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import app from "./worker.js";
import { type TenantBindings } from "./context.js";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function main() {
  let devVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
    devVars = dotenv.parse(content);
  } catch {
    // fallback
  }
  const envVars = { ...process.env, ...devVars };
  const rawStagingUrl = envVars.MIGRATION_DATABASE_URL;
  if (!rawStagingUrl) throw new Error("MIGRATION_DATABASE_URL is required");

  const toPooler = (urlStr: string) => {
    const u = new URL(urlStr);
    if (!u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace(/^([^.]+)\./, "$1-pooler.");
    }
    return u.toString();
  };
  const stagingOwnerPool = new pg.Pool({ connectionString: toPooler(rawStagingUrl), max: 2 });

  const bindings: TenantBindings = {
    DATABASE_URL: envVars.DATABASE_URL!,
    AUTH_DATABASE_URL: envVars.AUTH_DATABASE_URL!,
    BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: "http://localhost:8788",
    TRUSTED_ORIGINS: "http://localhost:4200",
    TURNSTILE_SECRET_KEY: "test-only",
    OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };

  const callWorker = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
  ) =>
    app.request(
      `http://localhost:8788${path}`,
      {
        method,
        headers: {
          Origin: "http://localhost:4200",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      bindings,
    );

  try {
    // Sign in as admin to get adminCookie
    const adminSignIn = await callWorker("/api/auth/sign-in/email", "POST", {
      email: "direction@lamarseillaise.cm",
      password: "Admin@Marseillaise2026!",
    });
    if (adminSignIn.status !== 200) {
      throw new Error("Admin login failed during benchmark setup");
    }
    const adminCookie = adminSignIn.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");

    // Sign in as student to get studentCookie
    const studentSignIn = await callWorker("/api/auth/sign-in/email", "POST", {
      email: "eleve.completion@lamarseillaise.cm",
      password: "StudentLegacyPass2026!",
    });
    if (studentSignIn.status !== 200) {
      throw new Error("Student login failed during benchmark setup");
    }
    const studentCookie = studentSignIn.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");

    // Fetch an open enrollment for idempotent payment load testing
    const catRes = await callWorker("/api/schools/la-marseillaise/catalogue", "GET");
    const catalogue = (await catRes.json()) as { school: { id: string }; groups: Array<{ id: string }> };
    const schoolId = catalogue.school.id;

    // Select an existing active enrollment with remaining balance for idempotent payment load testing
    const existingEnrollment = (
      await stagingOwnerPool.query(`
        SELECT e.id as enrollment_id, e.student_id, e.school_id, b.balance
        FROM school_app.enrollments e
        JOIN school_app.enrollment_balances b ON b.school_id = e.school_id AND b.enrollment_id = e.id
        WHERE e.school_id = $1 AND e.status = 'active' AND b.balance > 10000
        LIMIT 1
      `, [schoolId])
    ).rows[0];
    if (!existingEnrollment) {
      throw new Error("No active enrollment with balance found in staging for load test");
    }
    const loadEnrollmentId = existingEnrollment.enrollment_id;

    const totalRequests = 100;
    const concurrency = 5;
    let requestIndex = 0;
    const latencies: number[] = [];
    const failures: Array<{ index: number; status: number; path: string; error?: string }> = [];

    // Pre-generate unique clientIds for payment requests, plus duplicate clientIds to test concurrent idempotency
    const paymentClientIds = Array.from({ length: 20 }, () => randomUUID());

    const startedAt = Date.now();
    console.log(`Starting WAN load benchmark: ${totalRequests} requests against Neon staging (concurrency ${concurrency})...`);

    const workerLoop = async (workerId: number) => {
      while (true) {
        const i = requestIndex++;
        if (i >= totalRequests) break;

        const reqStart = Date.now();
        let res: Response;
        let path = "";

        try {
          if (i % 10 === 0) {
            // 10% concurrent payments with idempotency keys
            path = "/api/schools/la-marseillaise/admin/payments";
            const isExpectedDuplicate = i >= 50;
            const clientId = isExpectedDuplicate ? paymentClientIds[i % 10] : paymentClientIds[i % 20];
            res = await callWorker(
              path,
              "POST",
              {
                enrollmentId: loadEnrollmentId,
                amount: 100,
                method: "cash",
                clientId,
                paidAt: new Date().toISOString(),
              },
              adminCookie,
            );
            if (isExpectedDuplicate) {
              if (res.status !== 409) {
                failures.push({
                  index: i,
                  status: res.status,
                  path,
                  error: `Expected 409 for duplicate clientId, got ${res.status}`,
                });
              }
            } else {
              if (res.status !== 201) {
                failures.push({
                  index: i,
                  status: res.status,
                  path,
                  error: `Expected 201, got ${res.status}`,
                });
              }
            }
          } else if (i % 4 === 0) {
            // 25% authenticated student dossier
            path = "/api/schools/la-marseillaise/me";
            res = await callWorker(path, "GET", undefined, studentCookie);
            if (res.status !== 200) {
              failures.push({ index: i, status: res.status, path });
            }
          } else if (i % 7 === 0) {
            // 15% admin payments list
            path = "/api/schools/la-marseillaise/admin/payments?date=2026-11&offset=0";
            res = await callWorker(path, "GET", undefined, adminCookie);
            if (res.status !== 200) {
              failures.push({ index: i, status: res.status, path });
            }
          } else if (i % 9 === 0) {
            // 10% admin dashboard
            path = "/api/schools/la-marseillaise/admin/dashboard";
            res = await callWorker(path, "GET", undefined, adminCookie);
            if (res.status !== 200) {
              failures.push({ index: i, status: res.status, path });
            }
          } else {
            // 40% public school catalogue
            path = "/api/schools/la-marseillaise/catalogue";
            res = await callWorker(path, "GET");
            if (res.status !== 200) {
              failures.push({ index: i, status: res.status, path });
            }
          }
        } catch (err) {
          failures.push({
            index: i,
            status: 0,
            path,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const elapsed = Date.now() - reqStart;
        latencies.push(elapsed);

        if (latencies.length % 20 === 0 || latencies.length === totalRequests) {
          console.log(`Progress: ${latencies.length}/${totalRequests} (${Math.round((latencies.length / totalRequests) * 100)}%) - last latency: ${elapsed}ms`);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, (_, idx) => workerLoop(idx)));

    const totalDurationMs = Date.now() - startedAt;
    latencies.sort((a, b) => a - b);

    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const throughputReqSec = Math.round((totalRequests / (totalDurationMs / 1000)) * 10) / 10;

    // Verify post-load financial invariants:
    // 1. Balance must exactly equal total_fee - paid across all enrollments
    const balanceViolations = await stagingOwnerPool.query(`
      SELECT count(*)::int as n
      FROM school_app.enrollment_balances b
      JOIN school_app.groups g ON g.id = b.group_id
      WHERE b.balance <> (g.total_fee - b.paid)
    `);
    if (balanceViolations.rows[0].n !== 0) {
      throw new Error(`Financial balance invariant failed post-load: ${balanceViolations.rows[0].n} violations`);
    }

    // 2. Client ID uniqueness: each client_id must produce exactly 1 payment record
    const duplicatePayments = await stagingOwnerPool.query(`
      SELECT client_id, count(*)::int as n
      FROM school_app.payments
      WHERE school_id = $1 AND enrollment_id = $2
      GROUP BY client_id
      HAVING count(*) > 1
    `, [schoolId, loadEnrollmentId]);
    if (duplicatePayments.rowCount) {
      throw new Error(`Duplicate payments detected for client_id: ${JSON.stringify(duplicatePayments.rows)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          loadBenchmark: {
            targetDatabase: "aem_tenant_staging",
            totalRequests,
            concurrency,
            durationMs: totalDurationMs,
            throughputReqSec,
            latencyMs: {
              min,
              p50,
              p95,
              p99,
              max,
            },
            failuresCount: failures.length,
            failures,
            invariants: {
              zeroFailures: failures.length === 0,
              zeroDuplicatePayments: duplicatePayments.rowCount === 0,
              financialBalancesReconciled: balanceViolations.rows[0].n === 0,
            },
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await stagingOwnerPool.end();
  }
}

main().catch((err) => {
  console.error("Load benchmark failed:", err.message);
  process.exit(1);
});

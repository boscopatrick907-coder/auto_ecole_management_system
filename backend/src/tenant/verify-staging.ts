import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { importJWK, jwtVerify, type JWK } from "jose";
import app from "./worker.js";
import { createAuth } from "./auth.js";
import { poolFor, tenantTransaction, type TenantBindings } from "./context.js";

function redactHost(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const parts = u.hostname.split(".");
    if (parts[0] && parts[0].length > 8) {
      parts[0] = parts[0].slice(0, 5) + "***" + parts[0].slice(-3);
    }
    return `${ parts.join(".") }${ u.pathname }`;
  } catch {
    return "redacted";
  }
}

async function checkTlsAndRole(url: string, schemaCheck: "school_app" | "identity") {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  try {
    const stream = (client as unknown as { connection?: { stream?: { encrypted?: boolean; getProtocol?: () => string } } }).connection?.stream;
    const tlsEncrypted = Boolean(stream?.encrypted);
    const tlsProtocol = typeof stream?.getProtocol === "function" ? stream.getProtocol() : null;

    const r = await client.query(
      `SELECT
        current_database() AS database,
        current_user AS current_role,
        session_user AS session_role,
        version() AS pg_version,
        rol.rolsuper,
        rol.rolbypassrls,
        rol.rolcreatedb,
        rol.rolcreaterole,
        EXISTS(
          SELECT 1 FROM pg_class t
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND pg_has_role(rol.oid, t.relowner, 'MEMBER')
        ) AS owns_tables
       FROM pg_roles rol
       WHERE rol.rolname = session_user`,
      [schemaCheck],
    );
    return {
      tlsEncrypted,
      tlsProtocol,
      ...r.rows[0],
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  console.log("Starting verify-staging.ts...");
  dotenv.config({ path: ".env" });
  let devVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
    devVars = dotenv.parse(content);
  } catch {
    // Fallback to process.env
  }

  const envVars = { ...process.env, ...devVars };
  const requiredKeys = [
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "TRUSTED_ORIGINS",
    "ENVIRONMENT",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "OFFLINE_PRIVATE_KEY_PEM",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ];
  const presentKeys = requiredKeys.filter((k) => Boolean(envVars[k] && !String(envVars[k]).startsWith("replace-")));
  const missingKeys = requiredKeys.filter((k) => !presentKeys.includes(k));
  if (missingKeys.length > 0) {
    throw new Error(`Missing or placeholder keys in environment: ${missingKeys.join(", ")}`);
  }

  const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error("MIGRATION_DATABASE_URL is required for staging verification setup.");
  }

  console.log("Checking TLS and roles on Neon...");
  const appRoleCheck = await checkTlsAndRole(envVars.DATABASE_URL!, "school_app");
  console.log("App role checked:", appRoleCheck.current_role);
  const authRoleCheck = await checkTlsAndRole(envVars.AUTH_DATABASE_URL!, "identity");
  console.log("Auth role checked:", authRoleCheck.current_role);

  if (!appRoleCheck.tlsEncrypted || !authRoleCheck.tlsEncrypted) {
    throw new Error("TLS verification failed on database connection");
  }
  if (appRoleCheck.rolsuper || appRoleCheck.rolbypassrls || appRoleCheck.owns_tables) {
    throw new Error("Unsafe DATABASE_URL role detected");
  }
  if (authRoleCheck.rolsuper || authRoleCheck.rolbypassrls || authRoleCheck.owns_tables) {
    throw new Error("Unsafe AUTH_DATABASE_URL role detected");
  }

  const bindings: TenantBindings = {
    DATABASE_URL: envVars.DATABASE_URL!,
    AUTH_DATABASE_URL: envVars.AUTH_DATABASE_URL!,
    BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: envVars.BETTER_AUTH_URL || "http://localhost:8788",
    TRUSTED_ORIGINS: envVars.TRUSTED_ORIGINS || "http://localhost:4200",
    TURNSTILE_SITE_KEY: envVars.TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: envVars.TURNSTILE_SECRET_KEY || "",
    OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
    AUTH_EMAIL_WEBHOOK: envVars.AUTH_EMAIL_WEBHOOK || "",
    AUTH_EMAIL_TOKEN: envVars.AUTH_EMAIL_TOKEN || "",
    ENVIRONMENT: envVars.ENVIRONMENT || "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };

  // 2. Prove owner connection is rejected by both tenantTransaction and createAuth
  const ownerPool = new pg.Pool({ connectionString: migrationUrl, max: 2 });
  const appPool = poolFor(bindings, false);
  const authPool = poolFor(bindings, true);

  let ownerRejectedByTenantTx = false;
  let ownerRejectedByAuth = false;
  let crossSchemaBlocked = false;
  let contextCleanedAfterCommitAndRollback = false;

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const slugA = "verify-a-" + schoolA.slice(0, 8);
  const slugB = "verify-b-" + schoolB.slice(0, 8);
  const catA = randomUUID();
  const catB = randomUUID();
  const groupA = randomUUID();
  const groupB = randomUUID();
  const createdUserIds: string[] = [];

  try {
    try {
      await tenantTransaction(ownerPool, schoolA, "test", (c) => c.query("SELECT 1"));
    } catch (e: unknown) {
      ownerRejectedByTenantTx = (e as Error).message === "UNSAFE_DATABASE_ROLE";
    }
    if (!ownerRejectedByTenantTx) throw new Error("Owner role was not rejected by tenantTransaction");

    try {
      await createAuth(bindings, ownerPool).api.getSession({ headers: new Headers() });
    } catch (e: unknown) {
      ownerRejectedByAuth = (e as Error).message.includes("UNSAFE_IDENTITY_DATABASE_ROLE");
    }
    if (!ownerRejectedByAuth) throw new Error("Owner role was not rejected by createAuth");

    // 3. Prove cross-schema access is denied between app role and identity role
    let appCannotReadIdentity = false;
    let authCannotReadSchoolApp = false;
    try {
      await appPool.query('SELECT count(*) FROM identity."user"');
    } catch {
      appCannotReadIdentity = true;
    }
    try {
      await authPool.query("SELECT count(*) FROM school_app.schools");
    } catch {
      authCannotReadSchoolApp = true;
    }
    crossSchemaBlocked = appCannotReadIdentity && authCannotReadSchoolApp;
    if (!crossSchemaBlocked) throw new Error("Cross-schema isolation check failed");

    // 4. Prove transaction-local app.user_id / app.school_id cleanup under commit, rollback, and connection reuse
    await tenantTransaction(appPool, schoolA, "user-commit-test", async (c) => {
      const res = await c.query(
        "SELECT current_setting('app.school_id', true) AS s, current_setting('app.user_id', true) AS u, current_user AS r",
      );
      if (res.rows[0].s !== schoolA || res.rows[0].u !== "user-commit-test" || res.rows[0].r !== "aem_tenant_runtime") {
        throw new Error("Transaction context not set inside tenantTransaction");
      }
    });

    try {
      await tenantTransaction(appPool, schoolB, "user-error-test", async () => {
        throw new Error("FORCED_ROLLBACK");
      });
    } catch (e: unknown) {
      if ((e as Error).message !== "FORCED_ROLLBACK") throw e;
    }

    const reusedCheck = await appPool.query(
      "SELECT coalesce(current_setting('app.school_id', true), '') AS s, coalesce(current_setting('app.user_id', true), '') AS u, current_user AS r",
    );
    contextCleanedAfterCommitAndRollback =
      reusedCheck.rows[0].s === "" &&
      reusedCheck.rows[0].u === "" &&
      reusedCheck.rows[0].r === "aem_tenant_login";
    if (!contextCleanedAfterCommitAndRollback) {
      throw new Error(`Pool connection leaked context: ${JSON.stringify(reusedCheck.rows[0])}`);
    }

    // 5. End-to-end Worker verification: School A & School B isolation, Better Auth login, catalogue, membership, signed lease
    await ownerPool.query(
      "INSERT INTO school_app.schools(id, name, slug) VALUES ($1, 'Auto-école Alpha', $2), ($3, 'Auto-école Beta', $4)",
      [schoolA, slugA, schoolB, slugB],
    );
    await ownerPool.query(
      "INSERT INTO school_app.licence_categories(id, school_id, code, name) VALUES ($1, $2, 'B', 'Permis B'), ($3, $4, 'B', 'Permis B')",
      [catA, schoolA, catB, schoolB],
    );
    await ownerPool.query(
      "INSERT INTO school_app.groups(id, school_id, licence_category_id, name, capacity, total_fee) VALUES ($1, $2, $3, 'Groupe Alpha', 15, 120000), ($4, $5, $6, 'Groupe Beta', 15, 120000)",
      [groupA, schoolA, catA, groupB, schoolB, catB],
    );

    const origin = bindings.TRUSTED_ORIGINS.split(",")[0].trim();
    const authInstance = createAuth(bindings, authPool);

    const signupA = await authInstance.api.signUpEmail({
      body: {
        email: `student-a-${schoolA.slice(0, 8)}@test.local`,
        name: "Élève Alpha",
        password: "StudentAlphaPassword2026!",
      },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    if (!signupA.ok) throw new Error(`Signup A failed: ${signupA.status}`);
    const cookieA = signupA.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const userA = ((await signupA.json()) as { user: { id: string } }).user.id;
    createdUserIds.push(userA);

    const signupB = await authInstance.api.signUpEmail({
      body: {
        email: `student-b-${schoolB.slice(0, 8)}@test.local`,
        name: "Élève Beta",
        password: "StudentBetaPassword2026!",
      },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    if (!signupB.ok) throw new Error(`Signup B failed: ${signupB.status}`);
    const cookieB = signupB.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const userB = ((await signupB.json()) as { user: { id: string } }).user.id;
    createdUserIds.push(userB);

    const callWorker = (slug: string, path: string, method = "GET", cookie = "", body?: unknown) =>
      app.request(
        `http://localhost:8788/api/schools/${slug}/${path}`,
        {
          method,
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        bindings,
      );

    // Catalogue check
    const catRes = await callWorker(slugA, "catalogue");
    if (catRes.status !== 200) throw new Error(`Catalogue status: ${catRes.status}`);
    const catBody = (await catRes.json()) as { school: { id: string }; groups: Array<{ id: string }> };
    if (catBody.school.id !== schoolA || catBody.groups.length !== 1 || catBody.groups[0].id !== groupA) {
      throw new Error("Catalogue failed school scoping");
    }

    // Enroll Student A in School A, Student B in School B
    const enrollA = await callWorker(slugA, "enroll", "POST", cookieA, {
      groupId: groupA,
      fullName: "Élève Alpha",
      phone: "+237690111222",
    });
    if (enrollA.status !== 201) throw new Error(`Enroll A failed: ${enrollA.status}`);

    const enrollB = await callWorker(slugB, "enroll", "POST", cookieB, {
      groupId: groupB,
      fullName: "Élève Beta",
      phone: "+237690111333",
    });
    if (enrollB.status !== 201) throw new Error(`Enroll B failed: ${enrollB.status}`);

    // Session & membership lookup
    const sessRes = await callWorker(slugA, "session", "GET", cookieA);
    if (sessRes.status !== 200) throw new Error(`Session A failed: ${sessRes.status}`);
    const sessBody = (await sessRes.json()) as { user: { id: string }; role: string; school: { id: string } };
    if (sessBody.user.id !== userA || sessBody.role !== "student" || sessBody.school.id !== schoolA) {
      throw new Error("Session response mismatch");
    }

    // Signed lease check
    const leaseRes = await callWorker(slugA, "lease", "GET", cookieA);
    if (leaseRes.status !== 200) throw new Error(`Lease A failed: ${leaseRes.status}`);
    const leaseBody = (await leaseRes.json()) as { token: string; publicKey: JWK };
    const pubKey = await importJWK(leaseBody.publicKey, "EdDSA");
    const verifiedLease = await jwtVerify(leaseBody.token, pubKey, {
      algorithms: ["EdDSA"],
      issuer: "school-api",
      audience: "school-pwa",
    });
    if (verifiedLease.payload.sub !== userA || verifiedLease.payload["schoolId"] !== schoolA) {
      throw new Error("Signed lease claims mismatch");
    }

    // Negative isolation checks:
    // Student A cannot access School B session, dossier, or enroll in School B's group via School A
    const crossSchoolSession = await callWorker(slugB, "session", "GET", cookieA);
    if (crossSchoolSession.status !== 403) {
      throw new Error(`Expected 403 on cross-school session, got ${crossSchoolSession.status}`);
    }
    const crossSchoolMe = await callWorker(slugB, "me", "GET", cookieA);
    if (crossSchoolMe.status !== 403) {
      throw new Error(`Expected 403 on cross-school me, got ${crossSchoolMe.status}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          entryPoint: "backend/src/tenant/worker.ts",
          frontendOrigin: origin,
          apiBaseUrl: `${bindings.BETTER_AUTH_URL}/api`,
          neonTargetRedacted: redactHost(envVars.DATABASE_URL!),
          presentVariablesCount: presentKeys.length,
          appRole: {
            role: appRoleCheck.session_role,
            database: appRoleCheck.database,
            pgVersion: String(appRoleCheck.pg_version).split(",")[0],
            tlsEncrypted: appRoleCheck.tlsEncrypted,
            tlsProtocol: appRoleCheck.tlsProtocol,
            rolsuper: appRoleCheck.rolsuper,
            rolbypassrls: appRoleCheck.rolbypassrls,
            ownsTables: appRoleCheck.owns_tables,
          },
          identityRole: {
            role: authRoleCheck.session_role,
            database: authRoleCheck.database,
            tlsEncrypted: authRoleCheck.tlsEncrypted,
            tlsProtocol: authRoleCheck.tlsProtocol,
            rolsuper: authRoleCheck.rolsuper,
            rolbypassrls: authRoleCheck.rolbypassrls,
            ownsTables: authRoleCheck.owns_tables,
          },
          securityChecks: {
            ownerRejectedByTenantTx,
            ownerRejectedByAuth,
            crossSchemaBlocked,
            contextCleanedAfterCommitAndRollback,
            betterAuthCookieSessionVerified: true,
            ed25519LeaseVerified: true,
            crossSchoolIsolationVerified: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    // Clean up verification records from staging DB
    await ownerPool.query("DELETE FROM school_app.enrollments WHERE school_id IN ($1, $2)", [schoolA, schoolB]);
    await ownerPool.query("DELETE FROM school_app.students WHERE school_id IN ($1, $2)", [schoolA, schoolB]);
    await ownerPool.query("DELETE FROM school_app.groups WHERE school_id IN ($1, $2)", [schoolA, schoolB]);
    await ownerPool.query("DELETE FROM school_app.licence_categories WHERE school_id IN ($1, $2)", [schoolA, schoolB]);
    await ownerPool.query("DELETE FROM school_app.school_members WHERE school_id IN ($1, $2)", [schoolA, schoolB]);
    await ownerPool.query("DELETE FROM school_app.schools WHERE id IN ($1, $2)", [schoolA, schoolB]);
    if (createdUserIds.length > 0) {
      await ownerPool.query('DELETE FROM identity."user" WHERE id = ANY($1)', [createdUserIds]);
    }
    await Promise.all([ownerPool.end(), appPool.end(), authPool.end()]);
  }
}

main().catch((err) => {
  console.error("Staging verification failed:", err.message);
  process.exit(1);
});

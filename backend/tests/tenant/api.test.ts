import { beforeAll, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, requestPoolFor, closeRequestPools, type TenantBindings } from "../../src/tenant/context.js";
const url =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Disposable local database required");
const owner = new pg.Pool({ connectionString: url });
const school = randomUUID(),
  other = randomUUID(),
  cat = randomUUID(),
  group = randomUUID();
const slug = "api-" + school;
let cookie = "",
  userId = "";
let authPool: pg.Pool;
const env: TenantBindings = {
  DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_tenant_login:api_local_only@"),
  AUTH_DATABASE_URL: url.replace(
    /\/\/[^@]*@/,
    "//api_identity_login:identity_local_only@",
  ),
  BETTER_AUTH_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  TRUSTED_ORIGINS: "http://localhost:4200",
  TURNSTILE_SECRET_KEY: "test-only",
  OFFLINE_PRIVATE_KEY_PEM: generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  ENVIRONMENT: "development",
  SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_BUCKET_NAME: "",
};
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookieValue = cookie,
) =>
  app.request(
    "http://localhost:8788/api/schools/" + slug + "/" + path,
    {
      method,
      headers: {
        Origin: "http://localhost:4200",
        Cookie: cookieValue,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
beforeAll(async () => {
  await owner.query(
    await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    ),
  );
  await owner.query(
    "do $$begin create role api_tenant_login login password 'api_local_only';exception when duplicate_object then null;end $$;grant aem_tenant_runtime to api_tenant_login;do $$begin create role api_identity_login login password 'identity_local_only';exception when duplicate_object then null;end $$;grant aem_identity_runtime to api_identity_login;",
  );
  await owner.query(
    "insert into school_app.schools(id,name,slug) values($1,'Test school',$2),($3,'Other school',$4)",
    [school, slug, other, "other-" + other],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')",
    [cat, school],
  );
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'Groupe',20,100000)",
    [group, school, cat],
  );
  authPool = poolFor(env, true);
  const response = await createAuth(env, authPool).api.signUpEmail({
    body: {
      email: school + "@test.local",
      name: "API Admin",
      password: "TestPassword123!",
    },
    headers: new Headers({ Origin: "http://localhost:4200" }),
    asResponse: true,
  });
  if (!response.ok)
    throw new Error(
      "Better Auth signup failed: " +
        response.status +
        " " +
        (await response.text()),
    );
  cookie = response.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const data = (await response.json()) as { user: { id: string } };
  userId = data.user.id;
  await owner.query(
    "insert into school_app.school_members values($1,$2,'admin')",
    [school, userId],
  );
}, 60000);
afterAll(async () => {
  await authPool?.end();
  await owner.end();
});
it("public catalogue contains only the selected school", async () => {
  const r = await request("catalogue", "GET", undefined, "");
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.school.id).toBe(school);
  expect(b.groups).toHaveLength(1);
});
it("loads a public catalogue in at most six database round trips", async () => {
  const queries = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await request("catalogue", "GET", undefined, "");
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.school.id).toBe(school);
    expect(data.school).not.toHaveProperty("request_role");
    expect(data.categories[0].id).toBe(cat);
    expect(data.groups[0].installments).toEqual([]);
    expect(queries.mock.calls.length).toBeLessThanOrEqual(6);
  } finally { queries.mockRestore(); }
});
it("creates ordered installments in one bulk insert and returns matching catalogue/groups data", async () => {
  const installments = [
    { label: "One", amount: 20000, dueDate: "2027-01-01" },
    { label: "Two", amount: 30000, dueDate: "2027-02-01" },
    { label: "Three", amount: 50000, dueDate: "2027-03-01" },
  ];
  const r = await request("admin/groups", "POST", {
    name: "Bulk installments", licenceCategoryId: cat, startDate: "2027-01-01",
    scheduleText: "Morning", capacity: 15, totalFee: 100000, installments,
  });
  expect(r.status).toBe(201);
  const created = (await r.json()).group;
  expect(created.installments.map((x: { position: number }) => x.position)).toEqual([1, 2, 3]);
  expect(created.installments.map((x: { amount: string }) => Number(x.amount))).toEqual([20000, 30000, 50000]);
  const groups = (await (await request("admin/groups")).json()).groups;
  expect(groups.find((x: { id: string }) => x.id === created.id).installments).toEqual(created.installments);
  const dashboard = await request("admin/dashboard");
  expect(dashboard.status).toBe(200);
  expect((await dashboard.json()).recentPayments).toBeInstanceOf(Array);
});
it("authenticates a real Better Auth cookie and membership", async () => {
  const r = await request("session");
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.user.id).toBe(userId);
  expect(b.role).toBe("admin");
});
it("reuses Node connections without leaking identity, role or school between requests", async () => {
  const nodeEnv = { ...env, NODE_DATABASE_POOLS: true };
  const call = (path: string, sessionCookie = cookie) => app.request(
    "http://localhost:8788/api/" + path,
    { headers: { Cookie: sessionCookie } }, nodeEnv,
  );
  try {
    const warm = await call("schools/" + slug + "/session");
    expect(warm.status).toBe(200);
    const checks = await Promise.all([
      call("schools/" + slug + "/session"),
      call("schools/" + slug + "/admin/students", ""),
      call("schools/other-" + other + "/session"),
      call("auth/get-session"),
    ]);
    expect(checks.map((r) => r.status)).toEqual([200, 401, 403, 200]);
    expect((await checks[0].json()).user.id).toBe(userId);
    expect((await checks[3].json()).user.id).toBe(userId);
    const reset = await requestPoolFor(nodeEnv).query(
      "select current_user as role,current_setting('app.school_id',true) as school,current_setting('app.user_id',true) as actor",
    );
    expect(reset.rows[0].role).toBe("api_tenant_login");
    expect(reset.rows[0].school || "").toBe("");
    expect(reset.rows[0].actor || "").toBe("");
  } finally { await closeRequestPools(nodeEnv); }
});
it("requires authentication for school data", async () => {
  expect((await request("admin/students", "GET", undefined, "")).status).toBe(
    401,
  );
});
it("enforces CSRF origin on mutations", async () => {
  const r = await app.request(
    "http://localhost:8788/api/schools/" + slug + "/admin/groups",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
    env,
  );
  expect(r.status).toBe(403);
});
it("refuses signup without Turnstile", async () => {
  const r = await app.request(
    "http://localhost:8788/api/auth/sign-up/email",
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:4200",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
    env,
  );
  expect(r.status).toBe(403);
});
it("creates a hashed walk-in invitation, handles idempotent and offline RC-device-sequence payments, and returns explicit 409 conflicts", async () => {
  const r = await request("admin/students", "POST", {
    fullName: "Walk-in Student",
    phone: "+237699000099",
    groupId: group,
  });
  expect(r.status).toBe(201);
  const d = await r.json();
  expect(d.inviteCode).toMatch(/^[0-9A-F]{24}$/);
  const hash = (
    await owner.query(
      "select code_hash from school_app.invites where school_id=$1 and student_id=$2",
      [school, d.student.id],
    )
  ).rows[0].code_hash;
  expect(hash).not.toBe(d.inviteCode);

  // Duplicate phone registration returns 409 PHONE_ALREADY_REGISTERED instead of 500
  const dupPhone = await request("admin/students", "POST", {
    fullName: "Duplicate Phone",
    phone: "+237699000099",
    groupId: group,
  });
  expect(dupPhone.status).toBe(409);
  expect((await dupPhone.json()).error).toBe("PHONE_ALREADY_REGISTERED");

  const body = {
    enrollmentId: d.enrollment.id,
    amount: 50000,
    method: "cash",
    clientId: randomUUID(),
    paidAt: new Date().toISOString(),
  };
  const first = await request("admin/payments", "POST", body);
  expect(first.status).toBe(201);
  const p = await first.json();
  expect(p.payment.balance_at_issuance).toBe("50000");
  expect(p.payment.current_balance).toBe("50000");
  expect(p.payment.receipt_status).toBe("confirmed");
  expect(
    (await (await request("admin/payments", "POST", body)).json()).payment.id,
  ).toBe(p.payment.id);
  expect(
    (await request("admin/payments", "POST", { ...body, amount: 40000 }))
      .status,
  ).toBe(409);

  // Reject custom receipt numbers that mimic server year numbering (e.g. RC-2026-000002)
  const fakeYearReceipt = await request("admin/payments", "POST", {
    enrollmentId: d.enrollment.id,
    amount: 10000,
    method: "cash",
    clientId: randomUUID(),
    paidAt: new Date().toISOString(),
    receiptNumber: "RC-2026-000002",
  });
  expect(fakeYearReceipt.status).toBe(400);
  expect((await fakeYearReceipt.json()).error).toBe("INVALID_RECEIPT_NUMBER");

  // Accept valid offline RC-device-sequence receipt without advancing server year counter
  const offlineBody = {
    enrollmentId: d.enrollment.id,
    amount: 10000,
    method: "cash",
    clientId: randomUUID(),
    paidAt: new Date().toISOString(),
    receiptNumber: "RC-DEV9A8B7C6D5-000001",
  };
  const offlineRes = await request("admin/payments", "POST", offlineBody);
  expect(offlineRes.status).toBe(201);
  const offlinePayment = (await offlineRes.json()).payment;
  expect(offlinePayment.receipt_number).toBe("RC-DEV9A8B7C6D5-000001");
  expect(offlinePayment.is_offline_provisional_number).toBe(true);
  expect(offlinePayment.balance_at_issuance).toBe("40000");

  // Colliding receiptNumber from a different clientId returns 409 RECEIPT_NUMBER_CONFLICT
  const receiptConflict = await request("admin/payments", "POST", {
    ...offlineBody,
    clientId: randomUUID(),
  });
  expect(receiptConflict.status).toBe(409);
  expect((await receiptConflict.json()).error).toBe("RECEIPT_NUMBER_CONFLICT");
});
it("does not authorize the same identity in another school", async () => {
  const r = await app.request(
    "http://localhost:8788/api/schools/other-" + other + "/admin/dashboard",
    { headers: { Cookie: cookie, Origin: "http://localhost:4200" } },
    env,
  );
  expect(r.status).toBe(403);
});
it("issues a school-bound public-key signed lease", async () => {
  const r = await request("lease");
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.token.split(".")).toHaveLength(3);
  expect(b.publicKey.d).toBeUndefined();
});
it("handles 1000 mixed API requests at bounded concurrency without duplicate payments", async () => {
  const d = await (
    await request("admin/students", "POST", {
      fullName: "Load Student",
      phone: "+237699000098",
      groupId: group,
    })
  ).json();
  const body = {
    enrollmentId: d.enrollment.id,
    amount: 100,
    method: "cash",
    clientId: randomUUID(),
    paidAt: new Date().toISOString(),
  };
  let cursor = 0;
  const failures: Array<{ index: number; status: number }> = [];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= 1000) return;
        const r =
          i % 5 === 0
            ? await request("admin/payments", "POST", body)
            : i % 2 === 0
              ? await request("catalogue")
              : await app.request("http://localhost:8788/api/health", {}, env);
        if (r.status !== (i % 5 === 0 ? 201 : 200))
          failures.push({ index: i, status: r.status });
      }
    }),
  );
  expect(failures).toEqual([]);
  expect(
    (
      await owner.query(
        "select count(*)::int as n from school_app.payments where school_id=$1 and client_id=$2",
        [school, body.clientId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect((await request("session")).status).toBe(200);
  console.log(
    JSON.stringify({
      tenantLoad: {
        requests: 1000,
        concurrency: 20,
        failures: failures.length,
        elapsedMs: Date.now() - started,
        idempotencyPreserved: true,
      },
    }),
  );
}, 120000);

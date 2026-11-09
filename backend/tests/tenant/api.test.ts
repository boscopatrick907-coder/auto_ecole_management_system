import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";
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
it("authenticates a real Better Auth cookie and membership", async () => {
  const r = await request("session");
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.user.id).toBe(userId);
  expect(b.role).toBe("admin");
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
it("creates a hashed walk-in invitation and idempotent payment", async () => {
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
  expect(
    (await (await request("admin/payments", "POST", body)).json()).payment.id,
  ).toBe(p.payment.id);
  expect(
    (await request("admin/payments", "POST", { ...body, amount: 40000 }))
      .status,
  ).toBe(400);
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

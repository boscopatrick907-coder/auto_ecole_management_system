import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";
import { resetSchoolData } from "../../src/tenant/reset-test-data.js";

// Test-data cleanup before a school goes live: removes students/payments/results, keeps settings and admins.
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
const slug = "reset-" + school.slice(0, 8);
const otherSlug = "reset-o-" + other.slice(0, 8);
let adminCookie = "";
let adminId = "";
let authPool: pg.Pool;
const env: TenantBindings = {
  DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_tenant_login:api_local_only@"),
  AUTH_DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_identity_login:identity_local_only@"),
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
const call = (path: string, method = "GET", body?: unknown, cookie = "", schoolSlug = slug) =>
  app.request(
    `http://localhost:8788/api/schools/${schoolSlug}/${path}`,
    {
      method,
      headers: {
        Origin: "http://localhost:4200",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
const cookieOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
let phoneSeq = 10000000;
const newPhone = () => "+2376" + String(phoneSeq++).padStart(8, "0");

async function deskCreatesStudent(phone: string) {
  const r = await call(
    "admin/students",
    "POST",
    { fullName: "Élève " + phone.slice(-4), phone, groupId: group },
    adminCookie,
  );
  expect(r.status).toBe(201);
  const b = await r.json();
  return { id: b.student.id as string, code: b.inviteCode as string };
}

beforeAll(async () => {
  await owner.query(
    await fs.readFile(new URL("../../migrations/001_multitenant.sql", import.meta.url), "utf8"),
  );
  await owner.query(
    "do $$begin create role api_tenant_login login password 'api_local_only';exception when duplicate_object then null;end $$;grant aem_tenant_runtime to api_tenant_login;do $$begin create role api_identity_login login password 'identity_local_only';exception when duplicate_object then null;end $$;grant aem_identity_runtime to api_identity_login;",
  );
  await owner.query(
    "insert into school_app.schools(id,name,slug) values($1,'Phone school',$2),($3,'Other phone school',$4)",
    [school, slug, other, otherSlug],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')",
    [cat, school],
  );
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'Groupe',50,100000)",
    [group, school, cat],
  );
  authPool = poolFor(env, true);
  const response = (await createAuth(env, authPool).api.signUpEmail({
    body: { email: school + "@test.local", name: "Desk", password: "TestPassword123!" },
    headers: new Headers({ Origin: "http://localhost:4200" }),
    asResponse: true,
  })) as Response;
  adminCookie = cookieOf(response);
  const admin = ((await response.json()) as { user: { id: string } }).user.id;
  adminId = admin;
  await owner.query("insert into school_app.school_members values($1,$2,'admin')", [school, admin]);
}, 60000);
afterAll(async () => {
  await authPool?.end();
  await owner.end();
});


let otherAdminCookie = "";
beforeAll(async () => {
  // A second school with its own student must be untouched.
  const ocat = randomUUID(), ogroup = randomUUID();
  await owner.query("insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')", [ocat, other]);
  await owner.query("insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'G',50,100000)", [ogroup, other, ocat]);
  const r = (await createAuth(env, authPool).api.signUpEmail({
    body: { email: other + "@test.local", name: "Other desk", password: "TestPassword123!" },
    headers: new Headers({ Origin: "http://localhost:4200" }),
    asResponse: true,
  })) as Response;
  otherAdminCookie = cookieOf(r);
  await owner.query("insert into school_app.school_members values($1,$2,'admin')", [other, ((await r.json()) as { user: { id: string } }).user.id]);
  const created = await call("admin/students", "POST", { fullName: "Autre élève", phone: newPhone(), groupId: ogroup }, otherAdminCookie, otherSlug);
  expect(created.status).toBe(201);
}, 60000);

it("dry run changes nothing; the confirmed reset removes test data and keeps the school ready", async () => {
  // Test data: an activated student with a payment and a quiz-free history.
  const phone = newPhone();
  const s = await deskCreatesStudent(phone);
  const act = await call("auth/activate", "POST", { phone, code: s.code, password: "motdepasse" });
  expect(act.status).toBe(201);
  const dossier = await (await call(`admin/students/${s.id}`, "GET", undefined, adminCookie)).json();
  const pay = await call("admin/payments", "POST", {
    enrollmentId: dossier.enrollment.id, amount: 50000, method: "cash", clientId: randomUUID(), paidAt: new Date().toISOString(),
  }, adminCookie);
  expect(pay.status).toBe(201);

  const client = await owner.connect();
  try {
    const dry = await resetSchoolData(client, slug, { execute: false });
    expect(dry.executed).toBe(false);
    expect(dry.counts).toMatchObject({ students: 1, payments: 1, groups: 1 });
    expect((await owner.query("select count(*)::int n from school_app.payments where school_id=$1", [school])).rows[0].n).toBe(1);

    const done = await resetSchoolData(client, slug, { execute: true });
    expect(done.executed).toBe(true);
    expect(done.counts).toMatchObject({ students: 1, payments: 1, student_accounts: 1 });
  } finally {
    client.release();
  }
  const n = async (t: string, id = school) => (await owner.query(`select count(*)::int n from school_app.${t} where school_id=$1`, [id])).rows[0].n;
  for (const t of ["students", "payments", "enrollments", "invites", "groups", "installments", "receipt_counters"]) expect(await n(t)).toBe(0);
  // Kept: school, admin, licence category; student login gone; payment guard back on.
  expect((await owner.query("select count(*)::int n from school_app.school_members where school_id=$1 and role='admin'", [school])).rows[0].n).toBe(1);
  expect(await n("licence_categories")).toBe(1);
  expect((await call("auth/phone-sign-in", "POST", { phone, password: "motdepasse" })).status).not.toBe(200);
  expect((await owner.query("select tgenabled from pg_trigger where tgname='payment_guard'")).rows[0].tgenabled).toBe("O");
  const audit = await owner.query("select details from school_app.audit_log where school_id=$1 and action='RESET_TEST_DATA'", [school]);
  expect(audit.rows[0].details).toMatchObject({ students: 1, payments: 1 });
  // The other school is untouched.
  expect(await n("students", other)).toBe(1);
  // The desk keeps working: a new real student gets a fresh code.
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'Groupe réel',50,100000)",
    [group, school, cat],
  );
  await deskCreatesStudent(newPhone());
});

it("refuses an unknown school", async () => {
  const client = await owner.connect();
  try {
    await expect(resetSchoolData(client, "no-such-school", { execute: true })).rejects.toThrow("not found");
  } finally {
    client.release();
  }
});

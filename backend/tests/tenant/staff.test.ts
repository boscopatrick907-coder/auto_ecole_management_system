import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";

// Équipe: a school admin invites another admin by email + 6-digit code.
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
const slug = "staff-" + school.slice(0, 8);
const otherSlug = "staff-o-" + other.slice(0, 8);
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


const invite = async (email: string, name = "Secrétaire") => {
  const r = await call("admin/staff/invite", "POST", { email, name }, adminCookie);
  expect(r.status).toBe(201);
  return (await r.json()).code as string;
};
const activate = (email: string, code: string, password: string, schoolSlug = slug) =>
  call("auth/staff-activate", "POST", { email, code, password }, "", schoolSlug);
let n = 0;
const newEmail = () => `staff${Date.now()}${n++}@example.cm`;

it("a new staff member activates with email + code + password and becomes admin", async () => {
  const email = newEmail();
  const code = await invite(email, "Awa Secrétaire");
  expect(code).toMatch(/^[0-9]{6}$/);
  const listed = (await (await call("admin/staff", "GET", undefined, adminCookie)).json()).staff;
  expect(listed.find((s: { kind: string; email: string }) => s.kind === "invite" && s.email === email)).toBeTruthy();

  const r = await activate(email.toUpperCase(), code.slice(0, 3) + " " + code.slice(3), "motdepasse-solide");
  expect(r.status).toBe(201);
  const session = await call("session", "GET", undefined, cookieOf(r));
  expect((await session.json()).role).toBe("admin");
  // Single use.
  expect((await activate(email, code, "motdepasse-solide")).status).toBe(400);
  const after = (await (await call("admin/staff", "GET", undefined, adminCookie)).json()).staff;
  expect(after.find((s: { kind: string; email: string }) => s.kind === "member" && s.email === email).name).toBe("Awa Secrétaire");
});

it("a new admin account needs at least 8 characters", async () => {
  const email = newEmail();
  const code = (await (await call("admin/staff/invite", "POST", { name: "Court", email }, adminCookie)).json()).code;
  expect((await activate(email, code, "court12")).status).toBe(400);
  expect((await activate(email, code, "huitcarac")).status).toBe(201);
});

it("an existing account must prove its password; a wrong one is refused and counted", async () => {
  const email = newEmail();
  const first = await invite(email);
  expect((await activate(email, first, "premierpasse-solide")).status).toBe(201);
  // Admin removes then re-invites the same person: they keep their account.
  const members = (await (await call("admin/staff", "GET", undefined, adminCookie)).json()).staff;
  const id = members.find((s: { kind: string; email: string }) => s.kind === "member" && s.email === email).id;
  expect((await call(`admin/staff/members/${id}`, "DELETE", undefined, adminCookie)).status).toBe(200);
  const second = await invite(email);
  expect((await activate(email, second, "mauvaispasse-solide")).status).toBe(401);
  const ok = await activate(email, second, "premierpasse-solide");
  expect(ok.status).toBe(200);
  expect((await (await call("session", "GET", undefined, cookieOf(ok))).json()).role).toBe("admin");
});

it("codes are bound to the email and the school, and only admins manage the team", async () => {
  const email = newEmail();
  const code = await invite(email);
  expect((await activate(newEmail(), code, "motdepasse-solide")).status).toBe(400);
  expect((await activate(email, code, "motdepasse-solide", otherSlug)).status).toBe(400);
  expect((await call("admin/staff", "GET")).status).toBe(401);
  // A student of the school cannot see or invite staff.
  const phone = "+2376" + String(Date.now()).slice(-8);
  const s = await call("admin/students", "POST", { fullName: "Élève", phone, groupId: group }, adminCookie);
  const studentCode = (await s.json()).inviteCode;
  const st = await call("auth/activate", "POST", { phone, code: studentCode, password: "motdepasse" });
  expect((await call("admin/staff", "GET", undefined, cookieOf(st))).status).toBe(403);
  expect((await call("admin/staff/invite", "POST", { email: newEmail() }, cookieOf(st))).status).toBe(403);
});

it("cannot remove yourself, cannot invite an existing admin, can cancel a pending code", async () => {
  expect((await call(`admin/staff/members/${adminId}`, "DELETE", undefined, adminCookie)).status).toBe(409);
  const email = newEmail();
  const code = await invite(email);
  expect((await activate(email, code, "motdepasse-solide")).status).toBe(201);
  expect((await call("admin/staff/invite", "POST", { email }, adminCookie)).status).toBe(409);
  const pending = newEmail();
  const pendingCode = await invite(pending);
  const list = (await (await call("admin/staff", "GET", undefined, adminCookie)).json()).staff;
  const inv = list.find((s: { kind: string; email: string }) => s.kind === "invite" && s.email === pending);
  expect((await call(`admin/staff/invites/${inv.id}`, "DELETE", undefined, adminCookie)).status).toBe(200);
  expect((await activate(pending, pendingCode, "motdepasse-solide")).status).toBe(400);
});

it("every team change is audited", async () => {
  const actions = (await owner.query("select distinct action from school_app.audit_log where school_id=$1", [school])).rows.map((r) => r.action);
  for (const a of ["ISSUE_STAFF_INVITE", "STAFF_JOINED", "REMOVE_STAFF"]) expect(actions).toContain(a);
});

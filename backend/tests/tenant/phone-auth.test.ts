import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";

// Front-desk accounts: desk creates the student and a short code; the student
// activates with phone + code + password, then signs in with phone + password.
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
const slug = "phone-" + school.slice(0, 8);
const otherSlug = "phone-o-" + other.slice(0, 8);
let adminCookie = "";
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
  await owner.query("insert into school_app.school_members values($1,$2,'admin')", [school, admin]);
}, 60000);
afterAll(async () => {
  await authPool?.end();
  await owner.end();
});

it("desk codes are 8 readable characters", async () => {
  const { code } = await deskCreatesStudent(newPhone());
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
});

it("activates with phone + code + password, then signs in with phone + password", async () => {
  const phone = newPhone();
  const { code } = await deskCreatesStudent(phone);
  // Dash and lower case are accepted as typed from a slip.
  const typed = (code.slice(0, 4) + "-" + code.slice(4)).toLowerCase();
  const activate = await call("auth/activate", "POST", { phone, code: typed, password: "motdepasse" });
  expect(activate.status).toBe(201);
  const session = await call("session", "GET", undefined, cookieOf(activate));
  expect(session.status).toBe(200);
  expect((await session.json()).role).toBe("student");

  const signIn = await call("auth/phone-sign-in", "POST", { phone, password: "motdepasse" });
  expect(signIn.status).toBe(200);
  const again = await call("session", "GET", undefined, cookieOf(signIn));
  expect((await again.json()).role).toBe("student");

  // The code is single-use.
  const reuse = await call("auth/activate", "POST", { phone, code, password: "autrepasse" });
  expect(reuse.status).toBe(400);
});

it("rejects a wrong password, an unknown phone, short passwords and another school's code", async () => {
  const phone = newPhone();
  const { code } = await deskCreatesStudent(phone);
  expect((await call("auth/activate", "POST", { phone, code, password: "court" })).status).toBe(400);
  expect((await call("auth/activate", "POST", { phone: newPhone(), code, password: "motdepasse" })).status).toBe(400);
  expect(
    (await call("auth/activate", "POST", { phone, code, password: "motdepasse" }, "", otherSlug)).status,
  ).toBe(400);
  expect((await call("auth/activate", "POST", { phone, code, password: "motdepasse" })).status).toBe(201);
  const wrong = await call("auth/phone-sign-in", "POST", { phone, password: "mauvais-passe" });
  expect(wrong.status).toBe(401);
  expect(wrong.headers.getSetCookie()).toEqual([]);
  expect((await call("auth/phone-sign-in", "POST", { phone: newPhone(), password: "motdepasse" })).status).toBe(401);
  // Same phone at another school is a different account space.
  expect((await call("auth/phone-sign-in", "POST", { phone, password: "motdepasse" }, "", otherSlug)).status).toBe(401);
});

it("locks a phone for 15 minutes after five failures, even with the right password", async () => {
  const phone = newPhone();
  const { code } = await deskCreatesStudent(phone);
  expect((await call("auth/activate", "POST", { phone, code, password: "motdepasse" })).status).toBe(201);
  for (let i = 0; i < 5; i++)
    expect((await call("auth/phone-sign-in", "POST", { phone, password: "faux-" + i })).status).toBe(401);
  const locked = await call("auth/phone-sign-in", "POST", { phone, password: "motdepasse" });
  expect(locked.status).toBe(429);
  expect((await locked.json()).error).toBe("LOGIN_LOCKED");
  await owner.query(
    "update school_app.phone_login_attempts set locked_until=now()-interval '1 second' where school_id=$1 and phone=$2",
    [school, phone],
  );
  expect((await call("auth/phone-sign-in", "POST", { phone, password: "motdepasse" })).status).toBe(200);
});

it("desk reset code sets a new password, ends old sessions and is audited", async () => {
  const phone = newPhone();
  const { id, code } = await deskCreatesStudent(phone);
  const activate = await call("auth/activate", "POST", { phone, code, password: "ancienpasse" });
  const oldCookie = cookieOf(activate);
  expect((await call("session", "GET", undefined, oldCookie)).status).toBe(200);

  // Only admins can issue reset codes, and only for activated students.
  expect((await call(`admin/students/${id}/reset-code`, "POST", {}, oldCookie)).status).toBe(403);
  const reset = await call(`admin/students/${id}/reset-code`, "POST", {}, adminCookie);
  expect(reset.status).toBe(200);
  const { resetCode } = await reset.json();
  expect(resetCode).toMatch(/^[A-Z2-9]{8}$/);
  const fresh = await deskCreatesStudent(newPhone());
  expect((await call(`admin/students/${fresh.id}/reset-code`, "POST", {}, adminCookie)).status).toBe(409);

  const used = await call("auth/activate", "POST", { phone, code: resetCode, password: "nouveaupasse" });
  expect(used.status).toBe(200);
  expect((await call("session", "GET", undefined, oldCookie)).status).toBe(401);
  expect((await call("auth/phone-sign-in", "POST", { phone, password: "ancienpasse" })).status).toBe(401);
  expect((await call("auth/phone-sign-in", "POST", { phone, password: "nouveaupasse" })).status).toBe(200);
  const audit = await owner.query(
    "select action from school_app.audit_log where school_id=$1 and row_id=$2 order by id",
    [school, id],
  );
  expect(audit.rows.map((r) => r.action)).toEqual(["ISSUE_PASSWORD_RESET", "PASSWORD_RESET_BY_CODE"]);
});

it("a student already linked to an account cannot be activated again and no identity is created", async () => {
  const phone = newPhone();
  const { code } = await deskCreatesStudent(phone);
  const before = Number((await owner.query('select count(*) from identity."user"')).rows[0].count);
  // The student row was linked by another request before this code was used.
  await owner.query("update school_app.students set user_id=(select id from identity.\"user\" limit 1) where school_id=$1 and phone=$2", [school, phone]).catch(() => undefined);
  const r = await call("auth/activate", "POST", { phone, code, password: "motdepasse" });
  expect(r.status).toBeGreaterThanOrEqual(400);
  const after = Number((await owner.query('select count(*) from identity."user"')).rows[0].count);
  expect(after).toBe(before);
});

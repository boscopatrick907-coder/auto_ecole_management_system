import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";

// Editing a group (with safety rules) and per-group statistics.
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
const slug = "grp-" + school.slice(0, 8);
const otherSlug = "grp-o-" + other.slice(0, 8);
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


const a = { id: "", enrollment: "", cookie: "" }, b = { id: "", enrollment: "" };
beforeAll(async () => {
  await owner.query(
    "insert into school_app.installments(school_id,group_id,position,label,amount,due_date) values($1,$2,1,'T1',60000,current_date - 5),($1,$2,2,'T2',40000,current_date + 20)",
    [school, group],
  );
  await owner.query("update school_app.groups set total_fee=100000 where id=$1", [group]);
  const pa = newPhone();
  const sa = await deskCreatesStudent(pa);
  a.id = sa.id;
  const act = await call("auth/activate", "POST", { phone: pa, code: sa.code, password: "motdepasse" });
  a.cookie = cookieOf(act);
  a.enrollment = (await (await call(`admin/students/${sa.id}`, "GET", undefined, adminCookie)).json()).enrollment.id;
  const sb = await deskCreatesStudent(newPhone());
  b.id = sb.id;
  b.enrollment = (await (await call(`admin/students/${sb.id}`, "GET", undefined, adminCookie)).json()).enrollment.id;
  // A paid 70 000 (T1 done, T2 partial); B paid nothing (T1 overdue).
  const pay = await call("admin/payments", "POST", { enrollmentId: a.enrollment, amount: 70000, method: "cash", clientId: randomUUID(), paidAt: new Date().toISOString() }, adminCookie);
  expect(pay.status).toBe(201);
}, 60000);

it("statistics: occupancy, money, overdue, tranches and students", async () => {
  expect((await call(`admin/groups/${group}/stats`, "GET", undefined, a.cookie)).status).toBe(403);
  const r = await call(`admin/groups/${group}/stats`, "GET", undefined, adminCookie);
  expect(r.status).toBe(200);
  const s = await r.json();
  expect(s.summary).toMatchObject({
    enrolled: 2, capacity: 50, activated: 1, paying: 1, fully_paid: 0, late: 1,
    expected: 200000, collected: 70000, outstanding: 130000, overdue_amount: 60000, collected_last_30_days: 70000,
  });
  expect(s.tranches.map((t: { label: string; paid: number; partial: number; overdue: number }) => [t.label, t.paid, t.partial, t.overdue]))
    .toEqual([["T1", 1, 0, 1], ["T2", 0, 1, 0]]);
  const byId = Object.fromEntries(s.students.map((x: { id: string }) => [x.id, x]));
  expect(byId[a.id]).toMatchObject({ paid: 70000, balance: 30000, overdue_count: 0, activated: true });
  expect(byId[b.id]).toMatchObject({ paid: 0, balance: 100000, overdue_count: 1, overdue_amount: 60000, activated: false });
  expect((await call(`admin/groups/${randomUUID()}/stats`, "GET", undefined, adminCookie)).status).toBe(404);
});

it("editing a group: details, capacity and price rules, tranches replaced, audited", async () => {
  const patch = (body: unknown) => call(`admin/groups/${group}`, "PATCH", body, adminCookie);
  const ok = await patch({ name: "Groupe du soir", scheduleText: "Lun-Mer 18h", startDate: "2026-12-01", capacity: 25 });
  expect(ok.status).toBe(200);
  expect((await ok.json()).group).toMatchObject({ name: "Groupe du soir", schedule_text: "Lun-Mer 18h", capacity: 25 });
  // Capacity below the 2 enrolled students: refused.
  expect((await patch({ capacity: 1 })).status).toBe(409);
  // Licence can't change once students are enrolled.
  const otherCat = randomUUID();
  await owner.query("insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'A','Permis A')", [otherCat, school]);
  expect((await patch({ licenceCategoryId: otherCat })).status).toBe(409);
  // Price and tranches: must add up, can't go below what A paid (70 000), must come together.
  expect((await patch({ totalFee: 120000 })).status).toBe(400);
  expect((await patch({ totalFee: 120000, installments: [{ label: "T1", amount: 100000, dueDate: "2026-12-01" }] })).status).toBe(400);
  expect((await patch({ totalFee: 60000, installments: [{ label: "Unique", amount: 60000, dueDate: "2026-12-01" }] })).status).toBe(409);
  const fee = await patch({
    totalFee: 120000,
    installments: [
      { label: "Inscription", amount: 50000, dueDate: "2026-12-01" },
      { label: "Conduite", amount: 70000, dueDate: "2027-01-15" },
    ],
  });
  expect(fee.status).toBe(200);
  expect((await fee.json()).group.installments.map((i: { label: string }) => i.label)).toEqual(["Inscription", "Conduite"]);
  const dossier = await (await call(`admin/students/${a.id}`, "GET", undefined, adminCookie)).json();
  expect(Number(dossier.enrollment.balance)).toBe(50000);
  // Status-only body still works (Fermer / Ouvrir).
  expect((await patch({ status: "closed" })).status).toBe(200);
  // Students can't edit; another school can't see it.
  expect((await call(`admin/groups/${group}`, "PATCH", { name: "Hack" }, a.cookie)).status).toBe(403);
  const audit = await owner.query("select count(*)::int n from school_app.audit_log where school_id=$1 and action='UPDATE_GROUP'", [school]);
  expect(audit.rows[0].n).toBeGreaterThanOrEqual(3);
});

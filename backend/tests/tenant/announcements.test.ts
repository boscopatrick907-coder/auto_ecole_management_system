import { beforeAll, afterAll, it, expect, vi } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";
import { runDuePaymentReminders } from "../../src/tenant/worker.js";
import { formatDoualaYmd } from "../../src/tenant/web-push.js";

// Safe delete, group announcements and per-student payment reminders (Web Push).
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
const slug = "ann-" + school.slice(0, 8);
const otherSlug = "ann-o-" + other.slice(0, 8);
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


const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
async function subscription(endpoint: string) {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { endpoint, keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}
const pushed: string[] = [];
let vapid = "";
const a = { cookie: "", id: "", enrollment: "" }, b = { cookie: "", id: "", enrollment: "" };

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  vapid = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith("https://push.test/")) {
      pushed.push(u);
      return new Response(null, { status: 201 });
    }
    return realFetch(input as RequestInfo, init);
  });
  // Tranche 1 due in 3 days (Douala), 50 000 FCFA.
  const today = formatDoualaYmd(new Date());
  await owner.query(
    "insert into school_app.installments(school_id,group_id,position,label,amount,due_date) values($1,$2,1,'Première tranche',50000,($3::date + 3))",
    [school, group, today],
  );
  for (const [who, name] of [[a, "a"], [b, "b"]] as const) {
    const phone = newPhone();
    const s = await deskCreatesStudent(phone);
    who.id = s.id;
    const act = await call("auth/activate", "POST", { phone, code: s.code, password: "motdepasse" });
    expect(act.status).toBe(201);
    who.cookie = cookieOf(act);
    who.enrollment = (await (await call(`admin/students/${s.id}`, "GET", undefined, adminCookie)).json()).enrollment.id;
    const sub = await call("push-subscriptions", "POST", await subscription(`https://push.test/${name}-${school}`), who.cookie);
    expect(sub.status).toBe(201);
  }
  // Student A has paid 30 000; student B nothing.
  const pay = await call("admin/payments", "POST", {
    enrollmentId: a.enrollment, amount: 30000, method: "cash", clientId: randomUUID(), paidAt: new Date().toISOString(),
  }, adminCookie);
  expect(pay.status).toBe(201);
}, 60000);

it("reminders reach each student once, with their own remaining amount", async () => {
  const env2 = { ...env, VAPID_PRIVATE_JWK: vapid };
  const client = await owner.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.school_id',$1,true), set_config('app.user_id','',true)", [school]);
    const t = (await client.query("select enrollment_id, remaining, milestone from school_app.due_reminder_targets($1::date)", [formatDoualaYmd(new Date())])).rows;
    // A signed-in caller never gets the reminder list (other students' amounts and push keys).
    await client.query("select set_config('app.user_id','someone',true)");
    expect((await client.query("select * from school_app.due_reminder_targets($1::date)", [formatDoualaYmd(new Date())])).rowCount).toBe(0);
    await client.query("rollback");
    const byEnrollment = Object.fromEntries(t.map((r) => [r.enrollment_id, Number(r.remaining)]));
    expect(byEnrollment).toEqual({ [a.enrollment]: 20000, [b.enrollment]: 50000 });
    expect(t.every((r) => r.milestone === "d3")).toBe(true);
  } finally {
    client.release();
  }
  // The job covers every school; look only at this school's deliveries.
  const mine = () => pushed.filter((u) => u.endsWith(school)).sort();
  pushed.length = 0;
  await runDuePaymentReminders(env2);
  expect(mine()).toEqual([`https://push.test/a-${school}`, `https://push.test/b-${school}`]);
  const logs = await owner.query("select enrollment_id from school_app.payment_reminder_logs where school_id=$1", [school]);
  expect(logs.rows.map((r) => r.enrollment_id).sort()).toEqual([a.enrollment, b.enrollment].sort());
  // Same day again: nothing sent twice.
  pushed.length = 0;
  await runDuePaymentReminders(env2);
  expect(mine()).toEqual([]);
});

it("announcements: group-targeted, read tracking, pushed to that group only, isolated per school", async () => {
  const env2 = { ...env, VAPID_PRIVATE_JWK: vapid };
  const post = (body: unknown) =>
    app.request(`http://localhost:8788/api/schools/${slug}/admin/announcements`, {
      method: "POST",
      headers: { Origin: "http://localhost:4200", Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, env2);
  expect((await call("admin/announcements", "POST", { title: "Hi", body: "x" }, a.cookie)).status).toBe(403);
  pushed.length = 0;
  const r = await post({ groupId: group, title: "Cours annulé", body: "Pas de cours demain matin." });
  expect(r.status).toBe(201);
  await vi.waitFor(() => expect(pushed.length).toBe(2));
  const ann = (await r.json()).announcement;
  const seen = await (await call("announcements", "GET", undefined, a.cookie)).json();
  expect(seen.announcements.map((x: { id: string }) => x.id)).toContain(ann.id);
  expect((await call(`announcements/${ann.id}/read`, "POST", {}, a.cookie)).status).toBe(200);
  const list = await (await call("admin/announcements", "GET", undefined, adminCookie)).json();
  expect(list.announcements.find((x: { id: string }) => x.id === ann.id)).toMatchObject({ read_count: 1, target_count: 2 });
  // Another school's admin sees nothing and cannot delete it.
  const otherAdmin = (await createAuth(env, authPool).api.signUpEmail({
    body: { email: other + "@test.local", name: "Other", password: "TestPassword123!" },
    headers: new Headers({ Origin: "http://localhost:4200" }),
    asResponse: true,
  })) as Response;
  const oc = cookieOf(otherAdmin);
  await owner.query("insert into school_app.school_members values($1,$2,'admin')", [other, ((await otherAdmin.json()) as { user: { id: string } }).user.id]);
  const theirs = await (await call("admin/announcements", "GET", undefined, oc, otherSlug)).json();
  expect(theirs.announcements).toEqual([]);
  expect((await call(`admin/announcements/${ann.id}`, "DELETE", undefined, oc, otherSlug)).status).toBe(404);
});

it("a second account on the same phone takes the push endpoint over", async () => {
  const shared = await subscription(`https://push.test/shared-${school}`);
  expect((await call("push-subscriptions", "POST", shared, a.cookie)).status).toBe(201);
  expect((await call("push-subscriptions", "POST", shared, b.cookie)).status).toBe(201);
  const rows = await owner.query("select s.id from school_app.push_subscriptions p join school_app.students s on s.user_id=p.user_id where p.endpoint=$1", [shared.endpoint]);
  expect(rows.rows.map((r) => r.id)).toEqual([b.id]);
});

it("safe delete: refused when payments exist, allowed otherwise", async () => {
  expect((await call(`admin/students/${a.id}`, "DELETE", undefined, adminCookie)).status).toBe(409);
  expect((await call(`admin/groups/${group}`, "DELETE", undefined, adminCookie)).status).toBe(409);
  expect((await call(`admin/students/${b.id}`, "DELETE", undefined, a.cookie)).status).toBe(403);
  expect((await call(`admin/students/${b.id}`, "DELETE", undefined, adminCookie)).status).toBe(200);
  expect((await call(`admin/students/${b.id}`, "GET", undefined, adminCookie)).status).toBe(404);
  const payments = await owner.query("select count(*)::int n from school_app.payments where school_id=$1", [school]);
  expect(payments.rows[0].n).toBe(1);
});

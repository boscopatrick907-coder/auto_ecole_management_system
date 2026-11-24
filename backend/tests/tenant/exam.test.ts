import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";

// PDF exam papers: the school adds an answer key to a PDF; students sit it with
// a timer, submit an answer sheet, and the server grades it.
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
const slug = "exam-" + school.slice(0, 8);
const otherSlug = "exam-o-" + other.slice(0, 8);
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


const pdf = randomUUID(),
  draftPdf = randomUUID(),
  video = randomUUID(),
  otherCatPdf = randomUUID(),
  otherCat = randomUUID();
let studentCookie = "";
let studentId = "";

beforeAll(async () => {
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'A','Permis A')",
    [otherCat, school],
  );
  await owner.query(
    `insert into school_app.resources(id,school_id,licence_category_id,title,type,storage_path,is_published) values
     ($1,$5,$6,'Épreuve 1','pdf','x/1.pdf',true),($2,$5,$6,'Brouillon','pdf','x/2.pdf',false),
     ($3,$5,$6,'Vidéo','video','x/3.mp4',true),($4,$5,$7,'Permis A','pdf','x/4.pdf',true)`,
    [pdf, draftPdf, video, otherCatPdf, school, cat, otherCat],
  );
  const phone = newPhone();
  const s = await deskCreatesStudent(phone);
  studentId = s.id;
  const a = await call("auth/activate", "POST", { phone, code: s.code, password: "motdepasse" });
  expect(a.status).toBe(201);
  studentCookie = cookieOf(a);
}, 60000);

const key = ["A", "BD", "C", "D", "A"];

it("only an admin can set a key, only on a PDF, and the key is validated", async () => {
  expect((await call(`admin/exams/${pdf}`, "PUT", { answers: key }, studentCookie)).status).toBe(403);
  expect((await call(`admin/exams/${video}`, "PUT", { answers: key }, adminCookie)).status).toBe(400);
  expect((await call(`admin/exams/${pdf}`, "PUT", { answers: ["A", "E"], choices: 4 }, adminCookie)).status).toBe(400);
  expect((await call(`admin/exams/${pdf}`, "PUT", { answers: [] }, adminCookie)).status).toBe(400);
  const r = await call(`admin/exams/${pdf}`, "PUT", { answers: ["a", "DB", "C", "D", "A"], choices: 4, durationMinutes: 60 }, adminCookie);
  expect(r.status).toBe(200);
  expect((await r.json()).exam.answers).toEqual(key);
  for (const id of [draftPdf, otherCatPdf])
    expect((await call(`admin/exams/${id}`, "PUT", { answers: key }, adminCookie)).status).toBe(200);
  const list = await (await call("admin/exams", "GET", undefined, adminCookie)).json();
  expect(list.exams.find((e: { resource_id: string }) => e.resource_id === pdf)).toMatchObject({ question_count: 5, duration_minutes: 60, answers: key });
});

it("a student sees published papers of their licence, never the key", async () => {
  const r = await call("exams", "GET", undefined, studentCookie);
  expect(r.status).toBe(200);
  const { exams } = await r.json();
  expect(exams.map((e: { resource_id: string }) => e.resource_id)).toEqual([pdf]);
  expect(exams[0]).toMatchObject({ title: "Épreuve 1", question_count: 5, choices: 4, duration_minutes: 60 });
  expect(JSON.stringify(exams)).not.toContain('"answers"');
});

it("the server grades the answer sheet, is idempotent, and shows results to the student and the desk", async () => {
  const clientId = randomUUID();
  const body = {
    resourceId: pdf,
    clientId,
    answers: ["A", "DB", "B", "", "a"],
    startedAt: new Date(Date.now() - 50 * 60000).toISOString(),
    submittedAt: new Date().toISOString(),
  };
  const r = await call("exam-attempts", "POST", body, studentCookie);
  expect(r.status).toBe(201);
  const { attempt } = await r.json();
  expect(attempt).toMatchObject({ score: 3, total: 5, key, answers: ["A", "BD", "B", "", "A"] });
  // Sent twice (offline queue retry): same attempt, no double count.
  const again = await (await call("exam-attempts", "POST", body, studentCookie)).json();
  expect(again.attempt.id).toBe(attempt.id);
  // Wrong number of answers, a draft paper, another licence: refused.
  expect((await call("exam-attempts", "POST", { ...body, clientId: randomUUID(), answers: ["A"] }, studentCookie)).status).toBe(400);
  expect((await call("exam-attempts", "POST", { ...body, clientId: randomUUID(), resourceId: draftPdf }, studentCookie)).status).toBe(403);
  expect((await call("exam-attempts", "POST", { ...body, clientId: randomUUID(), resourceId: otherCatPdf }, studentCookie)).status).toBe(403);
  expect((await call("exam-attempts", "POST", body, adminCookie)).status).toBe(403);

  const mine = await (await call("exam-results", "GET", undefined, studentCookie)).json();
  expect(mine.results).toHaveLength(1);
  expect(mine.results[0]).toMatchObject({ title: "Épreuve 1", score: 3, total: 5 });
  const desk = await (await call(`admin/students/${studentId}/exam-results`, "GET", undefined, adminCookie)).json();
  expect(desk.results[0]).toMatchObject({ score: 3, total: 5 });
  expect((await call(`admin/students/${studentId}/exam-results`, "GET", undefined, studentCookie)).status).toBe(403);
});

it("removing the key turns the PDF back into a plain course; actions are audited", async () => {
  expect((await call(`admin/exams/${draftPdf}`, "DELETE", undefined, adminCookie)).status).toBe(200);
  const list = await (await call("admin/exams", "GET", undefined, adminCookie)).json();
  expect(list.exams.map((e: { resource_id: string }) => e.resource_id)).not.toContain(draftPdf);
  const audit = await owner.query("select action from school_app.audit_log where school_id=$1 and action like '%EXAM%'", [school]);
  expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["SET_EXAM_KEY", "CLEAR_EXAM_KEY"]));
});

it("the lease endpoint explains a missing offline key instead of failing with a 500", async () => {
  const r = await app.request(
    `http://localhost:8788/api/schools/${slug}/lease`,
    { headers: { Origin: "http://localhost:4200", Cookie: studentCookie } },
    { ...env, OFFLINE_PRIVATE_KEY_PEM: "" },
  );
  expect(r.status).toBe(503);
  expect((await r.json()).error).toBe("OFFLINE_KEY_MISSING");
  // A PEM pasted with literal "\n" still works.
  const escaped = env.OFFLINE_PRIVATE_KEY_PEM.replace(/\n/g, "\\n");
  const ok = await app.request(
    `http://localhost:8788/api/schools/${slug}/lease`,
    { headers: { Origin: "http://localhost:4200", Cookie: studentCookie } },
    { ...env, OFFLINE_PRIVATE_KEY_PEM: escaped },
  );
  expect(ok.status).toBe(200);
});

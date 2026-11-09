import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { hashPassword } from "../../src/utils/crypto.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";
const base =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Disposable database required");
const cluster = new pg.Pool({ connectionString: base });
const name = "import_" + randomUUID().replace(/-/g, "");
const u = new URL(base);
u.pathname = "/" + name;
const url = u.toString();
let owner: pg.Pool;
const admin = randomUUID(),
  studentUser = randomUUID(),
  student = randomUUID(),
  cat = randomUUID(),
  group = randomUUID(),
  enrollment = randomUUID();
beforeAll(async () => {
  await cluster.query("create database " + name);
  owner = new pg.Pool({ connectionString: url });
  await owner.query(
    await fs.readFile(
      new URL("../../../la-marseillaise-neon-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await owner.query(
    await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    ),
  );
  const hash = await hashPassword("LegacyPassword123!");
  await owner.query(
    "insert into public.users(id,name,email,phone,password_hash) values($1,'Legacy Admin','legacy-admin@test.local','+237699000001',$3),($2,'Legacy Student','legacy-student@test.local','+237699000002',$3)",
    [admin, studentUser, hash],
  );
  await owner.query("update public.profiles set role='admin' where id=$1", [
    admin,
  ]);
  await owner.query(
    "insert into public.licence_categories(id,code,name) values($1,'TEST','Test')",
    [cat],
  );
  await owner.query(
    "insert into public.groups(id,licence_category_id,name,capacity,total_fee) values($1,$2,'Legacy',20,100000)",
    [group, cat],
  );
  await owner.query(
    "insert into public.installments(group_id,position,label,amount,due_date) values($1,1,'T1',100000,current_date)",
    [group],
  );
  await owner.query(
    "insert into public.students(id,user_id,full_name,phone,licence_category_id) values($1,$2,'Legacy Student','+237699000002',$3)",
    [student, studentUser, cat],
  );
  await owner.query(
    "update public.students set trial_ends_at=now()-interval '2 days' where id=$1",
    [student],
  );
  await owner.query(
    "insert into public.enrollments(id,student_id,group_id) values($1,$2,$3)",
    [enrollment, student, group],
  );
  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.current_user_id',$1,true)", [admin]);
    await c.query(
      "select public.record_payment($1,50000,'cash',null,$2,now(),null)",
      [enrollment, randomUUID()],
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}, 60000);
afterAll(async () => {
  await owner?.end();
  await cluster.query("drop database " + name + " with(force)");
  await cluster.end();
});
it("imports in one transaction with reconciled balances, preserved expired trial and compatible Better Auth login", async () => {
  const output = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/tenant/import-legacy.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: url,
        LEGACY_SCHOOL_SLUG: "legacy-import",
        LEGACY_IMPORT_CONFIRM: "BACKED_UP_AND_WRITE_FROZEN",
      },
      encoding: "utf8",
    },
  );
  const report = JSON.parse(output.trim());
  expect(report.balancesReconciled).toBe(true);
  expect(report.counts.payments).toBe(1);
  expect(
    (
      await owner.query(
        "select balance from school_app.enrollment_balances where school_id=$1",
        [report.schoolId],
      )
    ).rows[0].balance,
  ).toBe("50000");
  expect(
    new Date(
      (
        await owner.query(
          "select trial_ends_at from school_app.students where id=$1",
          [student],
        )
      ).rows[0].trial_ends_at,
    ).getTime(),
  ).toBeLessThan(Date.now());
  await owner.query(
    "do $$begin create role import_identity_login login password 'import_identity_local';exception when duplicate_object then null;end $$;grant aem_identity_runtime to import_identity_login;",
  );
  const authUrl = new URL(url);
  authUrl.username = "import_identity_login";
  authUrl.password = "import_identity_local";
  const env = {
    AUTH_DATABASE_URL: authUrl.toString(),
    BETTER_AUTH_URL: "http://localhost:8788",
    TRUSTED_ORIGINS: "http://localhost:4200",
    BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
    ENVIRONMENT: "development",
  } as TenantBindings;
  const identity = poolFor(env, true);
  try {
    const r = await createAuth(env, identity).api.signInEmail({
      body: {
        email: "legacy-admin@test.local",
        password: "LegacyPassword123!",
      },
      asResponse: true,
    });
    expect(r.status).toBe(200);
  } finally {
    await identity.end();
  }
}, 60000);

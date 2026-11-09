import { beforeAll, afterAll, describe, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tenantTransaction } from "../../src/tenant/context.js";
const url =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Tenant tests require disposable local PostgreSQL.");
const owner = new pg.Pool({ connectionString: url });
let runtime: pg.Pool;
const a = randomUUID(),
  b = randomUUID(),
  catA = randomUUID(),
  catB = randomUUID(),
  groupA = randomUUID(),
  groupB = randomUUID(),
  sa = randomUUID(),
  sb = randomUUID(),
  other = randomUUID(),
  ea = randomUUID(),
  eb = randomUUID();
const tx = <T>(
  school: string,
  user: string,
  fn: (c: pg.PoolClient) => Promise<T>,
) => tenantTransaction(runtime, school, user, fn);
beforeAll(async () => {
  await owner.query(
    await fs
      .readFile(
        new URL("../../migrations/001_multitenant.sql", import.meta.url),
        "utf8",
      )
      .catch(() =>
        fs.readFile(
          new URL("../../../migrations/001_multitenant.sql", import.meta.url),
          "utf8",
        ),
      ),
  );
  await owner.query(
    "do $$begin create role tenant_test_login login password 'tenant_local_only';exception when duplicate_object then null;end $$; grant aem_tenant_runtime to tenant_test_login;",
  );
  runtime = new pg.Pool({
    connectionString: url.replace(
      /\/\/[^@]*@/,
      "//tenant_test_login:tenant_local_only@",
    ),
  });
  for (const u of [
    "admin-a",
    "admin-b",
    "student-a",
    "student-b",
    "student-other",
  ])
    await owner.query(
      'insert into identity."user"(id,name,email) values($1,$1,$2) on conflict do nothing',
      [u, u + "@test.local"],
    );
  await owner.query(
    "insert into school_app.schools(id,name,slug) values($1,'A',$3),($2,'B',$4)",
    [a, b, "a-" + a, "b-" + b],
  );
  await owner.query(
    "insert into school_app.school_members values($1,'admin-a','admin'),($2,'admin-b','admin'),($1,'student-a','student'),($2,'student-b','student'),($1,'student-other','student')",
    [a, b],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','B'),($3,$4,'B','B')",
    [catA, a, catB, b],
  );
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'A',1,100000),($4,$5,$6,'B',10,100000)",
    [groupA, a, catA, groupB, b, catB],
  );
  for (const [s, school, user, cat, phone] of [
    [sa, a, "student-a", catA, "+237699000011"],
    [sb, b, "student-b", catB, "+237699000011"],
    [other, a, "student-other", catA, "+237699000012"],
  ])
    await owner.query(
      "insert into school_app.students(id,school_id,user_id,full_name,phone,licence_category_id) values($1,$2,$3,$3,$4,$5)",
      [s, school, user, phone, cat],
    );
  await owner.query(
    "insert into school_app.enrollments(id,school_id,student_id,group_id) values($1,$2,$3,$4),($5,$6,$7,$8)",
    [ea, a, sa, groupA, eb, b, sb, groupB],
  );
  await owner.query(
    "insert into school_app.installments(school_id,group_id,position,label,amount,due_date) values($1,$2,1,'T1',100000,current_date+7),($3,$4,1,'T1',100000,current_date+7)",
    [a, groupA, b, groupB],
  );
}, 60000);
afterAll(async () => {
  await runtime?.end();
  await owner.end();
});
describe("school isolation and finance invariants", () => {
  it("runtime is neither owner nor BYPASSRLS and owner requests are rejected", async () => {
    await expect(
      tenantTransaction(owner, a, "admin-a", (c) => c.query("select 1")),
    ).rejects.toThrow("UNSAFE_DATABASE_ROLE");
    const rows = await tx(
      a,
      "admin-a",
      async (c) => (await c.query("select id from school_app.students")).rows,
    );
    expect(rows.map((x) => x.id).sort()).toEqual([sa, other].sort());
  });
  it("school A admin cannot read or mutate school B records", async () => {
    await tx(a, "admin-a", async (c) => {
      expect(
        (await c.query("select id from school_app.students where id=$1", [sb]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await c.query(
            "update school_app.students set full_name='Hacked' where id=$1",
            [sb],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await c.query(
            "select * from school_app.enrollment_balances where enrollment_id=$1",
            [eb],
          )
        ).rowCount,
      ).toBe(0);
    });
  });
  it("student sees only own dossier and cannot promote membership", async () => {
    await tx(a, "student-a", async (c) => {
      expect(
        (await c.query("select id from school_app.students")).rows.map(
          (x) => x.id,
        ),
      ).toEqual([sa]);
    });
    await expect(
      tx(a, "student-a", (c) =>
        c.query("update school_app.school_members set role='admin'"),
      ),
    ).rejects.toThrow();
  });
  it("rejects cross-school foreign keys even for owner imports", async () => {
    await expect(
      owner.query(
        "insert into school_app.enrollments(school_id,student_id,group_id) values($1,$2,$3)",
        [a, sa, groupB],
      ),
    ).rejects.toThrow();
  });
  it("records once across concurrent retries and refuses changed intent", async () => {
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        tx(
          a,
          "admin-a",
          async (c) =>
            (
              await c.query(
                "select * from school_app.record_payment($1,50000,'cash',null,$2)",
                [ea, id],
              )
            ).rows[0],
        ),
      ),
    );
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
    await expect(
      tx(a, "admin-a", (c) =>
        c.query(
          "select * from school_app.record_payment($1,40000,'cash',null,$2)",
          [ea, id],
        ),
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("rejects student payments, overpayments and foreign enrollment payments", async () => {
    await expect(
      tx(a, "student-a", (c) =>
        c.query(
          "select * from school_app.record_payment($1,1,'cash',null,$2)",
          [ea, randomUUID()],
        ),
      ),
    ).rejects.toThrow("ADMIN_REQUIRED");
    await expect(
      tx(a, "admin-a", (c) =>
        c.query(
          "select * from school_app.record_payment($1,90000,'cash',null,$2)",
          [ea, randomUUID()],
        ),
      ),
    ).rejects.toThrow("EXCEEDS_BALANCE");
    await expect(
      tx(a, "admin-a", (c) =>
        c.query(
          "select * from school_app.record_payment($1,1,'cash',null,$2)",
          [eb, randomUUID()],
        ),
      ),
    ).rejects.toThrow("ENROLLMENT_NOT_FOUND");
  });
  it("counter rolls back without gaps and numbers restart per school", async () => {
    const before = (
      await owner.query(
        "select last_value from school_app.receipt_counters where school_id=$1",
        [a],
      )
    ).rows[0].last_value;
    await expect(
      tx(a, "admin-a", async (c) => {
        await c.query(
          "select * from school_app.record_payment($1,1,'cash',null,$2)",
          [ea, randomUUID()],
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (
        await owner.query(
          "select last_value from school_app.receipt_counters where school_id=$1",
          [a],
        )
      ).rows[0].last_value,
    ).toBe(before);
    const r = await tx(
      b,
      "admin-b",
      async (c) =>
        (
          await c.query(
            "select * from school_app.record_payment($1,1,'cash',null,$2)",
            [eb, randomUUID()],
          )
        ).rows[0],
    );
    expect(r.receipt_number).toMatch(/-000001$/);
  });
  it("payments are append-only, cancellation requires reason and audit persists", async () => {
    const p = (
      await owner.query(
        "select id from school_app.payments where school_id=$1",
        [a],
      )
    ).rows[0].id;
    await expect(
      tx(a, "admin-a", (c) =>
        c.query("delete from school_app.payments where id=$1", [p]),
      ),
    ).rejects.toThrow();
    await expect(
      owner.query("update school_app.payments set amount=1 where id=$1", [p]),
    ).rejects.toThrow("APPEND_ONLY");
    await expect(
      tx(a, "admin-a", (c) =>
        c.query("select school_app.cancel_payment($1,'')", [p]),
      ),
    ).rejects.toThrow("REASON_REQUIRED");
    await tx(a, "admin-a", (c) =>
      c.query("select school_app.cancel_payment($1,'Erreur de caisse')", [p]),
    );
    expect(
      (
        await owner.query(
          "select count(*)::int as n from school_app.audit_log where school_id=$1 and row_id=$2",
          [a, p],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("clears transaction context before reusing pooled connections", async () => {
    const r = await runtime.query(
      "select current_setting('app.school_id',true) as school,current_setting('app.user_id',true) as user",
    );
    expect(r.rows[0].school || "").toBe("");
    expect(r.rows[0].user || "").toBe("");
  });
  it("does not expose question answer keys to runtime", async () => {
    await expect(
      tx(a, "student-a", (c) =>
        c.query("select correct_index from school_app.questions"),
      ),
    ).rejects.toThrow();
  });
});
it("platform school changes require explicit operator membership and persist immutable audit", async () => {
  await expect(
    tx(a, "admin-a", (c) =>
      c.query(
        "select school_app.platform_action('suspend_school',$1,'Support incident')",
        [b],
      ),
    ),
  ).rejects.toThrow("PLATFORM_ADMIN_REQUIRED");
  await owner.query(
    "insert into school_app.platform_admins(user_id) values('admin-a') on conflict do nothing",
  );
  await tx(a, "admin-a", (c) =>
    c.query(
      "select school_app.platform_action('suspend_school',$1,'Support incident')",
      [b],
    ),
  );
  expect(
    (
      await owner.query("select status from school_app.schools where id=$1", [
        b,
      ])
    ).rows[0].status,
  ).toBe("suspended");
  expect(
    (
      await owner.query(
        "select count(*)::int as n from school_app.platform_audit where school_id=$1",
        [b],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    owner.query("delete from school_app.platform_audit where school_id=$1", [
      b,
    ]),
  ).rejects.toThrow("AUDIT_APPEND_ONLY");
  await tx(a, "admin-a", (c) =>
    c.query(
      "select school_app.platform_action('activate_school',$1,'Incident resolved')",
      [b],
    ),
  );
  await owner.query(
    "delete from school_app.platform_admins where user_id='admin-a'",
  );
});

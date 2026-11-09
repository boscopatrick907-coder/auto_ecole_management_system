import pg from "pg";
// Additive, all-or-nothing legacy import. Explicit opt-in after backup/write-freeze.
for (const key of ["MIGRATION_DATABASE_URL", "LEGACY_SCHOOL_SLUG"])
  if (!process.env[key]) throw new Error("Missing " + key);
if (process.env.LEGACY_IMPORT_CONFIRM !== "BACKED_UP_AND_WRITE_FROZEN")
  throw new Error(
    "Back up, restore-test and freeze legacy writes; then set LEGACY_IMPORT_CONFIRM=BACKED_UP_AND_WRITE_FROZEN.",
  );
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const c = await pool.connect();
try {
  await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await c.query("SELECT pg_advisory_xact_lock(684209142)");
  const existing = await c.query(
    "select id from school_app.schools where slug=$1",
    [process.env.LEGACY_SCHOOL_SLUG],
  );
  if (existing.rowCount)
    throw new Error(
      "Target school already exists. Import is intentionally not a destructive overwrite.",
    );
  const invalid = await c.query(
    "select count(*)::int as n from public.users where email is null or trim(email)='' or email not like '%@%'",
  );
  if (invalid.rows[0].n)
    throw new Error(
      "Legacy identities require verified email mapping before import. No synthetic login addresses will be created.",
    );
  const unsupported = await c.query(
    "select count(*)::int as n from public.profiles where role::text not in ('admin','student')",
  );
  if (unsupported.rows[0].n)
    throw new Error(
      "Legacy staff roles need an explicit reviewed mapping; this V1 supports admin/student only.",
    );
  const settings = (
    await c.query("select * from public.app_settings where id=1")
  ).rows[0];
  const school = (
    await c.query(
      "insert into school_app.schools(name,slug,address,phone,whatsapp,receipt_prefix) values($1,$2,$3,$4,$4,$5) returning id",
      [
        settings.school_name,
        process.env.LEGACY_SCHOOL_SLUG,
        settings.school_address || "",
        settings.school_phone || "",
        settings.receipt_prefix,
      ],
    )
  ).rows[0].id;
  await c.query(
    `insert into identity."user"(id,name,email,"emailVerified","createdAt","updatedAt") select id::text,name,lower(email),email_verified,created_at,updated_at from public.users`,
  );
  await c.query(
    `insert into identity.account(id,"accountId","providerId","userId",password) select id::text,id::text,'credential',id::text,'legacy-scrypt:'||password_hash from public.users where password_hash is not null`,
  );
  await c.query(
    "insert into school_app.school_members(school_id,user_id,role) select $1,id::text,role::text from public.profiles",
    [school],
  );
  await c.query(
    "insert into school_app.licence_categories(id,school_id,code,name,is_active) select id,$1,code,name,is_active from public.licence_categories",
    [school],
  );
  await c.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,start_date,capacity,total_fee,status) select id,$1,licence_category_id,name,start_date,capacity,total_fee,status::text from public.groups",
    [school],
  );
  await c.query(
    "insert into school_app.installments(id,school_id,group_id,position,label,amount,due_date) select id,$1,group_id,position,label,amount,due_date from public.installments",
    [school],
  );
  await c.query(
    "insert into school_app.students(id,school_id,user_id,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at) select id,$1,user_id::text,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at from public.students",
    [school],
  );
  await c.query(
    "insert into school_app.enrollments(id,school_id,student_id,group_id,status,created_at) select id,$1,student_id,group_id,status::text,created_at from public.enrollments",
    [school],
  );
  await c.query(
    "insert into school_app.invites(id,school_id,student_id,code_hash,expires_at,used_at,created_by) select id,$1,student_id,code_hash,expires_at,used_at,created_by::text from public.invites",
    [school],
  );
  await c.query(
    "insert into school_app.receipt_counters(school_id,year,last_value) select $1,year,last_value from public.receipt_counters",
    [school],
  );
  // Avoid manufacturing new audit events for historical payments; original audit is copied below.
  await c.query(
    "alter table school_app.payments disable trigger payment_audit",
  );
  await c.query(
    "insert into school_app.payments(id,school_id,enrollment_id,amount,method,reference,receipt_number,paid_at,recorded_by,client_id,cancelled_at,cancelled_by,cancel_reason) select id,$1,enrollment_id,amount,method::text,reference,receipt_number,paid_at,recorded_by::text,coalesce(client_id,id),cancelled_at,cancelled_by::text,cancel_reason from public.payments",
    [school],
  );
  await c.query("alter table school_app.payments enable trigger payment_audit");
  await c.query(
    "insert into school_app.audit_log(school_id,actor,action,row_id,details,at) select $1,actor::text,action,row_id,details,at from public.audit_log",
    [school],
  );
  await c.query(
    "insert into school_app.resources(id,school_id,licence_category_id,title,description,type,storage_path,external_url,is_published) select id,$1,licence_category_id,title,coalesce(description,''),type::text,storage_path,external_url,is_published from public.resources",
    [school],
  );
  await c.query(
    "insert into school_app.quizzes(id,school_id,licence_category_id,title,duration_minutes,is_published) select id,$1,licence_category_id,title,duration_minutes,is_published from public.quizzes",
    [school],
  );
  await c.query(
    "insert into school_app.questions(id,school_id,quiz_id,body,options,correct_index,position) select id,$1,quiz_id,body,options,correct_index,position from public.questions",
    [school],
  );
  await c.query(
    "insert into school_app.quiz_attempts(id,school_id,student_id,quiz_id,answers,score,total,taken_at,client_id) select id,$1,student_id,quiz_id,'{}',score,total,taken_at,coalesce(client_id,id) from public.quiz_attempts",
    [school],
  );
  const tables = [
    "licence_categories",
    "groups",
    "installments",
    "students",
    "enrollments",
    "invites",
    "payments",
    "audit_log",
    "resources",
    "quizzes",
    "questions",
    "quiz_attempts",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const source = Number(
      (await c.query("select count(*) as n from public." + table)).rows[0].n,
    );
    const target = Number(
      (
        await c.query(
          "select count(*) as n from school_app." +
            table +
            " where school_id=$1",
          [school],
        )
      ).rows[0].n,
    );
    if (source !== target) throw new Error("Count mismatch: " + table);
    counts[table] = target;
  }
  const differences = await c.query(
    "select count(*)::int as n from public.enrollment_balances old join school_app.enrollment_balances new on new.school_id=$1 and new.enrollment_id=old.enrollment_id where old.paid<>new.paid or old.balance<>new.balance",
    [school],
  );
  if (differences.rows[0].n) throw new Error("Balance reconciliation failed");
  await c.query("COMMIT");
  console.log(
    JSON.stringify({
      imported: true,
      schoolId: school,
      counts,
      balancesReconciled: true,
      legacyDataUnchanged: true,
      legacySessionsCopied: false,
    }),
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}

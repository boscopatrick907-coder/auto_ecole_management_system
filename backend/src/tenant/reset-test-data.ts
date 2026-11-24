import pg from "pg";

/**
 * Removes test data from ONE school before it starts using the app for real.
 *
 * Removed: students (and their student login accounts), enrollments, codes,
 * payments and receipts (the receipt counter restarts at 1), quiz and exam
 * results, phone lockouts, pending staff codes and, unless KEEP_GROUPS=1,
 * groups and their tranches.
 * Kept: the school, its settings, logo and colors, admins (Équipe), licence
 * categories, courses, quizzes and exam papers (unless RESET_CONTENT=1), and
 * the audit log (append-only; a RESET_TEST_DATA entry records what was removed).
 *
 * Dry run by default: prints what would be removed. To delete, after a backup:
 *   RESET_CONFIRM=<slug>:BACKED_UP
 */
export interface ResetOptions {
  execute: boolean;
  keepGroups?: boolean;
  resetContent?: boolean;
}

export async function resetSchoolData(client: pg.ClientBase, slug: string, opts: ResetOptions) {
  const school = await client.query("select id, name from school_app.schools where slug=$1", [slug]);
  if (!school.rowCount) throw new Error(`School "${slug}" not found`);
  const id: string = school.rows[0].id;

  const count = async (sql: string) => Number((await client.query(sql, [id])).rows[0].n);
  const counts: Record<string, number> = {
    students: await count("select count(*) n from school_app.students where school_id=$1"),
    payments: await count("select count(*) n from school_app.payments where school_id=$1"),
    enrollments: await count("select count(*) n from school_app.enrollments where school_id=$1"),
    quiz_attempts: await count("select count(*) n from school_app.quiz_attempts where school_id=$1"),
    exam_attempts: await count("select count(*) n from school_app.exam_attempts where school_id=$1"),
    groups: opts.keepGroups ? 0 : await count("select count(*) n from school_app.groups where school_id=$1"),
    resources: opts.resetContent ? await count("select count(*) n from school_app.resources where school_id=$1") : 0,
    quizzes: opts.resetContent ? await count("select count(*) n from school_app.quizzes where school_id=$1") : 0,
  };
  if (!opts.execute) return { school: school.rows[0].name as string, counts, executed: false };

  await client.query("begin");
  try {
    // Student login accounts that belong only to this school's students.
    const users = (
      await client.query(
        `select s.user_id from school_app.students s
          where s.school_id=$1 and s.user_id is not null
            and not exists(select 1 from school_app.school_members m where m.user_id=s.user_id and m.role='admin')
            and not exists(select 1 from school_app.platform_admins p where p.user_id=s.user_id)
            and not exists(select 1 from school_app.students o where o.user_id=s.user_id and o.school_id<>$1)`,
        [id],
      )
    ).rows.map((r) => r.user_id as string);

    const del = (sql: string) => client.query(sql, [id]);
    await del("delete from school_app.exam_attempts where school_id=$1");
    await del("delete from school_app.quiz_attempts where school_id=$1");
    // Payments are protected against deletion in normal use; only this
    // explicit, confirmed reset lifts the guard, inside the transaction.
    await client.query("alter table school_app.payments disable trigger payment_guard");
    await del("delete from school_app.payments where school_id=$1");
    await client.query("alter table school_app.payments enable trigger payment_guard");
    await del("delete from school_app.receipt_counters where school_id=$1");
    await del("delete from school_app.invites where school_id=$1");
    await del("delete from school_app.enrollments where school_id=$1");
    await del("delete from school_app.phone_login_attempts where school_id=$1");
    await del("delete from school_app.staff_invites where school_id=$1 and used_at is null");
    await del("delete from school_app.school_members where school_id=$1 and role='student'");
    await del("delete from school_app.students where school_id=$1");
    if (users.length) await client.query('delete from identity."user" where id = any($1)', [users]);
    if (!opts.keepGroups) {
      await del("delete from school_app.installments where school_id=$1");
      await del("delete from school_app.groups where school_id=$1");
    }
    if (opts.resetContent) {
      await del("delete from school_app.exam_keys where school_id=$1");
      await del("delete from school_app.questions where school_id=$1");
      await del("delete from school_app.quizzes where school_id=$1");
      await del("delete from school_app.resources where school_id=$1");
    }
    await client.query(
      "insert into school_app.audit_log(school_id,actor,action,row_id,details) values($1,null,'RESET_TEST_DATA',null,$2)",
      [id, JSON.stringify({ ...counts, student_accounts: users.length, keepGroups: !!opts.keepGroups, resetContent: !!opts.resetContent })],
    );
    await client.query("commit");
    return { school: school.rows[0].name as string, counts: { ...counts, student_accounts: users.length }, executed: true };
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

if (process.argv[1]?.endsWith("reset-test-data.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  const slug = process.env.SCHOOL_SLUG;
  if (!url || !slug) throw new Error("Set MIGRATION_DATABASE_URL (owner account) and SCHOOL_SLUG.");
  const execute = process.env.RESET_CONFIRM === `${slug}:BACKED_UP`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await resetSchoolData(client, slug, {
      execute,
      keepGroups: process.env.KEEP_GROUPS === "1",
      resetContent: process.env.RESET_CONTENT === "1",
    });
    console.log(`${r.executed ? "Removed" : "Would remove (dry run)"} — ${r.school}:`);
    console.table(r.counts);
    if (!r.executed)
      console.log(`Nothing deleted. After a backup, run again with RESET_CONFIRM=${slug}:BACKED_UP`);
  } finally {
    await client.end();
  }
}

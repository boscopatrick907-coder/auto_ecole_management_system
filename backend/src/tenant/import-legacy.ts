import pg from "pg";

// Additive, all-or-nothing legacy import. Explicit opt-in after backup/write-freeze.
for (const key of ["MIGRATION_DATABASE_URL", "LEGACY_SCHOOL_SLUG"])
  if (!process.env[key]) throw new Error("Missing " + key);
if (process.env.LEGACY_IMPORT_CONFIRM !== "BACKED_UP_AND_WRITE_FROZEN")
  throw new Error(
    "Back up, restore-test and freeze legacy writes; then set LEGACY_IMPORT_CONFIRM=BACKED_UP_AND_WRITE_FROZEN.",
  );

const reviewedEmailMap: Record<string, string> = process.env.LEGACY_REVIEWED_EMAIL_MAP_JSON
  ? JSON.parse(process.env.LEGACY_REVIEWED_EMAIL_MAP_JSON)
  : {};
const deferStaffPolicy = process.env.LEGACY_STAFF_ROLE_POLICY === "DEFER_MEMBERSHIP_AND_ARCHIVE";
const allowVerifiedLink = process.env.LEGACY_ALLOW_VERIFIED_IDENTITY_LINK === "true";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const c = await pool.connect();

async function hasColumn(table: string, column: string, schema = "public"): Promise<boolean> {
  const r = await c.query(
    "select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3",
    [schema, table, column],
  );
  return Boolean(r.rowCount);
}

async function hasTable(table: string, schema = "public"): Promise<boolean> {
  const r = await c.query(
    "select 1 from information_schema.tables where table_schema=$1 and table_name=$2",
    [schema, table],
  );
  return Boolean(r.rowCount);
}

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

  // 1. Validate staff roles before applying any mutations
  const unsupported = await c.query(
    "select id::text as id, role::text as role from public.profiles where role::text not in ('admin','student')",
  );
  if (unsupported.rowCount && !deferStaffPolicy)
    throw new Error(
      "Legacy staff roles need an explicit reviewed mapping; this V1 supports admin/student only.",
    );

  // 2. Inspect legacy users and apply only explicitly reviewed email mappings (never fabricate emails)
  const legacyUsersRes = await c.query(
    "select u.id::text as id, u.name, u.email, u.email_verified, u.phone, u.password_hash, u.created_at, u.updated_at, p.role::text as role from public.users u left join public.profiles p on p.id = u.id",
  );

  const resolvedUsers: Array<{
    legacyId: string;
    targetUserId: string;
    name: string;
    email: string;
    emailVerified: boolean;
    passwordHash: string | null;
    createdAt: Date;
    updatedAt: Date;
    role: string | null;
    alreadyInIdentity: boolean;
  }> = [];

  const seenEmails = new Set<string>();
  for (const row of legacyUsersRes.rows) {
    const mappedEmail = reviewedEmailMap[row.id] ?? row.email;
    if (!mappedEmail || typeof mappedEmail !== "string" || mappedEmail.trim() === "" || !mappedEmail.includes("@")) {
      throw new Error(
        "Legacy identities require verified email mapping before import. No synthetic login addresses will be created.",
      );
    }
    const normEmail = mappedEmail.trim().toLowerCase();
    if (seenEmails.has(normEmail)) {
      throw new Error(
        `Duplicate or case-colliding legacy email address detected: ${normEmail}`,
      );
    }
    seenEmails.add(normEmail);

    // Check global identity table for multi-school deduplication / collision safety
    const existingIdentity = await c.query(
      'select id, lower(email) as email, "emailVerified" from identity."user" where id = $1 or lower(email) = $2',
      [row.id, normEmail],
    );

    let targetUserId = row.id;
    let alreadyInIdentity = false;
    const isLegacyVerified = Boolean(row.email_verified || reviewedEmailMap[row.id]);

    if (existingIdentity.rowCount) {
      if (existingIdentity.rowCount > 1) {
        throw new Error("Global identity collision across multiple existing identity rows.");
      }
      const match = existingIdentity.rows[0];
      const bothVerified = Boolean(match.emailVerified && isLegacyVerified);
      const exactSameIdAndEmail = match.id === row.id && match.email === normEmail;
      if (!bothVerified || (!exactSameIdAndEmail && !allowVerifiedLink)) {
        throw new Error(
          "Global identity collision detected; never merge identities from an unverified or unreviewed email.",
        );
      }
      targetUserId = match.id;
      alreadyInIdentity = true;
    }

    resolvedUsers.push({
      legacyId: row.id,
      targetUserId,
      name: row.name,
      email: normEmail,
      emailVerified: isLegacyVerified,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      role: row.role,
      alreadyInIdentity,
    });
  }

  // 3. Validate nullable fields, phone formats, question option bounds, and payment cancellation invariants
  const badGroups = await c.query(
    "select count(*)::int as n from public.groups where licence_category_id is null or capacity is null or capacity <= 0 or total_fee is null or total_fee < 0 or total_fee > 1000000000",
  );
  if (badGroups.rows[0].n) throw new Error("Incompatible legacy group rows (nullable capacity/fee/category).");

  const defaultQuizDurationRaw = process.env.LEGACY_DEFAULT_QUIZ_DURATION_MINUTES;
  const defaultQuizDuration = defaultQuizDurationRaw ? Number(defaultQuizDurationRaw) : null;
  if (defaultQuizDuration !== null && (!Number.isInteger(defaultQuizDuration) || defaultQuizDuration <= 0)) {
    throw new Error("LEGACY_DEFAULT_QUIZ_DURATION_MINUTES must be a positive integer.");
  }

  const badQuizzes = await c.query(
    "select count(*)::int as n, count(*) filter (where duration_minutes is null)::int as null_durations from public.quizzes where licence_category_id is null or duration_minutes <= 0 or (duration_minutes is null and $1::int is null)",
    [defaultQuizDuration],
  );
  if (badQuizzes.rows[0].n) {
    throw new Error(
      "Incompatible legacy quiz rows (nullable duration/category); set LEGACY_DEFAULT_QUIZ_DURATION_MINUTES to map untimed legacy quizzes.",
    );
  }
  const untimedQuizzesMapped = Number(
    (await c.query("select count(*)::int as n from public.quizzes where duration_minutes is null")).rows[0].n,
  );

  const badStudents = await c.query(
    "select count(*)::int as n from public.students where licence_category_id is null or phone is null or phone !~ '^\\+237[26][0-9]{8}$'",
  );
  if (badStudents.rows[0].n) throw new Error("Incompatible legacy student rows (missing category or invalid phone format).");

  const badQuestions = await c.query(
    "select count(*)::int as n from public.questions where options is null or jsonb_typeof(options) <> 'array' or jsonb_array_length(options) < 2 or correct_index is null or correct_index < 0 or correct_index >= jsonb_array_length(options)",
  );
  if (badQuestions.rows[0].n) throw new Error("Incompatible legacy question rows (invalid options array or out-of-bounds correct_index).");

  const badPayments = await c.query(
    "select count(*)::int as n from public.payments where recorded_by is null or (cancelled_at is not null and (cancelled_by is null or cancel_reason is null or length(trim(cancel_reason)) < 1))",
  );
  if (badPayments.rows[0].n) throw new Error("Incompatible legacy payment rows (missing actor or cancellation reason).");

  const badInvites = await c.query(
    "select count(*)::int as n from public.invites where created_by is null",
  );
  if (badInvites.rows[0].n) throw new Error("Incompatible legacy invite rows (missing created_by).");

  // 4. Create school record preserving all approved metadata
  const settings = (
    await c.query("select * from public.app_settings where id=1")
  ).rows[0];
  const whatsappVal =
    settings.whatsapp_number ||
    process.env.LEGACY_SCHOOL_WHATSAPP ||
    settings.school_phone ||
    "";
  const agrementVal =
    settings.agrement_number ||
    process.env.LEGACY_SCHOOL_AGREMENT ||
    "";
  const logoVal =
    settings.logo_url ||
    process.env.LEGACY_SCHOOL_LOGO ||
    null;

  const school = (
    await c.query(
      "insert into school_app.schools(name,slug,logo,address,phone,whatsapp,agrement_number,receipt_prefix) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [
        settings.school_name,
        process.env.LEGACY_SCHOOL_SLUG,
        logoVal,
        settings.school_address || "",
        settings.school_phone || "",
        whatsappVal,
        agrementVal,
        settings.receipt_prefix,
      ],
    )
  ).rows[0].id;

  // Build mapping from legacy user UUID string -> target identity user_id
  const userIdMap = new Map<string, string>();
  for (const u of resolvedUsers) {
    userIdMap.set(u.legacyId, u.targetUserId);
    if (!u.alreadyInIdentity) {
      await c.query(
        'insert into identity."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,$4,$5,$6)',
        [u.targetUserId, u.name, u.email, u.emailVerified, u.createdAt, u.updatedAt],
      );
      if (u.passwordHash) {
        await c.query(
          'insert into identity.account(id,"accountId","providerId","userId",password) values($1,$1,\'credential\',$1,$2)',
          [u.targetUserId, "legacy-scrypt:" + u.passwordHash],
        );
      }
    }
    if (u.role === "admin" || u.role === "student") {
      await c.query(
        "insert into school_app.school_members(school_id,user_id,role) values($1,$2,$3) on conflict(school_id,user_id) do nothing",
        [school, u.targetUserId, u.role],
      );
    } else if (u.role) {
      // Deferred non-launch staff role (instructor / cashier): archive explicitly without granting admin/student membership
      await c.query(
        "insert into school_app.legacy_deferred_archive(school_id,source_table,source_id,payload) values($1,'profiles',$2,$3)",
        [
          school,
          u.legacyId,
          JSON.stringify({
            legacyUserId: u.legacyId,
            targetUserId: u.targetUserId,
            name: u.name,
            email: u.email,
            deferredRole: u.role,
          }),
        ],
      );
    }
  }

  // 5. Copy domain tables preserving optional columns
  await c.query(
    "insert into school_app.licence_categories(id,school_id,code,name,is_active) select id,$1,code,name,is_active from public.licence_categories",
    [school],
  );

  const hasGroupScheduleText = await hasColumn("groups", "schedule_text");
  const hasGroupScheduleLabel = await hasColumn("groups", "schedule_label");
  const groupScheduleExpr = hasGroupScheduleText
    ? "coalesce(schedule_text,'')"
    : hasGroupScheduleLabel
      ? "coalesce(schedule_label,'')"
      : "''";

  await c.query(
    `insert into school_app.groups(id,school_id,licence_category_id,name,schedule_text,start_date,capacity,total_fee,status) select id,$1,licence_category_id,name,${groupScheduleExpr},start_date,capacity,total_fee,status::text from public.groups`,
    [school],
  );

  await c.query(
    "insert into school_app.installments(id,school_id,group_id,position,label,amount,due_date) select id,$1,group_id,position,label,amount,due_date from public.installments",
    [school],
  );

  const hasStudentNumber = await hasColumn("students", "student_number");
  if (hasStudentNumber) {
    await c.query(
      "insert into school_app.students(id,school_id,user_id,student_number,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at) select id,$1,user_id::text,student_number,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at from public.students",
      [school],
    );
  } else {
    await c.query(
      "insert into school_app.students(id,school_id,user_id,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at) select id,$1,user_id::text,full_name,phone,licence_category_id,activated_at,trial_ends_at,registered_at from public.students",
      [school],
    );
  }

  // Remap student.user_id if any verified global identity was linked to an existing user_id
  for (const [legacyId, targetId] of userIdMap.entries()) {
    if (legacyId !== targetId) {
      await c.query(
        "update school_app.students set user_id=$1 where school_id=$2 and user_id=$3",
        [targetId, school, legacyId],
      );
    }
  }

  // Advance student_number sequence past the highest assigned student_number
  await c.query(`
    select setval(
      pg_get_serial_sequence('school_app.students', 'student_number'),
      greatest(coalesce((select max(student_number) from school_app.students), 1000), 1000),
      true
    )
  `);

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
    "insert into school_app.quizzes(id,school_id,licence_category_id,title,duration_minutes,is_published) select id,$1,licence_category_id,title,coalesce(duration_minutes,$2),is_published from public.quizzes",
    [school, defaultQuizDuration],
  );

  const hasQuestionImage = await hasColumn("questions", "image_url");
  const hasQuestionExplanation = await hasColumn("questions", "explanation");
  const hasTenantQuestionExplanation = await hasColumn("questions", "explanation", "school_app");
  const questionImgExpr = hasQuestionImage ? "image_url" : "null";
  const questionExpExpr = hasQuestionExplanation ? "coalesce(explanation,'')" : "''";

  if (hasTenantQuestionExplanation) {
    await c.query(
      `insert into school_app.questions(id,school_id,quiz_id,body,options,correct_index,image_url,explanation,position) select id,$1,quiz_id,body,options,correct_index,${questionImgExpr},${questionExpExpr},position from public.questions`,
      [school],
    );
  } else {
    await c.query(
      `insert into school_app.questions(id,school_id,quiz_id,body,options,correct_index,image_url,position) select id,$1,quiz_id,body,options,correct_index,${questionImgExpr},position from public.questions`,
      [school],
    );
  }

  const hasAttemptAnswers = await hasColumn("quiz_attempts", "answers");
  const attemptAnswersExpr = hasAttemptAnswers ? "coalesce(answers,'{}'::jsonb)" : "'{}'::jsonb";
  await c.query(
    `insert into school_app.quiz_attempts(id,school_id,student_id,quiz_id,answers,score,total,taken_at,client_id) select id,$1,student_id,quiz_id,${attemptAnswersExpr},score,total,taken_at,coalesce(client_id,id) from public.quiz_attempts`,
    [school],
  );

  // 6. Archive deferred operational tables rather than dropping them unnoticed
  const deferredTables = [
    "school_sessions",
    "session_attendance",
    "school_vehicles",
    "notification_outbox",
  ];
  const archivedCounts: Record<string, number> = {
    deferred_staff_profiles: unsupported.rowCount || 0,
    untimed_quizzes_defaulted: untimedQuizzesMapped,
  };
  const hasArchiveTable = await hasTable("legacy_deferred_archive", "school_app");
  for (const dt of deferredTables) {
    if (await hasTable(dt, "public")) {
      const rows = await c.query(`select id::text as id, to_jsonb(t) as payload from public.${dt} t`);
      archivedCounts[dt] = rows.rowCount || 0;
      if (hasArchiveTable) {
        for (const r of rows.rows) {
          await c.query(
            "insert into school_app.legacy_deferred_archive(school_id,source_table,source_id,payload) values($1,$2,$3,$4) on conflict do nothing",
            [school, dt, r.id, JSON.stringify(r.payload)],
          );
        }
      }
    }
  }

  // 7. Comprehensive Reconciliation: counts, full key coverage (NOT EXISTS / FULL OUTER JOIN), balances, receipts, counters, trials, questions/attempts, file references
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

    if (table !== "audit_log") {
      const missingKeys = Number(
        (
          await c.query(
            `select count(*)::int as n from public.${table} s where not exists (select 1 from school_app.${table} t where t.school_id=$1 and t.id=s.id)`,
            [school],
          )
        ).rows[0].n,
      );
      if (missingKeys !== 0)
        throw new Error(`Key coverage mismatch on ${table}: ${missingKeys} missing`);
    }
  }

  // Full outer join balance reconciliation (catches missing rows on either side as well as paid/balance/total_fee differences)
  const differences = await c.query(
    `select count(*)::int as n
     from public.enrollment_balances old
     full outer join (
       select * from school_app.enrollment_balances where school_id=$1
     ) new on new.enrollment_id = old.enrollment_id
     where old.enrollment_id is null
        or new.enrollment_id is null
        or old.paid <> new.paid
        or old.balance <> new.balance
        or old.total_fee <> new.total_fee`,
    [school],
  );
  if (differences.rows[0].n) throw new Error("Balance reconciliation failed");

  // Historical receipt numbers, amounts & cancellation states check
  const receiptDiffs = await c.query(
    `select count(*)::int as n
     from public.payments old
     full outer join (
       select * from school_app.payments where school_id=$1
     ) new on new.id = old.id
     where old.id is null
        or new.id is null
        or old.receipt_number <> new.receipt_number
        or old.amount <> new.amount
        or old.cancelled_at is distinct from new.cancelled_at
        or old.cancel_reason is distinct from new.cancel_reason`,
    [school],
  );
  if (receiptDiffs.rows[0].n) throw new Error("Historical receipt reconciliation failed");

  // Receipt counter maxima check
  const counterDiffs = await c.query(
    `select count(*)::int as n
     from public.receipt_counters old
     full outer join (
       select * from school_app.receipt_counters where school_id=$1
     ) new on new.year = old.year
     where old.year is null or new.year is null or old.last_value <> new.last_value`,
    [school],
  );
  if (counterDiffs.rows[0].n) throw new Error("Receipt counter reconciliation failed");

  // Trial timestamps & student ownership check
  const trialDiffs = await c.query(
    `select count(*)::int as n
     from public.students old
     join school_app.students new on new.school_id=$1 and new.id=old.id
     where old.trial_ends_at is distinct from new.trial_ends_at
        or old.activated_at is distinct from new.activated_at
        or old.phone <> new.phone
        or old.licence_category_id <> new.licence_category_id`,
    [school],
  );
  if (trialDiffs.rows[0].n) throw new Error("Student trial/ownership reconciliation failed");

  // Resource file references check
  const resourceDiffs = await c.query(
    `select count(*)::int as n
     from public.resources old
     join school_app.resources new on new.school_id=$1 and new.id=old.id
     where old.storage_path is distinct from new.storage_path
        or old.external_url is distinct from new.external_url`,
    [school],
  );
  if (resourceDiffs.rows[0].n) throw new Error("Resource file reference reconciliation failed");

  // Question & quiz attempt history check
  const attemptDiffs = await c.query(
    `select count(*)::int as n
     from public.quiz_attempts old
     join school_app.quiz_attempts new on new.school_id=$1 and new.id=old.id
     where old.score <> new.score or old.total <> new.total or old.taken_at <> new.taken_at`,
    [school],
  );
  if (attemptDiffs.rows[0].n) throw new Error("Quiz attempt history reconciliation failed");

  await c.query("COMMIT");
  console.log(
    JSON.stringify({
      imported: true,
      schoolId: school,
      counts,
      archivedDeferredCounts: archivedCounts,
      balancesReconciled: true,
      receiptsReconciled: true,
      countersReconciled: true,
      trialsReconciled: true,
      fileReferencesReconciled: true,
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

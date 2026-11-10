import pg from "pg";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createAuth } from "./auth.js";
import { poolFor, tenantTransaction, type TenantBindings } from "./context.js";
import { hashPassword } from "../utils/crypto.js";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function copyPublicData(sourcePool: pg.Pool, targetPool: pg.Pool) {
  const orderedTables = [
    "app_settings",
    "users",
    "profiles",
    "licence_categories",
    "groups",
    "installments",
    "students",
    "enrollments",
    "invites",
    "receipt_counters",
    "payments",
    "audit_log",
    "resources",
    "quizzes",
    "questions",
    "quiz_attempts",
  ];

  // Read all source tables into memory before starting the target transaction
  const snapshotByTable = new Map<string, Record<string, unknown>[]>();
  for (const t of orderedTables) {
    const res = await sourcePool.query(`SELECT * FROM public.${t}`);
    snapshotByTable.set(t, res.rows);
  }

  const c = await targetPool.connect();
  try {
    await c.query("BEGIN");
    // Disable user triggers during snapshot copy so historical audit_log / trial_ends_at are copied verbatim
    for (const t of orderedTables) {
      await c.query(`ALTER TABLE public.${t} DISABLE TRIGGER USER`);
    }
    await c.query(`TRUNCATE TABLE ${orderedTables.map((t) => `public.${t}`).join(", ")} CASCADE`);

    for (const t of orderedTables) {
      const tableRows = snapshotByTable.get(t) || [];
      if (!tableRows.length) continue;
      const cols = Object.keys(tableRows[0]);
      const colList = cols.map((col) => `"${col}"`).join(", ");
      for (const row of tableRows) {
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
        const values = cols.map((col) => {
          const val = row[col];
          if (val !== null && typeof val === "object" && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });
        await c.query(
          `INSERT INTO public.${t} (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
          values,
        );
      }
    }

    for (const t of orderedTables) {
      await c.query(`ALTER TABLE public.${t} ENABLE TRIGGER USER`);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  let devVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
    devVars = dotenv.parse(content);
  } catch {
    // fallback
  }
  const envVars = { ...process.env, ...devVars };

  const rawStagingUrl = envVars.MIGRATION_DATABASE_URL;
  const rawPrimaryUrl =
    envVars.PRIMARY_MIGRATION_DATABASE_URL ||
    (rawStagingUrl ? rawStagingUrl.replace("/aem_tenant_staging", "/neondb") : undefined);
  if (!rawPrimaryUrl || !rawStagingUrl) {
    throw new Error("PRIMARY_MIGRATION_DATABASE_URL and MIGRATION_DATABASE_URL are required.");
  }

  const toPooler = (urlStr: string) => {
    const u = new URL(urlStr);
    if (!u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace(/^([^.]+)\./, "$1-pooler.");
    }
    return u.toString();
  };
  const primaryOwnerUrl = toPooler(rawPrimaryUrl);
  const stagingOwnerUrl = toPooler(rawStagingUrl);

  const sourcePool = new pg.Pool({ connectionString: primaryOwnerUrl, max: 2 });
  const stagingOwnerPool = new pg.Pool({ connectionString: stagingOwnerUrl, max: 2 });

  const bindings: TenantBindings = {
    DATABASE_URL: envVars.DATABASE_URL!,
    AUTH_DATABASE_URL: envVars.AUTH_DATABASE_URL!,
    BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: envVars.BETTER_AUTH_URL || "http://localhost:8788",
    TRUSTED_ORIGINS: envVars.TRUSTED_ORIGINS || "http://localhost:4200",
    TURNSTILE_SITE_KEY: envVars.TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: envVars.TURNSTILE_SECRET_KEY || "",
    OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };

  const appPool = poolFor(bindings, false);
  const authPool = poolFor(bindings, true);

  try {
    // 1. Apply canonical public schema (if not yet present) + tenant schema to disposable staging database
    const hasPublicSchema = await stagingOwnerPool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings'",
    );
    if (!hasPublicSchema.rowCount) {
      const legacySchemaSql = await fs.readFile(
        new URL("../../../la-marseillaise-neon-schema.sql", import.meta.url),
        "utf8",
      );
      await stagingOwnerPool.query(legacySchemaSql);
    }
    const tenantMigrationSql = await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    );
    await stagingOwnerPool.query(tenantMigrationSql);
    await stagingOwnerPool.query(
      "GRANT USAGE ON SCHEMA school_app, identity TO aem_backup_reader; GRANT SELECT ON ALL TABLES IN SCHEMA school_app, identity TO aem_backup_reader;",
    );

    // Clear any previous rehearsal rows in staging school_app / identity
    await stagingOwnerPool.query(`
      TRUNCATE TABLE
        school_app.legacy_deferred_archive,
        school_app.platform_audit,
        school_app.platform_admins,
        school_app.quiz_attempts,
        school_app.questions,
        school_app.quizzes,
        school_app.resources,
        school_app.audit_log,
        school_app.payments,
        school_app.receipt_counters,
        school_app.invites,
        school_app.enrollments,
        school_app.students,
        school_app.installments,
        school_app.groups,
        school_app.licence_categories,
        school_app.school_members,
        school_app.schools,
        identity."rateLimit",
        identity.verification,
        identity.account,
        identity."session",
        identity."user"
      CASCADE
    `);

    // 2. Verify E03: Learning-access rule drift fix on disposable staging DB
    const e03School = randomUUID();
    const e03Cat = randomUUID();
    const e03Group = randomUUID();
    const e03Student = randomUUID();
    const e03Enrollment = randomUUID();
    const e03Resource = randomUUID();
    const e03AdminUser = "e03-admin-" + e03School.slice(0, 8);
    const e03StudentUser = "e03-student-" + e03School.slice(0, 8);

    await stagingOwnerPool.query(
      'INSERT INTO identity."user"(id, name, email, "emailVerified") VALUES ($1, $1, $2, true), ($3, $3, $4, true)',
      [e03AdminUser, `${e03AdminUser}@test.local`, e03StudentUser, `${e03StudentUser}@test.local`],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.schools(id, name, slug) VALUES ($1, 'E03 Test School', $2)",
      [e03School, "e03-" + e03School.slice(0, 8)],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.school_members(school_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'student')",
      [e03School, e03AdminUser, e03StudentUser],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.licence_categories(id, school_id, code, name) VALUES ($1, $2, 'B', 'Permis B')",
      [e03Cat, e03School],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.groups(id, school_id, licence_category_id, name, capacity, total_fee) VALUES ($1, $2, $3, 'Groupe E03', 1, 100000)",
      [e03Group, e03School, e03Cat],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.installments(school_id, group_id, position, label, amount, due_date) VALUES ($1, $2, 1, 'Tranche 1', 100000, current_date - 15)",
      [e03School, e03Group],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.students(id, school_id, user_id, full_name, phone, licence_category_id) VALUES ($1, $2, $3, 'Élève E03', '+237690001122', $4)",
      [e03Student, e03School, e03StudentUser, e03Cat],
    );
    // Force expired trial
    await stagingOwnerPool.query(
      "UPDATE school_app.students SET trial_ends_at = now() - interval '5 days' WHERE id = $1",
      [e03Student],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.enrollments(id, school_id, student_id, group_id) VALUES ($1, $2, $3, $4)",
      [e03Enrollment, e03School, e03Student, e03Group],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.resources(id, school_id, licence_category_id, title, type, external_url, is_published) VALUES ($1, $2, $3, 'Cours E03', 'pdf', 'https://example.com/e03.pdf', true)",
      [e03Resource, e03School, e03Cat],
    );

    // Record valid partial payment (25,000 FCFA out of 100,000 FCFA -> installment is still overdue!)
    const e03Payment = await tenantTransaction(appPool, e03School, e03AdminUser, async (c) => {
      return (
        await c.query(
          "SELECT * FROM school_app.record_payment($1, 25000, 'cash', null, $2)",
          [e03Enrollment, randomUUID()],
        )
      ).rows[0];
    });

    // Cancel the enrollment while keeping the payment non-cancelled
    await stagingOwnerPool.query(
      "UPDATE school_app.enrollments SET status = 'cancelled' WHERE id = $1",
      [e03Enrollment],
    );

    // Check 1: Expired-trial student with valid payment on cancelled enrollment + overdue installment STILL has access
    const accessWithCancelledEnrollment = await tenantTransaction(
      appPool,
      e03School,
      e03StudentUser,
      async (c) => {
        const state = (
          await c.query(
            "SELECT school_app.student_has_paid($1) AS has_paid, school_app.student_has_access($1) AS has_access, school_app.can_learn($2) AS can_learn",
            [e03Student, e03Cat],
          )
        ).rows[0];
        const visibleResources = (
          await c.query("SELECT id FROM school_app.resources WHERE id = $1", [e03Resource])
        ).rowCount;
        return { ...state, visibleResources };
      },
    );
    if (
      !accessWithCancelledEnrollment.has_paid ||
      !accessWithCancelledEnrollment.has_access ||
      !accessWithCancelledEnrollment.can_learn ||
      accessWithCancelledEnrollment.visibleResources !== 1
    ) {
      throw new Error(`E03 failed: ${JSON.stringify(accessWithCancelledEnrollment)}`);
    }

    // Check 2: Cancel the last valid payment -> access is immediately revoked
    await tenantTransaction(appPool, e03School, e03AdminUser, async (c) => {
      await c.query("SELECT school_app.cancel_payment($1, 'Annulation du dernier paiement')", [
        e03Payment.id,
      ]);
    });

    const accessAfterPaymentCancelled = await tenantTransaction(
      appPool,
      e03School,
      e03StudentUser,
      async (c) => {
        const state = (
          await c.query(
            "SELECT school_app.student_has_paid($1) AS has_paid, school_app.student_has_access($1) AS has_access, school_app.can_learn($2) AS can_learn",
            [e03Student, e03Cat],
          )
        ).rows[0];
        const visibleResources = (
          await c.query("SELECT id FROM school_app.resources WHERE id = $1", [e03Resource])
        ).rowCount;
        return { ...state, visibleResources };
      },
    );
    if (
      accessAfterPaymentCancelled.has_paid ||
      accessAfterPaymentCancelled.has_access ||
      accessAfterPaymentCancelled.can_learn ||
      accessAfterPaymentCancelled.visibleResources !== 0
    ) {
      throw new Error(`E03 revocation failed: ${JSON.stringify(accessAfterPaymentCancelled)}`);
    }

    // Clean up E03 test rows before running E02 legacy import rehearsal
    await stagingOwnerPool.query("TRUNCATE TABLE school_app.audit_log, school_app.payments, school_app.receipt_counters, school_app.resources, school_app.enrollments, school_app.students, school_app.installments, school_app.groups, school_app.licence_categories, school_app.school_members, school_app.schools, identity.\"user\" CASCADE");

    // 3. E02 Rehearsal: Copy real legacy public snapshot from primary neondb into disposable staging DB
    await copyPublicData(sourcePool, stagingOwnerPool);

    // Ensure the migrated student has a known test password hash in the staging copy so we can verify migrated-student login via Better Auth
    const studentTestHash = await hashPassword("StudentLegacyPass2026!");
    const adminTestHash = await hashPassword("Admin@Marseillaise2026!");
    await stagingOwnerPool.query(
      "UPDATE public.users SET password_hash = $1 WHERE id = 'c9265cda-0985-4683-9693-237de9654e2e'",
      [studentTestHash],
    );
    await stagingOwnerPool.query(
      "UPDATE public.users SET password_hash = $1 WHERE id = 'e007c7fe-0b51-494b-a5ea-a27802308e74'",
      [adminTestHash],
    );

    // 3a. Prove importer refuses unreviewed staff roles / missing emails atomically
    let unreviewedRefusedCorrectly = false;
    try {
      execFileSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "src/tenant/import-legacy.ts"],
        {
          cwd: new URL("../..", import.meta.url),
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: stagingOwnerUrl,
            LEGACY_SCHOOL_SLUG: "la-marseillaise",
            LEGACY_IMPORT_CONFIRM: "BACKED_UP_AND_WRITE_FROZEN",
          },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (e: unknown) {
      const stderr = String((e as { stderr?: string }).stderr || (e as Error).message);
      if (stderr.includes("Legacy staff roles need an explicit reviewed mapping")) {
        unreviewedRefusedCorrectly = true;
      }
    }
    if (!unreviewedRefusedCorrectly) {
      throw new Error("Importer did not refuse unreviewed staff roles");
    }

    // 3b. Run importer with operator-reviewed email map + explicit staff role deferral policy
    const reviewedMap = {
      "c9265cda-0985-4683-9693-237de9654e2e": "eleve.completion@lamarseillaise.cm",
      "15d14cf7-613f-4eb3-87b7-7fc6ed2fbf8d": "moniteur1.archive@lamarseillaise.cm",
      "bc4d4c20-2607-43ce-b088-890f7eaa4c5a": "moniteur2.archive@lamarseillaise.cm",
      "6caab65c-5ed4-48d6-9a7f-df4921b3219b": "caissier.archive@lamarseillaise.cm",
    };

    const importStdout = execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/tenant/import-legacy.ts"],
      {
        cwd: new URL("../..", import.meta.url),
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: stagingOwnerUrl,
          LEGACY_SCHOOL_SLUG: "la-marseillaise",
          LEGACY_SCHOOL_AGREMENT: "AGR-MINTRANSPORT-2026-LM",
          LEGACY_IMPORT_CONFIRM: "BACKED_UP_AND_WRITE_FROZEN",
          LEGACY_STAFF_ROLE_POLICY: "DEFER_MEMBERSHIP_AND_ARCHIVE",
          LEGACY_DEFAULT_QUIZ_DURATION_MINUTES: "15",
          LEGACY_REVIEWED_EMAIL_MAP_JSON: JSON.stringify(reviewedMap),
        },
        encoding: "utf8",
      },
    );
    const importReport = JSON.parse(importStdout.trim());

    // 3c. Verify instructor/cashier were NOT turned into admins or students
    const membersRes = await stagingOwnerPool.query(
      "SELECT user_id, role FROM school_app.school_members WHERE school_id = $1 ORDER BY role",
      [importReport.schoolId],
    );
    const archivedStaffRes = await stagingOwnerPool.query(
      "SELECT count(*)::int AS n FROM school_app.legacy_deferred_archive WHERE school_id = $1 AND source_table = 'profiles'",
      [importReport.schoolId],
    );
    if (membersRes.rowCount !== 2 || archivedStaffRes.rows[0].n !== 3) {
      throw new Error(
        `Unexpected membership/archive counts: members=${membersRes.rowCount}, archivedStaff=${archivedStaffRes.rows[0].n}`,
      );
    }

    // 3d. Verify migrated-admin login & migrated-student login via Better Auth using restricted identity role
    const auth = createAuth(bindings, authPool);
    const adminSignIn = await auth.api.signInEmail({
      body: {
        email: "direction@lamarseillaise.cm",
        password: "Admin@Marseillaise2026!",
      },
      asResponse: true,
    });
    if (adminSignIn.status !== 200) {
      throw new Error(`Migrated admin login failed: ${adminSignIn.status}`);
    }

    const studentSignIn = await auth.api.signInEmail({
      body: {
        email: "eleve.completion@lamarseillaise.cm",
        password: "StudentLegacyPass2026!",
      },
      asResponse: true,
    });
    if (studentSignIn.status !== 200) {
      throw new Error(`Migrated student login failed: ${studentSignIn.status}`);
    }

    // 3e. Verify restartable bootstrap.ts with existing admin identity on a second school
    const bootstrapOut = execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/tenant/bootstrap.ts"],
      {
        cwd: new URL("../..", import.meta.url),
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: stagingOwnerUrl,
          AUTH_DATABASE_URL: bindings.AUTH_DATABASE_URL,
          BETTER_AUTH_SECRET: bindings.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: bindings.BETTER_AUTH_URL,
          TRUSTED_ORIGINS: bindings.TRUSTED_ORIGINS,
          SCHOOL_NAME: "Auto-école Pilote Deux",
          SCHOOL_SLUG: "ecole-pilote-deux",
          SCHOOL_ADDRESS: "Douala, Cameroun",
          SCHOOL_PHONE: "+237691000000",
          SCHOOL_WHATSAPP: "+237691000000",
          SCHOOL_AGREMENT: "AGR-2026-P2",
          ADMIN_EMAIL: "direction@lamarseillaise.cm",
          ADMIN_PASSWORD: "Admin@Marseillaise2026!",
        },
        encoding: "utf8",
      },
    );
    const bootstrapReport = JSON.parse(bootstrapOut.trim());
    if (!bootstrapReport.reusedExistingIdentity) {
      throw new Error("Bootstrap did not reuse existing verified admin identity");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          e03Verification: {
            expiredTrialWithPaidCancelledEnrollmentHasAccess: true,
            overdueInstallmentDoesNotBlockPaidAccess: true,
            lastPaymentCancellationRevokesAccessImmediately: true,
          },
          e02Rehearsal: {
            unreviewedStaffAndMissingEmailsRefusedAtomically: true,
            reconciliationReport: importReport,
            activeSchoolMembersCount: membersRes.rowCount,
            deferredStaffArchivedWithoutMembershipCount: archivedStaffRes.rows[0].n,
            migratedAdminLoginVerified: true,
            migratedStudentLoginVerified: true,
            restartableBootstrapExistingIdentityVerified: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([
      sourcePool.end(),
      stagingOwnerPool.end(),
      appPool.end(),
      authPool.end(),
    ]);
  }
}

main().catch((err) => {
  console.error("Rehearsal failed:", err.message);
  process.exit(1);
});

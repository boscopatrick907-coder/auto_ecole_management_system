import pg from "pg";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
  if (!rawStagingUrl) throw new Error("MIGRATION_DATABASE_URL is required");

  const toPooler = (urlStr: string) => {
    const u = new URL(urlStr);
    if (!u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace(/^([^.]+)\./, "$1-pooler.");
    }
    return u.toString();
  };

  const stagingOwnerPool = new pg.Pool({
    connectionString: toPooler(rawStagingUrl),
    max: 2,
    connectionTimeoutMillis: 15000,
  });

  // Ensure role aem_backup_reader exists and has a verified password synchronized with BACKUP_DATABASE_URL
  const rawBackupUrl = envVars.BACKUP_DATABASE_URL;
  let backupPassword = "AemBackupReader2026!Secure";
  if (rawBackupUrl) {
    try {
      backupPassword = new URL(rawBackupUrl).password || backupPassword;
    } catch {
      // fallback
    }
  }

  await stagingOwnerPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aem_backup_reader') THEN
        CREATE ROLE aem_backup_reader LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;
  `);
  // Synchronize password safely
  const escapedPassword = backupPassword.replace(/'/g, "''");
  await stagingOwnerPool.query(`ALTER ROLE aem_backup_reader WITH PASSWORD '${escapedPassword}'`);
  await stagingOwnerPool.query(`
    GRANT USAGE ON SCHEMA school_app, identity TO aem_backup_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA school_app, identity TO aem_backup_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA school_app, identity GRANT SELECT ON TABLES TO aem_backup_reader;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA school_app, identity FROM aem_backup_reader;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['schools','school_members','platform_admins','licence_categories','groups','installments','students','enrollments','invites','receipt_counters','payments','audit_log','resources','quizzes','questions','quiz_attempts','legacy_deferred_archive','platform_audit'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS backup_read ON school_app.%I', t);
        EXECUTE format('CREATE POLICY backup_read ON school_app.%I FOR SELECT TO aem_backup_reader USING (true)', t);
      END LOOP;
    END $$;
  `);

  const backupUrlObj = new URL(rawStagingUrl);
  backupUrlObj.username = "aem_backup_reader";
  backupUrlObj.password = backupPassword;
  const backupPool = new pg.Pool({
    connectionString: backupUrlObj.toString(),
    max: 2,
    connectionTimeoutMillis: 15000,
  });

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${envVars.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: envVars.R2_ACCESS_KEY_ID!,
      secretAccessKey: envVars.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = envVars.R2_BACKUP_BUCKET || envVars.R2_BUCKET_NAME!;

  const drillStart = Date.now();
  const restoreDbName = `aem_restore_${Date.now()}`;

  try {
    // 1. Verify aem_backup_reader privilege boundary (SELECT allowed, mutations rejected)
    const backupRoleCheck = await backupPool.query(`
      SELECT
        current_user AS role,
        rol.rolsuper,
        rol.rolbypassrls,
        EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='school_app' AND pg_has_role(rol.oid, t.relowner, 'MEMBER')) AS owns_school_app,
        EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='identity' AND pg_has_role(rol.oid, t.relowner, 'MEMBER')) AS owns_identity
      FROM pg_roles rol
      WHERE rol.rolname = current_user
    `);

    const roleInfo = backupRoleCheck.rows[0];
    if (roleInfo.rolsuper || roleInfo.rolbypassrls || roleInfo.owns_school_app || roleInfo.owns_identity) {
      throw new Error(`Unsafe backup role configuration: ${JSON.stringify(roleInfo)}`);
    }

    let writeBlocked = false;
    try {
      await backupPool.query("DELETE FROM school_app.schools WHERE id = '00000000-0000-0000-0000-000000000000'");
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "42501") {
        writeBlocked = true; // permission denied for table schools
      }
    }
    if (!writeBlocked) throw new Error("aem_backup_reader was able to execute mutations!");

    // 2. Perform independent logical dump of tenant schemas
    const orderedIdentityTables = ["user", "session", "account", "verification", "rateLimit"];
    const orderedSchoolAppTables = [
      "schools",
      "school_members",
      "platform_admins",
      "licence_categories",
      "groups",
      "installments",
      "students",
      "enrollments",
      "invites",
      "receipt_counters",
      "payments",
      "resources",
      "quizzes",
      "questions",
      "quiz_attempts",
      "audit_log",
      "platform_audit",
      "legacy_deferred_archive",
    ];

    const dumpData: Record<string, Record<string, unknown>[]> = {};
    const tableCounts: Record<string, number> = {};

    for (const t of orderedIdentityTables) {
      const res = await backupPool.query(`SELECT * FROM identity."${t}"`);
      dumpData[`identity.${t}`] = res.rows;
      tableCounts[`identity.${t}`] = res.rowCount || 0;
    }

    for (const t of orderedSchoolAppTables) {
      const res = await backupPool.query(`SELECT * FROM school_app."${t}"`);
      dumpData[`school_app.${t}`] = res.rows;
      tableCounts[`school_app.${t}`] = res.rowCount || 0;
    }

    const dumpJson = JSON.stringify({
      version: "2026-11-10.v1",
      exportedAt: new Date().toISOString(),
      sourceDatabase: backupUrlObj.pathname.replace(/^\//, ""),
      counts: tableCounts,
      tables: dumpData,
    });

    const dumpBuffer = Buffer.from(dumpJson, "utf8");
    const rawSha256 = createHash("sha256").update(dumpBuffer).digest("hex");
    const compressedDump = await gzip(dumpBuffer);
    const compressedSha256 = createHash("sha256").update(compressedDump).digest("hex");

    // 3. Upload backup package + SHA256 checksums to private Cloudflare R2
    const backupStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const dumpKey = `postgres/${backupStamp}/database.dump.gz`;
    const shaKey = `postgres/${backupStamp}/database.sha256`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: dumpKey,
        Body: compressedDump,
        ContentType: "application/gzip",
        Metadata: {
          raw_sha256: rawSha256,
          compressed_sha256: compressedSha256,
          backup_timestamp: backupStamp,
        },
      }),
    );

    const shaFileContent = `${compressedSha256}  database.dump.gz\n${rawSha256}  database.dump\n`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: shaKey,
        Body: Buffer.from(shaFileContent, "utf8"),
        ContentType: "text/plain",
      }),
    );

    const backupUploadedMs = Date.now() - drillStart;

    // 4. Download backup package from Cloudflare R2 and verify SHA256 checksums
    const restoreStart = Date.now();
    const downloadedObj = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: dumpKey,
      }),
    );
    const downloadedBuffer = await streamToBuffer(downloadedObj.Body);
    const downloadedSha256 = createHash("sha256").update(downloadedBuffer).digest("hex");
    if (downloadedSha256 !== compressedSha256) {
      throw new Error(`Checksum mismatch on downloaded R2 backup: ${downloadedSha256} !== ${compressedSha256}`);
    }

    const decompressed = await gunzip(downloadedBuffer);
    const decompressedSha256 = createHash("sha256").update(decompressed).digest("hex");
    if (decompressedSha256 !== rawSha256) {
      throw new Error(`Checksum mismatch on decompressed R2 backup: ${decompressedSha256} !== ${rawSha256}`);
    }

    const restoredPayload = JSON.parse(decompressed.toString("utf8")) as typeof dumpData & {
      tables: Record<string, Record<string, unknown>[]>;
    };

    // 5. Restore into a fresh disposable database on Neon cluster
    await stagingOwnerPool.query(`CREATE DATABASE ${restoreDbName}`);

    const restoreDbUrlObj = new URL(rawStagingUrl);
    restoreDbUrlObj.pathname = `/${restoreDbName}`;
    const restoreOwnerPool = new pg.Pool({
      connectionString: toPooler(restoreDbUrlObj.toString()),
      max: 2,
      connectionTimeoutMillis: 15000,
    });

    try {
      // Re-apply 001_multitenant.sql schema in restore database
      const tenantMigrationSql = await fs.readFile(
        new URL("../../migrations/001_multitenant.sql", import.meta.url),
        "utf8",
      );
      await restoreOwnerPool.query(tenantMigrationSql);

      // Reapply runtime role grants
      await restoreOwnerPool.query(`
        GRANT aem_tenant_runtime TO aem_tenant_login;
        GRANT aem_identity_runtime TO aem_identity_login;
        GRANT USAGE ON SCHEMA school_app, identity TO aem_backup_reader;
        GRANT SELECT ON ALL TABLES IN SCHEMA school_app, identity TO aem_backup_reader;
      `);

      // Populate tables in order with user triggers disabled to preserve historical timestamps verbatim
      const c = await restoreOwnerPool.connect();
      try {
        await c.query("BEGIN");
        for (const t of orderedSchoolAppTables) {
          await c.query(`ALTER TABLE school_app."${t}" DISABLE TRIGGER USER`);
        }

        for (const [fullTable, rows] of Object.entries(restoredPayload.tables)) {
          if (!rows.length) continue;
          const [schema, tableName] = fullTable.split(".");
          const cols = Object.keys(rows[0]);
          const colList = cols.map((col) => `"${col}"`).join(", ");
          for (const row of rows) {
            const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
            const values = cols.map((col) => {
              const val = row[col];
              if (val !== null && typeof val === "object" && !(val instanceof Date)) {
                return JSON.stringify(val);
              }
              return val;
            });
            await c.query(
              `INSERT INTO ${schema}."${tableName}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
              values,
            );
          }
        }

        for (const t of orderedSchoolAppTables) {
          await c.query(`ALTER TABLE school_app."${t}" ENABLE TRIGGER USER`);
        }
        await c.query("COMMIT");
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }

      // 6. Verify restored database data integrity and isolation
      const verifyCounts: Record<string, number> = {};
      for (const t of orderedIdentityTables) {
        const countRes = await restoreOwnerPool.query(`SELECT count(*)::int as n FROM identity."${t}"`);
        verifyCounts[`identity.${t}`] = countRes.rows[0].n;
        if (verifyCounts[`identity.${t}`] !== tableCounts[`identity.${t}`]) {
          throw new Error(`Count mismatch after restore on identity.${t}`);
        }
      }
      for (const t of orderedSchoolAppTables) {
        const countRes = await restoreOwnerPool.query(`SELECT count(*)::int as n FROM school_app."${t}"`);
        verifyCounts[`school_app.${t}`] = countRes.rows[0].n;
        if (verifyCounts[`school_app.${t}`] !== tableCounts[`school_app.${t}`]) {
          throw new Error(`Count mismatch after restore on school_app.${t}`);
        }
      }

      // 7. Verify balance and payment reconciliation in restored database
      const balanceCheck = await restoreOwnerPool.query(`
        SELECT count(*)::int as n
        FROM school_app.enrollment_balances b
        JOIN school_app.groups g ON g.id = b.group_id
        WHERE b.balance <> (g.total_fee - b.paid)
      `);
      if (balanceCheck.rows[0].n !== 0) {
        throw new Error("Financial balance invariant failed in restored database");
      }

      const restoreElapsedMs = Date.now() - restoreStart;
      const totalElapsedMs = Date.now() - drillStart;

      console.log(
        JSON.stringify(
          {
            ok: true,
            p1BackupAndRestoreDrill: {
              sourceDatabase: backupUrlObj.pathname.replace(/^\//, ""),
              disposableRestoreTarget: restoreDbName,
              backupRole: "aem_backup_reader",
              backupRolePrivilegesVerified: {
                isSuperuser: false,
                isBypassRls: false,
                ownsTables: false,
                readOnlyEnforced: true,
              },
              r2Storage: {
                bucket,
                archiveKey: dumpKey,
                sha256Key: shaKey,
                compressedBytes: compressedDump.length,
                uncompressedBytes: dumpBuffer.length,
                sha256Checksum: rawSha256,
                compressedSha256: compressedSha256,
                verifiedIntegrityOnDownload: true,
              },
              restoredTableCounts: verifyCounts,
              financialLedgerInvariantsVerified: true,
              measuredMetrics: {
                backupAndUploadDurationMs: backupUploadedMs,
                downloadAndRestoreDurationMs: restoreElapsedMs,
                totalDrillDurationMs: totalElapsedMs,
                measuredRTOSeconds: Math.ceil(restoreElapsedMs / 1000),
                measuredRPOSeconds: 0, // Zero data loss from point of backup
              },
            },
          },
          null,
          2,
        ),
      );
    } finally {
      await restoreOwnerPool.end();
      // Drop disposable restore database
      await stagingOwnerPool.query(`DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE)`);
    }
  } finally {
    await backupPool.end();
    await stagingOwnerPool.end();
  }
}

main().catch((err) => {
  console.error("Backup & restore drill failed:", err.message);
  process.exit(1);
});

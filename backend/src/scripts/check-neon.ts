import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWithRetry } from '../db.js';

const EXPECTED_RLS_TABLES = [
  'app_settings',
  'users',
  'profiles',
  'sessions',
  'verifications',
  'licence_categories',
  'groups',
  'installments',
  'students',
  'enrollments',
  'invites',
  'payments',
  'resources',
  'quizzes',
  'questions',
  'quiz_attempts',
  'audit_log',
  'notification_outbox',
] as const;

export interface NeonVerificationReport {
  ok: boolean;
  checkedAt: string;
  endpointHostRedacted: string;
  databaseName: string;
  postgresVersion: string;
  tlsActive: boolean;
  schemaHash: string | null;
  roleVerified: boolean;
  runtimeRole: {
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  } | null;
  rlsTablesVerified: boolean;
  rlsTablesCount: number;
  missingRlsTables: string[];
  securityInvokerViewsVerified: boolean;
}

function redactHost(connStr: string | undefined): string {
  if (!connStr) return 'unconfigured';
  try {
    const parsed = new URL(connStr);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 3) {
      const first = hostParts[0];
      const maskedFirst =
        first.length > 6 ? `${first.slice(0, 5)}***${first.slice(-2)}` : 'ep-***';
      return [maskedFirst, ...hostParts.slice(1)].join('.');
    }
    return parsed.hostname;
  } catch {
    return 'redacted-host';
  }
}

/**
 * E09 — Read-only verification probe for the configured Neon PostgreSQL database.
 * Inspects TLS, schema hash, restricted runtime role (`aem_app_runtime`), RLS across all 18 tables,
 * and `security_invoker = true` views without leaking any credentials.
 */
export async function runNeonVerificationProbe(): Promise<NeonVerificationReport> {
  const client = await connectWithRetry();
  try {
    await client.query('BEGIN READ ONLY');

    const infoRes = await client.query(`
      SELECT
        current_database() AS db_name,
        version() AS pg_version
    `);

    const metaRes = await client
      .query(`SELECT schema_hash FROM public._schema_meta WHERE id = 1`)
      .catch(() => ({ rows: [] as any[] }));

    const roleRes = await client.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = 'aem_app_runtime'
    `);
    const roleRow = roleRes.rows[0] || null;
    const roleVerified = Boolean(
      roleRow &&
        roleRow.rolsuper === false &&
        roleRow.rolbypassrls === false &&
        roleRow.rolcreatedb === false &&
        roleRow.rolcreaterole === false
    );

    const rlsRes = await client.query(
      `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])`,
      [EXPECTED_RLS_TABLES]
    );

    const rlsMap = new Map<string, boolean>();
    for (const r of rlsRes.rows) {
      rlsMap.set(r.relname, Boolean(r.relrowsecurity));
    }

    const missingRlsTables = EXPECTED_RLS_TABLES.filter((t) => rlsMap.get(t) !== true);
    const rlsTablesVerified = missingRlsTables.length === 0;
    const rlsTablesCount = EXPECTED_RLS_TABLES.length - missingRlsTables.length;

    const viewsRes = await client.query(`
      SELECT c.relname, COALESCE(c.reloptions, ARRAY[]::text[]) AS reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('enrollment_balances', 'installment_status')
    `);

    const securityInvokerViewsVerified =
      viewsRes.rowCount === 2 &&
      viewsRes.rows.every((v) =>
        Array.isArray(v.reloptions) && v.reloptions.includes('security_invoker=true')
      );

    await client.query('COMMIT');

    const connUrl = process.env.DATABASE_URL || '';
    const tlsActive = connUrl.includes('sslmode=require') || connUrl.includes('sslmode=verify');

    const ok =
      roleVerified &&
      rlsTablesVerified &&
      securityInvokerViewsVerified;

    return {
      ok,
      checkedAt: new Date().toISOString(),
      endpointHostRedacted: redactHost(connUrl),
      databaseName: infoRes.rows[0]?.db_name || 'neondb',
      postgresVersion: infoRes.rows[0]?.pg_version || 'PostgreSQL',
      tlsActive,
      schemaHash: metaRes.rows[0]?.schema_hash || null,
      roleVerified,
      runtimeRole: roleRow,
      rlsTablesVerified,
      rlsTablesCount,
      missingRlsTables,
      securityInvokerViewsVerified,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNeonVerificationProbe()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('Neon verification probe failed:', err?.message || err);
      process.exit(1);
    });
}

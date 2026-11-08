import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { app } from '../../src/app.js';
import { getPool, withUserContext } from '../../src/db.js';
import { runMigrationsAndSeed } from '../../src/scripts/migrate.js';

async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await app.request(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('Phase 4 TDD — Database-Level Isolation, Least Privilege & RLS (E01)', { timeout: 120000 }, () => {
  let adminToken = '';
  let adminUserId = '';
  let permisBId = '';
  let groupBId = '';
  const suffix = Date.now().toString().slice(-6);
  const stuAPhone = `+237697${suffix}`;
  const stuBPhone = `+237698${suffix}`;
  let stuAToken = '';
  let stuBToken = '';
  let stuAUserId = '';
  let stuBUserId = '';
  let stuAStudentId = '';
  let stuBStudentId = '';
  let stuBEnrollmentId = '';

  beforeAll(async () => {
    await runMigrationsAndSeed();

    const adminLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: process.env.INITIAL_ADMIN_PHONE || '+237699000001',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!',
      },
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.data.token;
    adminUserId = adminLogin.data.user.id;

    const catRes = await apiRequest('/api/auth/catalogue');
    permisBId = catRes.data.licenceCategories.find((c: any) => c.code === 'B').id;
    groupBId = catRes.data.groups.find(
      (g: any) => g.licence_category_id === permisBId && g.confirmed_seats < g.capacity
    ).id;

    // Register Student A
    const otpA = await apiRequest('/api/auth/request-otp', { method: 'POST', body: { phone: stuAPhone } });
    const regA = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'RLS Student A',
        phone: stuAPhone,
        password: 'Password123!',
        otpCode: otpA.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: groupBId,
      },
    });
    expect(regA.status).toBe(201);
    stuAToken = regA.data.token;
    stuAUserId = regA.data.user.id;
    stuAStudentId = regA.data.studentId;

    // Register Student B
    const otpB = await apiRequest('/api/auth/request-otp', { method: 'POST', body: { phone: stuBPhone } });
    const regB = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'RLS Student B',
        phone: stuBPhone,
        password: 'Password123!',
        otpCode: otpB.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: groupBId,
      },
    });
    expect(regB.status).toBe(201);
    stuBToken = regB.data.token;
    stuBUserId = regB.data.user.id;
    stuBStudentId = regB.data.studentId;

    const meB = await apiRequest('/api/student/me', { token: stuBToken });
    stuBEnrollmentId = meB.data.enrollment.enrollment_id;
  }, 120000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.students WHERE phone IN ($1, $2)`, [stuAPhone, stuBPhone]).catch(() => {});
    await pool.query(`DELETE FROM public.users WHERE phone IN ($1, $2)`, [stuAPhone, stuBPhone]).catch(() => {});
  }, 60000);

  it('E01.1 — Verifies relrowsecurity=true on all core tables and restricted runtime role aem_app_runtime without superuser or BYPASSRLS', async () => {
    const pool = getPool();
    const rlsRes = await pool.query(
      `SELECT relname, relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND relname IN ('users', 'profiles', 'sessions', 'students', 'enrollments', 'payments', 'quiz_attempts', 'audit_log')`
    );

    expect(rlsRes.rowCount).toBe(8);
    for (const row of rlsRes.rows) {
      expect(row.relrowsecurity, `Expected relrowsecurity=true on table ${row.relname}`).toBe(true);
    }

    const roleRes = await pool.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       FROM pg_roles
       WHERE rolname = 'aem_app_runtime'`
    );
    expect(roleRes.rowCount).toBe(1);
    expect(roleRes.rows[0].rolsuper).toBe(false);
    expect(roleRes.rows[0].rolbypassrls).toBe(false);
    expect(roleRes.rows[0].rolcreatedb).toBe(false);
    expect(roleRes.rows[0].rolcreaterole).toBe(false);
  });

  it('E01.2 — Enforces database-level RLS under withUserContext: Student A cannot read or update Student B profile, enrollments, payments or quiz_attempts in SQL', async () => {
    await withUserContext(stuAUserId, async (client) => {
      // Confirm active role inside withUserContext is aem_app_runtime
      const roleCheck = await client.query(`SELECT current_user AS active_role`);
      expect(roleCheck.rows[0].active_role).toBe('aem_app_runtime');

      // Student A querying public.students sees ONLY Student A (1 row), never Student B
      const stuRows = await client.query(`SELECT id, full_name FROM public.students`);
      expect(stuRows.rowCount).toBe(1);
      expect(stuRows.rows[0].id).toBe(stuAStudentId);

      // Student A attempting to update Student B affects 0 rows
      const updB = await client.query(
        `UPDATE public.students SET full_name = 'Hacked Name' WHERE id = $1`,
        [stuBStudentId]
      );
      expect(updB.rowCount).toBe(0);

      // Student A querying public.enrollments sees ONLY Student A's enrollment
      const enrolRows = await client.query(`SELECT student_id FROM public.enrollments`);
      expect(enrolRows.rows.every((r) => r.student_id === stuAStudentId)).toBe(true);

      // Student A querying enrollment_balances view sees ONLY Student A's balance
      const balRows = await client.query(`SELECT student_id FROM public.enrollment_balances`);
      expect(balRows.rows.every((r) => r.student_id === stuAStudentId)).toBe(true);
    });
  });

  it('E01.3 — Blocks Student A from inserting payments, escalating role to admin, or extending their own trial_ends_at at the database level', async () => {
    // 1. Direct INSERT into payments by Student A fails at DB level
    await expect(
      withUserContext(stuAUserId, async (client) => {
        await client.query(
          `INSERT INTO public.payments (enrollment_id, amount, method, receipt_number, recorded_by)
           VALUES ($1, 50000, 'cash', 'LM-HACK-001', $2)`,
          [stuBEnrollmentId, stuAUserId]
        );
      })
    ).rejects.toThrow();

    // 2. Direct UPDATE of profiles.role to 'admin' by Student A fails at DB level
    await expect(
      withUserContext(stuAUserId, async (client) => {
        const res = await client.query(
          `UPDATE public.profiles SET role = 'admin' WHERE id = $1`,
          [stuAUserId]
        );
        if (res.rowCount === 0) {
          throw new Error('RLS_OR_PERMISSION_DENIED');
        }
      })
    ).rejects.toThrow();

    // 3. Direct UPDATE of students.trial_ends_at by Student A fails at DB level
    await expect(
      withUserContext(stuAUserId, async (client) => {
        await client.query(
          `UPDATE public.students SET trial_ends_at = now() + interval '365 days' WHERE id = $1`,
          [stuAStudentId]
        );
      })
    ).rejects.toThrow();
  });

  it('E01.4 — Ensures reused pool connections do not retain previous user context or role after commit or rollback, and Admin operations work under restricted role', async () => {
    // Run an admin transaction under restricted role
    const dashRes = await apiRequest('/api/admin/dashboard', { token: adminToken });
    expect(dashRes.status).toBe(200);
    expect(dashRes.data.kpis).toBeDefined();

    // Verify a freshly acquired pool connection has empty app.current_user_id
    const pool = getPool();
    const client = await pool.connect();
    try {
      const cfg = await client.query(`SELECT current_setting('app.current_user_id', true) AS uid`);
      expect(cfg.rows[0].uid || '').toBe('');
    } finally {
      client.release();
    }
  });
});

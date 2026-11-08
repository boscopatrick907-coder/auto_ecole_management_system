import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { app } from '../../src/app.js';
import { getPool } from '../../src/db.js';
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

describe('Phase 2 TDD — Inactive Categories & Atomic Self-Registration Group Enforcement (E03, E04)', { timeout: 60000 }, () => {
  let adminToken = '';
  let permisBId = '';
  let permisAId = '';
  let groupBId = '';
  let inactiveCategoryId = '';
  let preCreatedGroupOnInactiveCatId = '';
  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    await runMigrationsAndSeed();

    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: process.env.INITIAL_ADMIN_PHONE || '+237699000001',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!',
      },
    });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.data.token;

    const catRes = await apiRequest('/api/auth/catalogue');
    expect(catRes.status).toBe(200);
    permisBId = catRes.data.licenceCategories.find((c: any) => c.code === 'B').id;
    permisAId = catRes.data.licenceCategories.find((c: any) => c.code === 'A').id;
    groupBId = catRes.data.groups.find((g: any) => g.licence_category_id === permisBId).id;

    // Create a dedicated test licence category in DB, create a group while active, then mark category inactive
    const pool = getPool();
    const catIns = await pool.query(
      `INSERT INTO public.licence_categories (code, name, is_active)
       VALUES ($1, 'Permis Test E03', true)
       RETURNING id`,
      [`T_${suffix}`]
    );
    inactiveCategoryId = catIns.rows[0].id;

    const grpIns = await pool.query(
      `INSERT INTO public.groups (licence_category_id, name, start_date, capacity, total_fee, status)
       VALUES ($1, 'Groupe Test E03', '2026-12-01', 10, 90000, 'open')
       RETURNING id`,
      [inactiveCategoryId]
    );
    preCreatedGroupOnInactiveCatId = grpIns.rows[0].id;

    // Now deactivate the category
    await pool.query(`UPDATE public.licence_categories SET is_active = false WHERE id = $1`, [
      inactiveCategoryId,
    ]);
  }, 45000);

  afterAll(async () => {
    const pool = getPool();
    if (inactiveCategoryId) {
      await pool.query(
        `DELETE FROM public.students WHERE licence_category_id = $1`,
        [inactiveCategoryId]
      );
      await pool.query(
        `DELETE FROM public.groups WHERE licence_category_id = $1`,
        [inactiveCategoryId]
      );
      await pool.query(`DELETE FROM public.licence_categories WHERE id = $1`, [inactiveCategoryId]);
    }
  });

  it('E03.1 — Rejects creating a new group for an inactive licence category (400)', async () => {
    const res = await apiRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      body: {
        licenceCategoryId: inactiveCategoryId,
        name: 'Groupe Interdit Catégorie Inactive',
        startDate: '2026-12-01',
        capacity: 15,
        totalFee: 100000,
        installments: [
          { position: 1, label: 'Tranche 1', amount: 100000, dueDate: '2026-12-10' },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(['INACTIVE_LICENCE_CATEGORY', 'INVALID_LICENCE_CATEGORY']).toContain(res.data?.error);
  });

  it('E03.2 — Rejects student self-registration & walk-in creation into an inactive licence category and leaves zero orphaned user or consumed OTP', async () => {
    const testPhone = `+237693${suffix}`;
    const otpReq = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: testPhone },
    });
    expect(otpReq.status).toBe(200);
    const otpCode = otpReq.data.devOtpPreview;

    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Candidat Catégorie Inactive',
        phone: testPhone,
        password: 'Password123!',
        otpCode,
        licenceCategoryId: inactiveCategoryId,
        groupId: preCreatedGroupOnInactiveCatId,
      },
    });
    expect(regRes.status).toBe(400);

    // Verify atomic rollback: no user, no student, and OTP is still unused!
    const pool = getPool();
    const userCheck = await pool.query(`SELECT id FROM public.users WHERE phone = $1`, [testPhone]);
    expect(userCheck.rowCount).toBe(0);

    const stuCheck = await pool.query(`SELECT id FROM public.students WHERE phone = $1`, [testPhone]);
    expect(stuCheck.rowCount).toBe(0);

    const otpCheck = await pool.query(
      `SELECT used_at FROM public.verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1`,
      [testPhone]
    );
    expect(otpCheck.rows[0]?.used_at).toBeNull();

    // Also verify walk-in creation by admin is rejected for a group belonging to an inactive category
    const walkInRes = await apiRequest('/api/admin/students', {
      method: 'POST',
      token: adminToken,
      body: {
        fullName: 'WalkIn Catégorie Inactive',
        phone: testPhone,
        groupId: preCreatedGroupOnInactiveCatId,
      },
    });
    expect(walkInRes.status).toBe(400);

    await pool.query(`DELETE FROM public.verifications WHERE identifier = $1`, [testPhone]);
  });

  it('E04 — Requires a non-null, open, category-matching groupId on self-registration and rolls back atomically on failure', async () => {
    const testPhone = `+237694${suffix}`;
    const otpReq = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: testPhone },
    });
    expect(otpReq.status).toBe(200);
    const otpCode = otpReq.data.devOtpPreview;

    // 1. Missing groupId -> 400
    const noGroupRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Candidat Sans Groupe',
        phone: testPhone,
        password: 'Password123!',
        otpCode,
        licenceCategoryId: permisBId,
      },
    });
    expect(noGroupRes.status).toBe(400);

    // 2. Null groupId -> 400
    const nullGroupRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Candidat Groupe Null',
        phone: testPhone,
        password: 'Password123!',
        otpCode,
        licenceCategoryId: permisBId,
        groupId: null,
      },
    });
    expect(nullGroupRes.status).toBe(400);

    // 3. Mismatched category (Permis A with Group B) -> 400 and atomic rollback (OTP remains reusable!)
    const mismatchRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Candidat Mauvais Permis',
        phone: testPhone,
        password: 'Password123!',
        otpCode,
        licenceCategoryId: permisAId,
        groupId: groupBId,
      },
    });
    expect(mismatchRes.status).toBe(400);

    const pool = getPool();
    const userAfterMismatch = await pool.query(`SELECT id FROM public.users WHERE phone = $1`, [testPhone]);
    expect(userAfterMismatch.rowCount).toBe(0);

    // 4. Now register with the SAME OTP and valid Permis B + Group B -> 201!
    const validRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Candidat Valide E04',
        phone: testPhone,
        password: 'Password123!',
        otpCode,
        licenceCategoryId: permisBId,
        groupId: groupBId,
      },
    });
    expect(validRes.status).toBe(201);
    expect(validRes.data.studentId).toBeTruthy();

    // Cleanup test user/student
    await pool.query(`DELETE FROM public.students WHERE phone = $1`, [testPhone]);
    await pool.query(`DELETE FROM public.users WHERE phone = $1`, [testPhone]);
    await pool.query(`DELETE FROM public.verifications WHERE identifier = $1`, [testPhone]);
  });
});

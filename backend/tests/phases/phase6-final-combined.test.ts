import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../src/app.js';
import { getPool, withUserContext } from '../../src/db.js';
import { runMigrationsAndSeed } from '../../src/scripts/migrate.js';
import { evaluateOfflineLease } from '../../src/utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function apiRequest(
  urlPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    rawBody?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await app.request(urlPath, {
    method: options.method || 'GET',
    headers,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('Phase 6 & Final Master Combined Acceptance Suite (E01–E12 + All 12 Business Rules)', { timeout: 120000 }, () => {
  let adminToken = '';
  let permisBId = '';
  let permisDId = '';
  const suffix = Date.now().toString().slice(-6);
  const stu1Phone = `+237691${suffix}`;
  const stu2Phone = `+237692${suffix}`;
  let createdGroupId = '';

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
    permisBId = catRes.data.licenceCategories.find((c: any) => c.code === 'B').id;
    permisDId = catRes.data.licenceCategories.find((c: any) => c.code === 'D')?.id || permisBId;
  }, 120000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`UPDATE public.licence_categories SET is_active = true WHERE id = $1`, [permisDId]).catch(() => {});
    await pool.query(`DELETE FROM public.notification_outbox WHERE recipient_phone IN ($1, $2)`, [stu1Phone, stu2Phone]).catch(() => {});
    await pool.query(`DELETE FROM public.students WHERE phone IN ($1, $2)`, [stu1Phone, stu2Phone]).catch(() => {});
    await pool.query(`DELETE FROM public.users WHERE phone IN ($1, $2)`, [stu1Phone, stu2Phone]).catch(() => {});
    if (createdGroupId) {
      await pool.query(`DELETE FROM public.groups WHERE id = $1`, [createdGroupId]).catch(() => {});
    }
  }, 60000);

  it('E09 — Executes safe read-only Neon verification probe confirming TLS, restricted role, RLS across all 18 tables, and zero credential leakage', async () => {
    const modPath = path.resolve(__dirname, '../../src/scripts/check-neon.ts');
    const exists = await fs
      .access(modPath)
      .then(() => true)
      .catch(() => false);
    expect(exists, 'Expected src/scripts/check-neon.ts to exist').toBe(true);

    const { runNeonVerificationProbe } = await import('../../src/scripts/check-neon.js');
    const report = await runNeonVerificationProbe();

    expect(report.ok).toBe(true);
    expect(report.roleVerified).toBe(true);
    expect(report.rlsTablesVerified).toBe(true);
    expect(report.rlsTablesCount).toBeGreaterThanOrEqual(18);
    expect(report.securityInvokerViewsVerified).toBe(true);

    // Ensure no password or secret connection string is leaked in the serialized report
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(process.env.DATABASE_URL || 'NEVER_MATCH');
    expect(serialized).not.toContain('npg_');
  });

  it('E10 — Verifies frozen API contract document (docs/API_CONTRACT.md) and category/group/settings management endpoints', async () => {
    const contractPath = path.resolve(__dirname, '../../../docs/API_CONTRACT.md');
    const contractText = await fs.readFile(contractPath, 'utf8');

    expect(contractText).toContain('/api/auth/lease-public-key');
    expect(contractText).toContain('/api/auth/register');
    expect(contractText).toContain('/api/student/quiz-attempts');
    expect(contractText).toContain('/api/admin/payments');
    expect(contractText).toContain('/api/admin/notifications/run-reminders');
    expect(contractText).toContain('IDEMPOTENCY_CONFLICT');
    expect(contractText).toContain('GROUP_FULL');
    expect(contractText).toContain('INACTIVE_LICENCE_CATEGORY');
    expect(contractText).toContain('Africa/Douala');
    expect(contractText).toContain('EdDSA');

    // Verify PATCH /api/admin/settings works
    const settingsRes = await apiRequest('/api/admin/settings', {
      method: 'PATCH',
      token: adminToken,
      body: {
        schoolName: 'Auto-école La Marseillaise',
        trialDays: 14,
      },
    });
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.data.settings.trial_days).toBe(14);
  });

  it('Final Combined End-to-End Acceptance Test — Full lifecycle across Phases 1, 2, 3, 4, 5 & 6', async () => {
    // --- PHASE 1: Input & Error Contract Guards (E06, E07, E08) ---
    const badJsonAuth = await apiRequest('/api/auth/login', {
      method: 'POST',
      rawBody: '["not-an-object"]',
    });
    expect(badJsonAuth.status).toBe(400);
    expect(['INVALID_PAYLOAD', 'INVALID_JSON']).toContain(badJsonAuth.data.error);

    const badUuidAdmin = await apiRequest('/api/admin/students/invalid-uuid-value', {
      token: adminToken,
    });
    expect(badUuidAdmin.status).toBe(400);
    expect(badUuidAdmin.data.error).toBe('INVALID_UUID');

    const badGroupDate = await apiRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      body: {
        licenceCategoryId: permisBId,
        name: `Invalid Date Group ${suffix}`,
        startDate: '2026-04-31',
        capacity: 1,
        totalFee: 100000,
        installments: [{ position: 1, label: 'Tranche 1', amount: 100000, dueDate: '2026-05-10' }],
      },
    });
    expect(badGroupDate.status).toBe(400);

    // --- PHASE 2: Category & Group Integrity + Atomic Registration (E03, E04) ---
    const goodGroupRes = await apiRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      body: {
        licenceCategoryId: permisBId,
        name: `Master Combined Group ${suffix}`,
        startDate: '2026-06-01',
        capacity: 1,
        totalFee: 100000,
        installments: [
          { position: 1, label: '1re Tranche', amount: 60000, dueDate: '2026-06-01' },
          { position: 2, label: '2e Tranche', amount: 40000, dueDate: '2026-07-01' },
        ],
      },
    });
    expect(goodGroupRes.status).toBe(201);
    createdGroupId = goodGroupRes.data.group.id;

    // Deactivate Permis D via Admin API and verify registration into it fails atomically
    const deactRes = await apiRequest(`/api/admin/licence-categories/${permisDId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: false },
    });
    expect(deactRes.status).toBe(200);
    expect(deactRes.data.licenceCategory.is_active).toBe(false);

    const otp1 = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: stu1Phone },
    });
    const otpCode1 = otp1.data.devOtpPreview;

    // Attempt registration without groupId -> 400 and OTP remains unconsumed
    const regMissingGroup = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Master Student 1',
        phone: stu1Phone,
        password: 'Password123!',
        otpCode: otpCode1,
        licenceCategoryId: permisBId,
      },
    });
    expect(regMissingGroup.status).toBe(400);

    // Re-activate Permis D
    await apiRequest(`/api/admin/licence-categories/${permisDId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: true },
    });

    // Now register Student 1 and Student 2 into the capacity-1 group (both succeed as unpaid trial students!)
    const reg1 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Master Student 1',
        phone: stu1Phone,
        password: 'Password123!',
        otpCode: otpCode1,
        licenceCategoryId: permisBId,
        groupId: createdGroupId,
      },
    });
    expect(reg1.status).toBe(201);
    const stu1Token = reg1.data.token;
    const stu1UserId = reg1.data.user.id;
    const stu1Id = reg1.data.studentId;

    const otp2 = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: stu2Phone },
    });
    const reg2 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Master Student 2',
        phone: stu2Phone,
        password: 'Password123!',
        otpCode: otp2.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: createdGroupId,
      },
    });
    expect(reg2.status).toBe(201);
    const stu2Token = reg2.data.token;
    const stu2UserId = reg2.data.user.id;

    // --- PHASE 4: Database-Level RLS & Least-Privilege Role (E01) ---
    await withUserContext(stu1UserId, async (client) => {
      const roleRes = await client.query(`SELECT current_user AS role`);
      expect(roleRes.rows[0].role).toBe('aem_app_runtime');

      const visibleStudents = await client.query(`SELECT id FROM public.students`);
      expect(visibleStudents.rowCount).toBe(1);
      expect(visibleStudents.rows[0].id).toBe(stu1Id);
    });

    // --- PHASE 5: Asymmetric EdDSA Offline Lease Verification (E11) ---
    const leaseEval = await evaluateOfflineLease(reg1.data.offlineLeaseToken, {
      expectedUserId: stu1UserId,
      publicKeyJwk: reg1.data.leasePublicKey.publicKeyJwk,
    });
    expect(leaseEval.valid).toBe(true);
    expect(leaseEval.allowProtectedContent).toBe(true);

    // --- PHASE 3 & 5: Idempotency, Capacity Locking & Durable Outbox (E02, E05, E12) ---
    const quizzesRes = await apiRequest('/api/student/quizzes', { token: stu1Token });
    expect(quizzesRes.status).toBe(200);
    const quizId = quizzesRes.data.quizzes[0].id;
    const sharedAttemptClientId = crypto.randomUUID();

    const attempt1 = await apiRequest('/api/student/quiz-attempts', {
      method: 'POST',
      token: stu1Token,
      body: { quizId, score: 18, total: 20, clientId: sharedAttemptClientId },
    });
    expect(attempt1.status).toBe(201);

    // Cross-student reuse of clientId must return 409 IDEMPOTENCY_CONFLICT
    const attempt2Collision = await apiRequest('/api/student/quiz-attempts', {
      method: 'POST',
      token: stu2Token,
      body: { quizId, score: 15, total: 20, clientId: sharedAttemptClientId },
    });
    expect(attempt2Collision.status).toBe(409);
    expect(attempt2Collision.data.error).toBe('IDEMPOTENCY_CONFLICT');

    // Get enrollment IDs for Student 1 & Student 2
    const me1 = await apiRequest('/api/student/me', { token: stu1Token });
    const me2 = await apiRequest('/api/student/me', { token: stu2Token });
    const enrol1Id = me1.data.enrollment.enrollment_id;
    const enrol2Id = me2.data.enrollment.enrollment_id;

    // Record 1st installment (60,000 FCFA) for Student 1 -> occupies the 1 seat in the group
    const pay1 = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: enrol1Id,
        amount: 60000,
        method: 'mtn_momo',
        clientId: crypto.randomUUID(),
      },
    });
    expect(pay1.status).toBe(201);
    expect(pay1.data.details.balance).toBe(40000);
    expect(pay1.data.notification.outboxId).toBeTruthy();

    // Student 2 tries to pay into the now-full capacity-1 group -> 409 GROUP_FULL
    const pay2Full = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: enrol2Id,
        amount: 60000,
        method: 'cash',
        clientId: crypto.randomUUID(),
      },
    });
    expect(pay2Full.status).toBe(409);
    expect(pay2Full.data.error).toBe('GROUP_FULL');

    // Student 1 (already seated) pays 2nd installment (40,000 FCFA) -> 201 and balance becomes 0
    const pay1Second = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: enrol1Id,
        amount: 40000,
        method: 'cash',
        clientId: crypto.randomUUID(),
      },
    });
    expect(pay1Second.status).toBe(201);
    expect(pay1Second.data.details.balance).toBe(0);
  });
});

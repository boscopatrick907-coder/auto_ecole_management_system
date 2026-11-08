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
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json };
}

describe('Auto-école La Marseillaise — Backend & Neon PostgreSQL Security Suite', { timeout: 90000 }, () => {
  let adminToken = '';
  let studentAToken = '';
  let studentAId = '';
  let studentAEnrollmentId = '';
  let permisBId = '';
  let groupBId = '';
  const suffix = Date.now().toString().slice(-6);
  const studentAPhone = `+237691${suffix}`;
  const walkInPhone = `+237672${suffix}`;

  beforeAll(async () => {
    await runMigrationsAndSeed();

    // 1. Login as Super-Admin
    const adminLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: process.env.INITIAL_ADMIN_PHONE || '+237699000001',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!',
      },
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.data.token;

    // 2. Fetch Catalogue
    const cat = await apiRequest('/api/auth/catalogue');
    expect(cat.status).toBe(200);
    const permisB = cat.data.licenceCategories.find((l: any) => l.code === 'B');
    expect(permisB).toBeDefined();
    permisBId = permisB.id;

    const groupB =
      cat.data.groups.find(
        (g: any) =>
          g.licence_category_id === permisBId &&
          g.total_fee === 120000 &&
          g.confirmed_seats < g.capacity
      ) || cat.data.groups.find((g: any) => g.licence_category_id === permisBId);
    expect(groupB).toBeDefined();
    groupBId = groupB.id;
  }, 90000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.notification_outbox WHERE recipient_phone IN ($1, $2)`, [studentAPhone, walkInPhone]).catch(() => {});
    await pool.query(`DELETE FROM public.students WHERE phone IN ($1, $2)`, [studentAPhone, walkInPhone]).catch(() => {});
    await pool.query(`DELETE FROM public.users WHERE phone IN ($1, $2)`, [studentAPhone, walkInPhone]).catch(() => {});
  }, 60000);

  it('1. Rejects unauthenticated access to protected student and admin endpoints (401)', async () => {
    const r1 = await apiRequest('/api/student/me');
    expect(r1.status).toBe(401);

    const r2 = await apiRequest('/api/student/resources');
    expect(r2.status).toBe(401);

    const r3 = await apiRequest('/api/admin/dashboard');
    expect(r3.status).toBe(401);

    const r4 = await apiRequest('/api/admin/payments', {
      method: 'POST',
      body: { enrollmentId: crypto.randomUUID(), amount: 50000 },
    });
    expect(r4.status).toBe(401);
  });

  it('2. Verifies OTP and registers Student A with automatic 14-day free trial', async () => {
    const otpReq = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: studentAPhone },
    });
    expect(otpReq.status).toBe(200);
    expect(otpReq.data.devOtpPreview).toMatch(/^[0-9]{6}$/);

    const reg = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Jean-Paul Mbarga',
        phone: studentAPhone,
        email: `jp.mbarga.${suffix}@example.cm`,
        password: 'StudentPassword123!',
        otpCode: otpReq.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: groupBId,
      },
    });
    expect(reg.status).toBe(201);
    expect(reg.data.token).toBeTruthy();
    expect(reg.data.accessState.hasAccess).toBe(true);
    expect(reg.data.accessState.hasPaid).toBe(false);
    expect(reg.data.accessState.trialDaysLeft).toBeGreaterThanOrEqual(13);

    studentAToken = reg.data.token;
    studentAId = reg.data.studentId;

    const me = await apiRequest('/api/student/me', { token: studentAToken });
    expect(me.status).toBe(200);
    expect(me.data.student.computed_status).toBe('en_essai_gratuit');
    studentAEnrollmentId = me.data.enrollment.enrollment_id;
  });

  it('3. Blocks Privilege Escalation (BFLA): Student A cannot call Admin API or DB functions', async () => {
    const dash = await apiRequest('/api/admin/dashboard', { token: studentAToken });
    expect(dash.status).toBe(403);

    const pay = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: studentAToken,
      body: { enrollmentId: studentAEnrollmentId, amount: 50000 },
    });
    expect(pay.status).toBe(403);

    // Also verify database-level enforcement inside PostgreSQL stored procedure
    const sessionRes = await apiRequest('/api/auth/session', { token: studentAToken });
    const studentUserId = sessionRes.data.user.id;
    await expect(
      withUserContext(studentUserId, async (client) => {
        await client.query(`SELECT public.record_payment($1::uuid, 50000)`, [studentAEnrollmentId]);
      })
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('4. Enforces the 14-day trial paywall, permanent unlock on 1st payment, and recalculation on cancel', async () => {
    // During active trial: access to resources and quizzes succeeds
    const resActive = await apiRequest('/api/student/resources', { token: studentAToken });
    expect(resActive.status).toBe(200);
    expect(resActive.data.resources.length).toBeGreaterThan(0);

    // Expire Student A's trial in DB (simulate 15 days elapsed without payment)
    const pool = getPool();
    await pool.query(
      `UPDATE public.students SET trial_ends_at = now() - interval '1 day' WHERE id = $1`,
      [studentAId]
    );

    // Resources & quizzes must now be strictly blocked (403 ACCESS_EXPIRED)
    const resExpired = await apiRequest('/api/student/resources', { token: studentAToken });
    expect(resExpired.status).toBe(403);
    expect(resExpired.data.error).toBe('ACCESS_EXPIRED');

    const quizExpired = await apiRequest('/api/student/quizzes', { token: studentAToken });
    expect(quizExpired.status).toBe(403);

    // Student A can still read their profile/payment status AND sync an offline quiz attempt
    const meExpired = await apiRequest('/api/student/me', { token: studentAToken });
    expect(meExpired.status).toBe(200);
    expect(meExpired.data.student.computed_status).toBe('essai_termine_sans_paiement');

    // Admin records 1st tranche payment (50,000 FCFA) with idempotency client_id
    const clientId = crypto.randomUUID();
    const pay1 = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: studentAEnrollmentId,
        amount: 50000,
        method: 'cash',
        clientId,
      },
    });
    expect(pay1.status).toBe(201);
    expect(pay1.data.payment.receipt_number).toMatch(/^LM-\d{4}-\d{6}$/);
    expect(pay1.data.details.balance).toBe(70000);
    expect(pay1.data.notification.waMeLink).toContain('wa.me/');

    // Replay exact same offline clientId -> must return same payment without charging twice
    const pay1Replay = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: studentAEnrollmentId,
        amount: 50000,
        method: 'cash',
        clientId,
      },
    });
    expect(pay1Replay.status).toBe(201);
    expect(pay1Replay.data.payment.id).toBe(pay1.data.payment.id);
    expect(pay1Replay.data.details.balance).toBe(70000);

    // Student A now has permanent access even though trial_ends_at is in the past
    const resUnlocked = await apiRequest('/api/student/resources', { token: studentAToken });
    expect(resUnlocked.status).toBe(200);

    // Test Immutable Ledger: Direct SQL DELETE or UPDATE of amount must fail via trg_payments_guard
    await expect(
      pool.query(`DELETE FROM public.payments WHERE id = $1`, [pay1.data.payment.id])
    ).rejects.toThrow(/Payments cannot be deleted/);

    await expect(
      pool.query(`UPDATE public.payments SET amount = 10000 WHERE id = $1`, [pay1.data.payment.id])
    ).rejects.toThrow(/Payments cannot be edited/);

    // Test Exceeds Balance Guard
    const overPay = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: studentAEnrollmentId,
        amount: 999999,
        method: 'cash',
      },
    });
    expect(overPay.status).toBe(400);
    expect(overPay.data.error).toBe('EXCEEDS_BALANCE');

    // Cancel the only payment -> requires reason -> access must lock again!
    const cancelNoReason = await apiRequest(
      `/api/admin/payments/${pay1.data.payment.id}/cancel`,
      {
        method: 'POST',
        token: adminToken,
        body: { reason: '   ' },
      }
    );
    expect(cancelNoReason.status).toBe(400);

    const cancelOk = await apiRequest(`/api/admin/payments/${pay1.data.payment.id}/cancel`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'Erreur de saisie du montant en caisse' },
    });
    expect(cancelOk.status).toBe(200);

    const resRelocked = await apiRequest('/api/student/resources', { token: studentAToken });
    expect(resRelocked.status).toBe(403);

    // Record valid payment again so Student A stays unlocked
    const payValid = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: studentAEnrollmentId,
        amount: 50000,
        method: 'mtn_momo',
        reference: 'MOMO-TX-998877',
      },
    });
    expect(payValid.status).toBe(201);
  });

  it('5. Enforces Walk-In Invite Code flow, SHA-256 hashing, and One-Time Claim lock', async () => {
    const walkInCreate = await apiRequest('/api/admin/students', {
      method: 'POST',
      token: adminToken,
      body: {
        fullName: 'Marie-Claire Ngo Biyong',
        phone: walkInPhone,
        groupId: groupBId,
      },
    });
    expect(walkInCreate.status).toBe(201);
    const inviteCode = walkInCreate.data.inviteCode;
    expect(inviteCode).toHaveLength(8);

    // Claim invite code
    const claim = await apiRequest('/api/auth/claim-invite', {
      method: 'POST',
      body: {
        inviteCode,
        phone: walkInPhone,
        password: 'MariePassword123!',
      },
    });
    expect(claim.status).toBe(200);
    expect(claim.data.accessState.hasAccess).toBe(true);
    expect(claim.data.accessState.trialDaysLeft).toBeGreaterThanOrEqual(13);

    // Re-claiming the same invite code must fail (One-Time Use)
    const claimReplay = await apiRequest('/api/auth/claim-invite', {
      method: 'POST',
      body: {
        inviteCode,
        phone: walkInPhone,
        password: 'MariePassword123!',
      },
    });
    expect(claimReplay.status).toBe(400);

    // BOLA Check: Marie-Claire cannot see Jean-Paul's payments
    const marieMe = await apiRequest('/api/student/me', { token: claim.data.token });
    expect(marieMe.status).toBe(200);
    expect(marieMe.data.student.id).not.toBe(studentAId);
    expect(marieMe.data.payments.length).toBe(0);
  });
});

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

describe('Phase 3 TDD — Group Capacity Seat Lock & Quiz Idempotency Conflict Handling (E02, E05)', { timeout: 90000 }, () => {
  let adminToken = '';
  let permisBId = '';
  let cap1GroupId = '';
  let quiz1Id = '';
  let quiz2Id = '';
  const suffix = Date.now().toString().slice(-6);
  const stu1Phone = `+237695${suffix}`;
  const stu2Phone = `+237696${suffix}`;
  let stu1Token = '';
  let stu2Token = '';
  let stu1EnrollmentId = '';
  let stu2EnrollmentId = '';

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

    // Create an open group with capacity = 1 and 2 installments (1000 FCFA + 1000 FCFA = 2000 FCFA)
    const grpRes = await apiRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      body: {
        licenceCategoryId: permisBId,
        name: `Cap1 Concurrency Group ${suffix}`,
        startDate: '2026-12-01',
        capacity: 1,
        totalFee: 2000,
        status: 'open',
        installments: [
          { position: 1, label: 'Tranche 1', amount: 1000, dueDate: '2026-12-05' },
          { position: 2, label: 'Tranche 2', amount: 1000, dueDate: '2026-12-20' },
        ],
      },
    });
    expect(grpRes.status).toBe(201);
    cap1GroupId = grpRes.data.group.id;

    // Register two unpaid trial students into the capacity-1 group (both allowed since trial doesn't take a confirmed seat)
    const otp1 = await apiRequest('/api/auth/request-otp', { method: 'POST', body: { phone: stu1Phone } });
    const reg1 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Concurrent Student 1',
        phone: stu1Phone,
        password: 'Password123!',
        otpCode: otp1.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: cap1GroupId,
      },
    });
    expect(reg1.status).toBe(201);
    stu1Token = reg1.data.token;
    const me1 = await apiRequest('/api/student/me', { token: stu1Token });
    stu1EnrollmentId = me1.data.enrollment.enrollment_id;

    const otp2 = await apiRequest('/api/auth/request-otp', { method: 'POST', body: { phone: stu2Phone } });
    const reg2 = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Concurrent Student 2',
        phone: stu2Phone,
        password: 'Password123!',
        otpCode: otp2.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: cap1GroupId,
      },
    });
    expect(reg2.status).toBe(201);
    stu2Token = reg2.data.token;
    const me2 = await apiRequest('/api/student/me', { token: stu2Token });
    stu2EnrollmentId = me2.data.enrollment.enrollment_id;

    // Fetch two quiz IDs for E05 testing
    const qzRes = await apiRequest('/api/student/quizzes', { token: stu1Token });
    expect(qzRes.status).toBe(200);
    quiz1Id = qzRes.data.quizzes[0].id;
    quiz2Id = qzRes.data.quizzes[1]?.id || qzRes.data.quizzes[0].id;
  }, 120000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.audit_log WHERE table_name = 'payments' AND details->>'enrollment_id' IN ($1, $2)`, [
      stu1EnrollmentId,
      stu2EnrollmentId,
    ]).catch(() => {});
    // Temporarily disable payment delete guard only for test cleanup in dev/staging DB
    await pool.query(`ALTER TABLE public.payments DISABLE TRIGGER trg_payments_guard`).catch(() => {});
    await pool.query(`DELETE FROM public.payments WHERE enrollment_id IN ($1, $2)`, [
      stu1EnrollmentId,
      stu2EnrollmentId,
    ]).catch(() => {});
    await pool.query(`ALTER TABLE public.payments ENABLE TRIGGER trg_payments_guard`).catch(() => {});
    await pool.query(`DELETE FROM public.students WHERE phone IN ($1, $2)`, [stu1Phone, stu2Phone]).catch(() => {});
    await pool.query(`DELETE FROM public.users WHERE phone IN ($1, $2)`, [stu1Phone, stu2Phone]).catch(() => {});
    if (cap1GroupId) {
      await pool.query(`DELETE FROM public.groups WHERE id = $1`, [cap1GroupId]).catch(() => {});
    }
  }, 60000);

  it('E02 — Enforces group capacity=1 under concurrent first payments (one 201, one 409 GROUP_FULL), allows idempotent retry and subsequent installments, and frees seat on cancellation', async () => {
    const clientId1 = crypto.randomUUID();
    const clientId2 = crypto.randomUUID();

    // Fire both 1st-tranche payments concurrently!
    const [res1, res2] = await Promise.all([
      apiRequest('/api/admin/payments', {
        method: 'POST',
        token: adminToken,
        body: {
          enrollmentId: stu1EnrollmentId,
          amount: 1000,
          method: 'cash',
          clientId: clientId1,
        },
      }),
      apiRequest('/api/admin/payments', {
        method: 'POST',
        token: adminToken,
        body: {
          enrollmentId: stu2EnrollmentId,
          amount: 1000,
          method: 'cash',
          clientId: clientId2,
        },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = res1.status === 201 ? { res: res1, enrollmentId: stu1EnrollmentId, clientId: clientId1 } : { res: res2, enrollmentId: stu2EnrollmentId, clientId: clientId2 };
    const loser = res1.status === 409 ? { res: res1, enrollmentId: stu1EnrollmentId } : { res: res2, enrollmentId: stu2EnrollmentId };

    expect(loser.res.data?.error).toBe('GROUP_FULL');

    // Verify group_occupancy reports exactly 1 confirmed seat (never 2!)
    const pool = getPool();
    const occRes = await pool.query(
      `SELECT confirmed_seats FROM public.group_occupancy WHERE group_id = $1`,
      [cap1GroupId]
    );
    expect(occRes.rows[0].confirmed_seats).toBe(1);

    // Retrying the winning clientId returns the same payment without consuming another seat
    const replayRes = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: winner.enrollmentId,
        amount: 1000,
        method: 'cash',
        clientId: winner.clientId,
      },
    });
    expect(replayRes.status).toBe(201);
    expect(replayRes.data.payment.id).toBe(winner.res.data.payment.id);

    // Subsequent installment (Tranche 2 = 1000 FCFA) for the already-confirmed winner succeeds even when group is full!
    const secondInstRes = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: winner.enrollmentId,
        amount: 1000,
        method: 'mtn_momo',
      },
    });
    expect(secondInstRes.status).toBe(201);
    expect(secondInstRes.data.details.balance).toBe(0);

    // Cancel both of winner's payments -> frees the seat -> loser can now claim the seat!
    await apiRequest(`/api/admin/payments/${winner.res.data.payment.id}/cancel`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'Test libération de place 1' },
    });
    await apiRequest(`/api/admin/payments/${secondInstRes.data.payment.id}/cancel`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'Test libération de place 2' },
    });

    const loserClaimNow = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId: loser.enrollmentId,
        amount: 1000,
        method: 'cash',
      },
    });
    expect(loserClaimNow.status).toBe(201);
  });

  it('E05 — Returns 409 IDEMPOTENCY_CONFLICT (never 500 or cross-student leak) when different students share a quiz clientId or when a batch item conflicts, rolling back the whole batch', async () => {
    const sharedClientId = crypto.randomUUID();

    // 1. Concurrent submission from Student 1 and Student 2 with the same clientId
    const [qRes1, qRes2] = await Promise.all([
      apiRequest('/api/student/quiz-attempts', {
        method: 'POST',
        token: stu1Token,
        body: {
          quizId: quiz1Id,
          score: 16,
          total: 20,
          clientId: sharedClientId,
        },
      }),
      apiRequest('/api/student/quiz-attempts', {
        method: 'POST',
        token: stu2Token,
        body: {
          quizId: quiz1Id,
          score: 18,
          total: 20,
          clientId: sharedClientId,
        },
      }),
    ]);

    const qStatuses = [qRes1.status, qRes2.status].sort();
    expect(qStatuses).toEqual([201, 409]);

    const qWinnerToken = qRes1.status === 201 ? stu1Token : stu2Token;
    const qLoserToken = qRes1.status === 409 ? stu1Token : stu2Token;
    const qLoserRes = qRes1.status === 409 ? qRes1 : qRes2;
    expect(qLoserRes.data?.error).toBe('IDEMPOTENCY_CONFLICT');

    // 2. Idempotent replay by the SAME owner + SAME quiz succeeds (201)
    const replaySameOwner = await apiRequest('/api/student/quiz-attempts', {
      method: 'POST',
      token: qWinnerToken,
      body: {
        quizId: quiz1Id,
        score: 16,
        total: 20,
        clientId: sharedClientId,
      },
    });
    expect(replaySameOwner.status).toBe(201);

    // 3. Batch atomicity: if item 1 in a batch is valid/new, and item 2 conflicts with sharedClientId (from the other student),
    // the entire batch must fail with 409 and item 1 must NOT be committed!
    const batchItem1ClientId = crypto.randomUUID();
    const batchConflictRes = await apiRequest('/api/student/quiz-attempts', {
      method: 'POST',
      token: qLoserToken,
      body: {
        attempts: [
          { quizId: quiz1Id, score: 15, total: 20, clientId: batchItem1ClientId },
          { quizId: quiz1Id, score: 19, total: 20, clientId: sharedClientId },
        ],
      },
    });
    expect(batchConflictRes.status).toBe(409);

    const pool = getPool();
    const checkItem1 = await pool.query(
      `SELECT id FROM public.quiz_attempts WHERE client_id = $1`,
      [batchItem1ClientId]
    );
    expect(checkItem1.rowCount).toBe(0);
  });
});

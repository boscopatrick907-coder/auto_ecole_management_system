import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { app } from '../../src/app.js';
import { getPool } from '../../src/db.js';
import { runMigrationsAndSeed } from '../../src/scripts/migrate.js';
import * as cryptoUtils from '../../src/utils/crypto.js';
import * as whatsappService from '../../src/services/whatsapp.js';

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

describe('Phase 5 TDD — Asymmetric Offline Lease (E11) & Durable Notification Outbox / Reminders (E12)', { timeout: 120000 }, () => {
  let adminToken = '';
  let permisBId = '';
  let groupBId = '';
  const suffix = Date.now().toString().slice(-6);
  const studentPhone = `+237690${suffix}`;
  let studentToken = '';
  let studentUserId = '';
  let studentId = '';
  let enrollmentId = '';

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
    groupBId = catRes.data.groups.find(
      (g: any) => g.licence_category_id === permisBId && g.confirmed_seats < g.capacity
    ).id;

    const otpRes = await apiRequest('/api/auth/request-otp', {
      method: 'POST',
      body: { phone: studentPhone },
    });
    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Phase 5 Lease & Outbox Student',
        phone: studentPhone,
        password: 'Password123!',
        otpCode: otpRes.data.devOtpPreview,
        licenceCategoryId: permisBId,
        groupId: groupBId,
      },
    });
    expect(regRes.status).toBe(201);
    studentToken = regRes.data.token;
    studentUserId = regRes.data.user.id;
    studentId = regRes.data.studentId;

    const meRes = await apiRequest('/api/student/me', { token: studentToken });
    enrollmentId = meRes.data.enrollment.enrollment_id;
  }, 120000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.notification_outbox WHERE recipient_phone = $1 OR dedup_key LIKE '%2026-11-08%'`, [studentPhone]).catch(() => {});
    await pool.query(`DELETE FROM public.students WHERE phone = $1`, [studentPhone]).catch(() => {});
    await pool.query(`DELETE FROM public.users WHERE phone = $1`, [studentPhone]).catch(() => {});
  }, 60000);

  it('E11.1 — Issues EdDSA (Ed25519) asymmetric offline lease tokens and exposes public JWK without private key material', async () => {
    // 1. Public key endpoint must exist and return Ed25519 JWK without 'd' private key
    const pubKeyRes = await apiRequest('/api/auth/lease-public-key');
    expect(pubKeyRes.status).toBe(200);
    expect(pubKeyRes.data.alg).toBe('EdDSA');
    expect(pubKeyRes.data.kid).toBeTruthy();
    expect(pubKeyRes.data.publicKeyJwk).toBeDefined();
    expect(pubKeyRes.data.publicKeyJwk.kty).toBe('OKP');
    expect(pubKeyRes.data.publicKeyJwk.crv).toBe('Ed25519');
    expect(pubKeyRes.data.publicKeyJwk.x).toBeTruthy();
    expect(pubKeyRes.data.publicKeyJwk.d).toBeUndefined();

    // 2. Session endpoint must return an EdDSA-signed offlineLeaseToken
    const sessionRes = await apiRequest('/api/auth/session', { token: studentToken });
    expect(sessionRes.status).toBe(200);
    const leaseToken = sessionRes.data.offlineLeaseToken as string;
    expect(leaseToken).toBeTruthy();

    const header = decodeProtectedHeader(leaseToken);
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(pubKeyRes.data.kid);

    // 3. Client-side verification using ONLY the public JWK must succeed
    const publicKey = await importJWK(pubKeyRes.data.publicKeyJwk, 'EdDSA');
    const verified = await jwtVerify(leaseToken, publicKey, {
      audience: 'auto-ecole-la-marseillaise-pwa',
      issuer: 'auto-ecole-la-marseillaise-api',
    });
    expect(verified.payload.sub).toBe(studentUserId);
    expect(verified.payload.hasAccess).toBe(true);
  });

  it('E11.2 — Evaluates offline lease constraints: rejects tampered signatures, wrong user account, clock rollback, and expired offline window', async () => {
    const evaluateOfflineLease = (cryptoUtils as any).evaluateOfflineLease;
    expect(typeof evaluateOfflineLease).toBe('function');

    const nowMs = Date.now();
    const validToken = await cryptoUtils.signOfflineLeaseToken({
      sub: studentUserId,
      studentId,
      role: 'student',
      hasAccess: true,
      hasPaid: false,
      trialEndsAt: new Date(nowMs + 7 * 86400_000).toISOString(),
      serverTimeMs: nowMs,
      maxOfflineUntilMs: nowMs + 3 * 86400_000,
    });

    // Valid check
    const okCheck = await evaluateOfflineLease(validToken, {
      expectedUserId: studentUserId,
      deviceNowMs: nowMs + 60_000,
    });
    expect(okCheck.valid).toBe(true);
    expect(okCheck.allowProtectedContent).toBe(true);

    // Wrong user account (cross-account replay)
    const wrongUserCheck = await evaluateOfflineLease(validToken, {
      expectedUserId: crypto.randomUUID(),
      deviceNowMs: nowMs + 60_000,
    });
    expect(wrongUserCheck.valid).toBe(false);
    expect(wrongUserCheck.reason).toBe('USER_MISMATCH');

    // Clock rollback > 5 minutes before serverTimeMs
    const rollbackCheck = await evaluateOfflineLease(validToken, {
      expectedUserId: studentUserId,
      deviceNowMs: nowMs - 15 * 60_000,
    });
    expect(rollbackCheck.valid).toBe(false);
    expect(rollbackCheck.reason).toBe('CLOCK_ROLLBACK_DETECTED');

    // Offline window expired
    const expiredWindowCheck = await evaluateOfflineLease(validToken, {
      expectedUserId: studentUserId,
      deviceNowMs: nowMs + 4 * 86400_000,
    });
    expect(expiredWindowCheck.valid).toBe(false);
    expect(expiredWindowCheck.reason).toBe('OFFLINE_LEASE_EXPIRED');

    // Tampered token payload
    const parts = validToken.split('.');
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: studentUserId, hasAccess: true, hasPaid: true, serverTimeMs: nowMs, maxOfflineUntilMs: nowMs + 999999999 })
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${fakePayload}.${parts[2]}`;
    const tamperedCheck = await evaluateOfflineLease(tamperedToken, {
      expectedUserId: studentUserId,
      deviceNowMs: nowMs,
    });
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.reason).toBe('INVALID_SIGNATURE');
  });

  it('E12.1 — Verifies webhook HMAC-SHA256 signatures and rejects stale/replayed timestamps', async () => {
    const verifyWebhookSignature = (whatsappService as any).verifyWebhookSignature;
    expect(typeof verifyWebhookSignature).toBe('function');

    const secret = 'test-n8n-webhook-secret-2026';
    const rawBody = JSON.stringify({ event: 'payment_confirmed', amount: 40000 });
    const nowIso = new Date().toISOString();

    const signWebhookPayload = (whatsappService as any).signWebhookPayload;
    expect(typeof signWebhookPayload).toBe('function');
    const validSig = signWebhookPayload(rawBody, nowIso, secret);

    // 1. Valid signature & fresh timestamp
    const okRes = verifyWebhookSignature({
      rawBody,
      timestamp: nowIso,
      signature: validSig,
      secret,
    });
    expect(okRes.valid).toBe(true);

    // 2. Invalid signature
    const badSigRes = verifyWebhookSignature({
      rawBody,
      timestamp: nowIso,
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
      secret,
    });
    expect(badSigRes.valid).toBe(false);
    expect(badSigRes.reason).toBe('INVALID_SIGNATURE');

    // 3. Expired timestamp (15 minutes old)
    const oldIso = new Date(Date.now() - 15 * 60_000).toISOString();
    const oldSig = signWebhookPayload(rawBody, oldIso, secret);
    const staleRes = verifyWebhookSignature({
      rawBody,
      timestamp: oldIso,
      signature: oldSig,
      secret,
    });
    expect(staleRes.valid).toBe(false);
    expect(staleRes.reason).toBe('TIMESTAMP_OUT_OF_RANGE');
  });

  it('E12.2 — Persists durable notification_outbox records on committed business events and deduplicates scheduled reminders in Africa/Douala', async () => {
    // 1. Record a payment for our test student -> must persist in notification_outbox
    const payRes = await apiRequest('/api/admin/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        enrollmentId,
        amount: 40000,
        method: 'cash',
        clientId: crypto.randomUUID(),
      },
    });
    expect(payRes.status).toBe(201);
    const paymentId = payRes.data.payment.id;

    const pool = getPool();
    const outboxRes = await pool.query(
      `SELECT id, dedup_key, event_type, recipient_phone, status, attempts
       FROM public.notification_outbox
       WHERE dedup_key = $1`,
      [`payment_confirmed:${paymentId}`]
    );
    expect(outboxRes.rowCount).toBe(1);
    expect(outboxRes.rows[0].event_type).toBe('payment_confirmed');
    expect(outboxRes.rows[0].recipient_phone).toBe(studentPhone);

    // 2. Run scheduled reminders twice for the same reference date -> must deduplicate and never duplicate outbox rows
    const run1 = await apiRequest('/api/admin/notifications/run-reminders', {
      method: 'POST',
      token: adminToken,
      body: {
        referenceDate: '2026-11-08',
        includeWeeklySummary: true,
        dryRunExternal: true,
      },
    });
    expect(run1.status).toBe(200);
    expect(run1.data.ok).toBe(true);
    expect(run1.data.enqueuedCount).toBeGreaterThanOrEqual(1);

    const run2 = await apiRequest('/api/admin/notifications/run-reminders', {
      method: 'POST',
      token: adminToken,
      body: {
        referenceDate: '2026-11-08',
        includeWeeklySummary: true,
        dryRunExternal: true,
      },
    });
    expect(run2.status).toBe(200);
    expect(run2.data.enqueuedCount).toBe(0);
    expect(run2.data.skippedDuplicatesCount).toBeGreaterThanOrEqual(1);
  });
});

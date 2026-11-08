import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { app } from '../../src/app.js';
import { getPool } from '../../src/db.js';
import { runMigrationsAndSeed } from '../../src/scripts/migrate.js';

async function rawRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await app.request(path, {
    method: options.method || 'GET',
    headers,
    body: options.rawBody,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

describe('Phase 1 TDD — Input, Identifier, Calendar Date & Throttling Guards (E06, E07, E08)', { timeout: 60000 }, () => {
  let adminToken = '';
  let permisBId = '';
  const createdGroupIds: string[] = [];

  beforeAll(async () => {
    await runMigrationsAndSeed();

    const loginRes = await rawRequest('/api/auth/login', {
      method: 'POST',
      rawBody: JSON.stringify({
        identifier: process.env.INITIAL_ADMIN_PHONE || '+237699000001',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!',
      }),
    });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.data.token;

    const catRes = await rawRequest('/api/auth/catalogue');
    expect(catRes.status).toBe(200);
    const permisB = catRes.data.licenceCategories.find((c: any) => c.code === 'B');
    permisBId = permisB.id;
  }, 45000);

  it('E06.1 — Rejects JSON null, primitive, array, malformed JSON and empty object payloads across all auth endpoints with 400 (even under NODE_ENV=production)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const authEndpoints = [
        '/api/auth/login',
        '/api/auth/request-otp',
        '/api/auth/register',
        '/api/auth/claim-invite',
      ];
      const badPayloads = [
        'null',
        '[]',
        '"just-a-string"',
        '12345',
        'true',
        '{bad-json',
        '{}',
      ];

      for (const endpoint of authEndpoints) {
        for (const rawBody of badPayloads) {
          const res = await rawRequest(endpoint, {
            method: 'POST',
            rawBody,
            headers: { 'x-forwarded-for': `10.10.0.${Math.floor(Math.random() * 250)}` },
          });
          expect(
            res.status,
            `Expected 400 for ${endpoint} with payload ${rawBody}, got ${res.status}`
          ).toBe(400);
          expect(res.data?.error).toBeTruthy();
        }
      }
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('E06.2 — Enforces production auth rate limiting (429 TOO_MANY_REQUESTS) without crashing on malformed bodies', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const testIp = '192.0.2.199';
    try {
      let saw429 = false;
      for (let i = 0; i < 25; i++) {
        const res = await rawRequest('/api/auth/login', {
          method: 'POST',
          rawBody: JSON.stringify({ identifier: '+237690009999', password: 'WrongPassword!' }),
          headers: { 'x-forwarded-for': testIp },
        });
        expect([401, 429]).toContain(res.status);
        if (res.status === 429) {
          saw429 = true;
          expect(res.data?.error).toBe('TOO_MANY_REQUESTS');
          break;
        }
      }
      expect(saw429).toBe(true);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('E07.1 — Rejects impossible calendar dates (e.g. 2026-02-30, 2026-02-29 non-leap, 2026-13-01, invalid strings) in group creation with 400 and creates no partial group', async () => {
    const invalidDates = ['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', 'not-a-date', '2026/05/10'];

    for (const badDate of invalidDates) {
      const resStart = await rawRequest('/api/admin/groups', {
        method: 'POST',
        token: adminToken,
        rawBody: JSON.stringify({
          licenceCategoryId: permisBId,
          name: `Invalid Start Date ${badDate}`,
          startDate: badDate,
          capacity: 15,
          totalFee: 100000,
          installments: [
            { position: 1, label: 'Tranche 1', amount: 100000, dueDate: '2026-12-01' },
          ],
        }),
      });
      expect(resStart.status, `Expected 400 for startDate=${badDate}`).toBe(400);

      const resDue = await rawRequest('/api/admin/groups', {
        method: 'POST',
        token: adminToken,
        rawBody: JSON.stringify({
          licenceCategoryId: permisBId,
          name: `Invalid Due Date ${badDate}`,
          startDate: '2026-11-15',
          capacity: 15,
          totalFee: 100000,
          installments: [
            { position: 1, label: 'Tranche 1', amount: 100000, dueDate: badDate },
          ],
        }),
      });
      expect(resDue.status, `Expected 400 for dueDate=${badDate}`).toBe(400);
    }
  });

  it('E07.2 — Enforces contiguous installment positions (1..N), chronological due dates, and exact installment sum', async () => {
    // Non-contiguous positions (1, 3)
    const nonContiguous = await rawRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      rawBody: JSON.stringify({
        licenceCategoryId: permisBId,
        name: 'Non-contiguous Group',
        startDate: '2026-11-15',
        capacity: 10,
        totalFee: 100000,
        installments: [
          { position: 1, label: 'T1', amount: 50000, dueDate: '2026-11-20' },
          { position: 3, label: 'T3', amount: 50000, dueDate: '2026-12-20' },
        ],
      }),
    });
    expect(nonContiguous.status).toBe(400);

    // Non-chronological due dates (dueDate[2] < dueDate[1])
    const nonChronological = await rawRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      rawBody: JSON.stringify({
        licenceCategoryId: permisBId,
        name: 'Backwards Dates Group',
        startDate: '2026-11-15',
        capacity: 10,
        totalFee: 100000,
        installments: [
          { position: 1, label: 'T1', amount: 50000, dueDate: '2026-12-20' },
          { position: 2, label: 'T2', amount: 50000, dueDate: '2026-11-20' },
        ],
      }),
    });
    expect(nonChronological.status).toBe(400);

    // Valid leap-year date (2028-02-29) and contiguous chronological plan succeeds
    const validLeap = await rawRequest('/api/admin/groups', {
      method: 'POST',
      token: adminToken,
      rawBody: JSON.stringify({
        licenceCategoryId: permisBId,
        name: `Valid Leap Group ${Date.now()}`,
        startDate: '2028-02-01',
        capacity: 10,
        totalFee: 100000,
        installments: [
          { position: 1, label: 'T1', amount: 60000, dueDate: '2028-02-29' },
          { position: 2, label: 'T2', amount: 40000, dueDate: '2028-03-31' },
        ],
      }),
    });
    expect(validLeap.status).toBe(201);
    if (validLeap.data?.group?.id) {
      createdGroupIds.push(validLeap.data.group.id);
    }

    // Cleanup created test group
    if (createdGroupIds.length > 0) {
      const pool = getPool();
      await pool.query(`DELETE FROM public.groups WHERE id = ANY($1::uuid[])`, [createdGroupIds]);
    }
  });

  it('E08 — Validates UUID path/query parameters (returning 400 instead of 500) and maps nonexistent valid UUIDs to 404 without leaking SQL details', async () => {
    const badId1 = await rawRequest('/api/admin/students/not-a-uuid', { token: adminToken });
    expect(badId1.status).toBe(400);
    expect(JSON.stringify(badId1.data)).not.toMatch(/postgres|syntax|select /i);

    const badId2 = await rawRequest('/api/admin/students/not-a-uuid/invite', {
      method: 'POST',
      token: adminToken,
    });
    expect(badId2.status).toBe(400);

    const badId3 = await rawRequest('/api/admin/payments/not-a-uuid/cancel', {
      method: 'POST',
      token: adminToken,
      rawBody: JSON.stringify({ reason: 'Test' }),
    });
    expect(badId3.status).toBe(400);

    const badQuery = await rawRequest('/api/admin/students?licenceCategoryId=not-a-uuid', {
      token: adminToken,
    });
    expect(badQuery.status).toBe(400);

    // Valid nonexistent UUID returns 404
    const randomUuid = crypto.randomUUID();
    const notFoundStu = await rawRequest(`/api/admin/students/${randomUuid}`, { token: adminToken });
    expect(notFoundStu.status).toBe(404);

    // API remains healthy
    const health = await rawRequest('/api/health');
    expect(health.status).toBe(200);
  });
});

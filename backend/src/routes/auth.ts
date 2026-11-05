import { Hono } from 'hono';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getPool, withUserContext } from '../db.js';
import {
  generateOtpCode,
  hashPassword,
  normalizeCameroonPhone,
  sha256Hex,
  signOfflineLeaseToken,
  verifyPassword,
} from '../utils/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { dispatchNotification } from '../services/whatsapp.js';

export const authRoutes = new Hono();

const phoneSchema = z
  .string()
  .min(8)
  .transform(normalizeCameroonPhone)
  .refine((val) => /^\+[0-9]{8,15}$/.test(val), {
    message: 'Numéro de téléphone invalide (format attendu : +2376XXXXXXXX)',
  });

async function createSessionForUser(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const pool = getPool();
  await pool.query(
    `INSERT INTO public.sessions (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + interval '30 days', $3, $4)`,
    [userId, tokenHash, ip ?? null, userAgent ?? null]
  );
  return rawToken;
}

async function buildStudentAndLeaseState(userId: string, role: 'admin' | 'student') {
  return withUserContext(userId, async (client) => {
    const stuRes = await client.query(
      `SELECT s.*,
              lc.code AS licence_code,
              lc.name AS licence_name,
              public.student_has_paid(s.id) AS has_paid,
              public.student_has_access(s.id) AS has_access,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (s.trial_ends_at - now())) / 86400.0))::int AS trial_days_left
       FROM public.students s
       LEFT JOIN public.licence_categories lc ON lc.id = s.licence_category_id
       WHERE s.user_id = $1`,
      [userId]
    );

    const student = stuRes.rows[0] || null;
    const serverTimeMs = Date.now();
    const hasPaid = student ? Boolean(student.has_paid) : role === 'admin';
    const hasAccess = student ? Boolean(student.has_access) : role === 'admin';
    const trialEndsAt = student?.trial_ends_at
      ? new Date(student.trial_ends_at).toISOString()
      : null;

    // Unpaid trial users must sync at least every 72h; paid users can stay offline up to 14 days
    const leaseDurationMs = hasPaid ? 14 * 24 * 3600 * 1000 : 3 * 24 * 3600 * 1000;
    const maxOfflineUntilMs = trialEndsAt && !hasPaid
      ? Math.min(serverTimeMs + leaseDurationMs, new Date(trialEndsAt).getTime())
      : serverTimeMs + leaseDurationMs;

    const offlineLeaseToken = await signOfflineLeaseToken({
      sub: userId,
      studentId: student?.id ?? null,
      role,
      hasAccess,
      hasPaid,
      trialEndsAt,
      serverTimeMs,
      maxOfflineUntilMs,
    });

    return {
      student,
      offlineLeaseToken,
      accessState: {
        hasAccess,
        hasPaid,
        trialEndsAt,
        trialDaysLeft: student?.trial_days_left ?? 0,
        serverTimeMs,
        maxOfflineUntilMs,
      },
    };
  });
}

// 1. Public Catalogue for Registration Screen (Licences & Open Groups)
authRoutes.get('/catalogue', async (c) => {
  const pool = getPool();
  const [licences, groups, installments, settings] = await Promise.all([
    pool.query(`SELECT id, code, name, is_active FROM public.licence_categories WHERE is_active = true ORDER BY code`),
    pool.query(
      `SELECT g.id, g.licence_category_id, g.name, g.start_date, g.capacity, g.total_fee::bigint AS total_fee, g.status,
              go.confirmed_seats
       FROM public.groups g
       LEFT JOIN public.group_occupancy go ON go.group_id = g.id
       WHERE g.status = 'open'
       ORDER BY g.start_date NULLS LAST, g.name`
    ),
    pool.query(
      `SELECT i.id, i.group_id, i.position, i.label, i.amount::bigint AS amount, i.due_date
       FROM public.installments i
       JOIN public.groups g ON g.id = i.group_id
       WHERE g.status = 'open'
       ORDER BY i.group_id, i.position`
    ),
    pool.query(`SELECT school_name, trial_days, receipt_prefix, school_phone, school_address FROM public.app_settings WHERE id = 1`),
  ]);

  return c.json({
    settings: settings.rows[0],
    licenceCategories: licences.rows.map((r) => ({ ...r })),
    groups: groups.rows.map((g) => ({
      ...g,
      total_fee: Number(g.total_fee),
      confirmed_seats: Number(g.confirmed_seats ?? 0),
    })),
    installments: installments.rows.map((i) => ({
      ...i,
      amount: Number(i.amount),
    })),
  });
});

// 2. Request Phone Verification OTP Code
authRoutes.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ phone: phoneSchema }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'INVALID_PHONE', message: parsed.error.issues[0].message }, 400);
  }

  const phone = parsed.data.phone;
  const pool = getPool();

  // Check if the school already created a walk-in record without login
  const existingWalkIn = await pool.query(
    `SELECT id, full_name, user_id FROM public.students WHERE phone = $1`,
    [phone]
  );

  const otpCode = generateOtpCode();
  const otpHash = sha256Hex(otpCode);

  await pool.query(
    `INSERT INTO public.verifications (identifier, value, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [phone, otpHash]
  );

  const messageText =
    `🔐 *Auto-école La Marseillaise*\n` +
    `Votre code de vérification est : *${otpCode}* (valable 10 minutes).`;

  const notif = await dispatchNotification({
    event: 'phone_otp',
    recipientPhone: phone,
    messageText,
  });

  const isWalkInUnclaimed =
    existingWalkIn.rowCount! > 0 && existingWalkIn.rows[0].user_id === null;

  return c.json({
    ok: true,
    phone,
    isWalkInUnclaimed,
    walkInName: isWalkInUnclaimed ? existingWalkIn.rows[0].full_name : null,
    // Expose devOtp when no external SMS/WhatsApp API token is configured so testing works seamlessly
    devOtpPreview: !notif.sentViaApi ? otpCode : undefined,
  });
});

// 3. Student Self-Registration
const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Le nom complet est requis'),
  phone: phoneSchema,
  email: z.string().email().optional().or(z.literal('')).transform((v) => v || null),
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
  otpCode: z.string().trim().length(6, 'Le code de vérification à 6 chiffres est requis'),
  licenceCategoryId: z.string().uuid('Catégorie de permis invalide'),
  groupId: z.string().uuid('Groupe invalide').nullable().optional(),
});

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const { fullName, phone, email, password, otpCode, licenceCategoryId, groupId } = parsed.data;
  const pool = getPool();

  // Verify OTP code
  const otpHash = sha256Hex(otpCode);
  const verifRes = await pool.query(
    `SELECT id FROM public.verifications
     WHERE identifier = $1 AND value = $2 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, otpHash]
  );

  if (verifRes.rowCount === 0) {
    return c.json({ error: 'INVALID_OTP', message: 'Code de vérification invalide ou expiré.' }, 400);
  }

  // Check if phone already exists in students (walk-in or already registered)
  const existingStu = await pool.query(`SELECT id, user_id FROM public.students WHERE phone = $1`, [phone]);
  if (existingStu.rowCount! > 0) {
    if (existingStu.rows[0].user_id === null) {
      return c.json(
        {
          error: 'PHONE_EXISTS_USE_INVITE',
          message:
            "L'auto-école a déjà créé votre dossier pour ce numéro. Veuillez utiliser votre code d'invitation pour activer votre compte.",
        },
        409
      );
    }
    return c.json({ error: 'PHONE_EXISTS', message: 'Ce numéro de téléphone possède déjà un compte.' }, 409);
  }

  const passwordHash = await hashPassword(password);

  try {
    const newUserRes = await pool.query(
      `INSERT INTO public.users (name, email, phone, phone_verified, password_hash)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id`,
      [fullName, email, phone, passwordHash]
    );
    const userId = newUserRes.rows[0].id;

    await pool.query(`UPDATE public.verifications SET used_at = now() WHERE id = $1`, [
      verifRes.rows[0].id,
    ]);

    const studentId = await withUserContext(userId, async (client) => {
      const regRes = await client.query(
        `SELECT public.register_student($1, $2, $3, $4, $5) AS student_id`,
        [fullName, phone, email, licenceCategoryId, groupId ?? null]
      );
      return regRes.rows[0].student_id as string;
    });

    const token = await createSessionForUser(
      userId,
      c.req.header('x-forwarded-for'),
      c.req.header('user-agent')
    );
    const state = await buildStudentAndLeaseState(userId, 'student');

    return c.json(
      {
        token,
        user: {
          id: userId,
          name: fullName,
          email,
          phone,
          role: 'student',
        },
        studentId,
        ...state,
      },
      201
    );
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('PHONE_EXISTS') || msg.includes('users_phone_key')) {
      return c.json({ error: 'PHONE_EXISTS', message: 'Ce numéro de téléphone est déjà enregistré.' }, 409);
    }
    if (msg.includes('INVALID_GROUP')) {
      return c.json({ error: 'INVALID_GROUP', message: 'Ce groupe ne correspond pas au permis choisi ou est fermé.' }, 400);
    }
    return c.json({ error: 'REGISTRATION_FAILED', message: msg || "Erreur lors de l'inscription." }, 400);
  }
});

// 4. Claim Walk-In Invite Code
const claimInviteSchema = z.object({
  inviteCode: z.string().trim().min(6, "Code d'invitation requis"),
  phone: phoneSchema,
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
  email: z.string().email().optional().or(z.literal('')).transform((v) => v || null),
});

authRoutes.post('/claim-invite', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = claimInviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const { inviteCode, phone, password, email } = parsed.data;
  const pool = getPool();

  // Verify the student record matches this phone and has a valid invite code
  const codeHash = sha256Hex(inviteCode.toUpperCase().trim());
  const invCheck = await pool.query(
    `SELECT i.id, i.student_id, s.full_name, s.phone, s.user_id
     FROM public.invites i
     JOIN public.students s ON s.id = i.student_id
     WHERE i.code_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [codeHash]
  );

  if (invCheck.rowCount === 0) {
    return c.json({ error: 'INVALID_OR_EXPIRED_CODE', message: "Code d'invitation invalide ou expiré." }, 400);
  }

  const inviteRow = invCheck.rows[0];
  if (inviteRow.phone !== phone) {
    return c.json(
      {
        error: 'PHONE_MISMATCH',
        message: "Ce code d'invitation ne correspond pas au numéro de téléphone saisi.",
      },
      400
    );
  }

  if (inviteRow.user_id !== null) {
    return c.json({ error: 'ALREADY_CLAIMED', message: 'Ce compte élève a déjà été activé.' }, 409);
  }

  const passwordHash = await hashPassword(password);

  try {
    const newUserRes = await pool.query(
      `INSERT INTO public.users (name, email, phone, phone_verified, password_hash)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id`,
      [inviteRow.full_name, email, phone, passwordHash]
    );
    const userId = newUserRes.rows[0].id;

    const studentId = await withUserContext(userId, async (client) => {
      const claimRes = await client.query(`SELECT public.claim_invite($1) AS student_id`, [
        inviteCode.toUpperCase().trim(),
      ]);
      if (email) {
        await client.query(`UPDATE public.students SET email = $1 WHERE id = $2`, [
          email,
          claimRes.rows[0].student_id,
        ]);
      }
      return claimRes.rows[0].student_id as string;
    });

    const token = await createSessionForUser(
      userId,
      c.req.header('x-forwarded-for'),
      c.req.header('user-agent')
    );
    const state = await buildStudentAndLeaseState(userId, 'student');

    return c.json({
      token,
      user: {
        id: userId,
        name: inviteRow.full_name,
        email,
        phone,
        role: 'student',
      },
      studentId,
      ...state,
    });
  } catch (err: any) {
    return c.json(
      { error: 'CLAIM_FAILED', message: err?.message || "Impossible d'activer le compte." },
      400
    );
  }
});

// 5. Login (Phone or Email + Password)
const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Numéro de téléphone ou e-mail requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const { identifier, password } = parsed.data;
  const normalizedPhone = identifier.includes('@') ? identifier : normalizeCameroonPhone(identifier);
  const pool = getPool();

  const userRes = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.password_hash, COALESCE(p.role, 'student') AS role
     FROM public.users u
     LEFT JOIN public.profiles p ON p.id = u.id
     WHERE u.phone = $1 OR LOWER(u.email) = LOWER($2)
     LIMIT 1`,
    [normalizedPhone, identifier]
  );

  if (userRes.rowCount === 0 || !userRes.rows[0].password_hash) {
    return c.json({ error: 'INVALID_CREDENTIALS', message: 'Identifiants incorrects.' }, 401);
  }

  const userRow = userRes.rows[0];
  const valid = await verifyPassword(password, userRow.password_hash);
  if (!valid) {
    return c.json({ error: 'INVALID_CREDENTIALS', message: 'Identifiants incorrects.' }, 401);
  }

  const token = await createSessionForUser(
    userRow.id,
    c.req.header('x-forwarded-for'),
    c.req.header('user-agent')
  );
  const state = await buildStudentAndLeaseState(userRow.id, userRow.role);

  return c.json({
    token,
    user: {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      phone: userRow.phone,
      role: userRow.role,
    },
    ...state,
  });
});

// 6. Current Session & Offline Lease Refresh
authRoutes.get('/session', requireAuth, async (c) => {
  const user = c.get('user')!;
  const state = await buildStudentAndLeaseState(user.id, user.role);
  return c.json({
    user,
    ...state,
  });
});

// 7. Logout
authRoutes.post('/logout', requireAuth, async (c) => {
  const user = c.get('user')!;
  const pool = getPool();
  await pool.query(`DELETE FROM public.sessions WHERE id = $1`, [user.sessionId]);
  return c.json({ ok: true });
});

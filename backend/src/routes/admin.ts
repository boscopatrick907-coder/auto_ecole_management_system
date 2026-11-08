import { Hono } from 'hono';
import { z } from 'zod';
import { withUserContext } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { normalizeCameroonPhone } from '../utils/crypto.js';
import { computeStudentGlobalStatus } from './student.js';
import {
  isoCalendarDateSchema,
  isValidUuid,
  safeNonNegativeMoneySchema,
  safePositiveMoneySchema,
} from '../utils/validation.js';
import {
  buildWaMeLink,
  dispatchNotification,
  formatInviteMessage,
  formatPaymentConfirmationMessage,
  formatReminderMessage,
  runScheduledReminders,
} from '../services/whatsapp.js';

export const adminRoutes = new Hono();

adminRoutes.use('*', requireAdmin);

// 1. Executive Dashboard (Big KPI Numbers + "À Traiter" Action List + Charts)
adminRoutes.get('/dashboard', async (c) => {
  const user = c.get('user')!;

  return withUserContext(user.id, async (client) => {
    const kpiRes = await client.query(`SELECT public.admin_dashboard() AS kpis`);
    const overdueRes = await client.query(
      `SELECT ist.enrollment_id, ist.student_id, ist.position, ist.label,
              ist.amount::bigint AS amount, ist.due_date,
              ist.cumulative_due::bigint AS cumulative_due,
              ist.paid_total::bigint AS paid_total,
              s.full_name, s.phone,
              g.name AS group_name, lc.code AS licence_code
       FROM public.installment_status ist
       JOIN public.students s ON s.id = ist.student_id
       JOIN public.enrollments e ON e.id = ist.enrollment_id
       JOIN public.groups g ON g.id = e.group_id
       JOIN public.licence_categories lc ON lc.id = g.licence_category_id
       WHERE ist.status = 'overdue' AND e.status <> 'cancelled'
       ORDER BY ist.due_date ASC`
    );
    const expiredTrialRes = await client.query(
      `SELECT s.id AS student_id, s.full_name, s.phone, s.trial_ends_at,
              lc.code AS licence_code, g.name AS group_name
       FROM public.students s
       LEFT JOIN public.licence_categories lc ON lc.id = s.licence_category_id
       LEFT JOIN public.enrollments e ON e.student_id = s.id
       LEFT JOIN public.groups g ON g.id = e.group_id
       WHERE s.trial_ends_at <= now() AND NOT public.student_has_paid(s.id)
       ORDER BY s.trial_ends_at DESC`
    );
    const byLicenceRes = await client.query(
      `SELECT lc.code, lc.name,
              COUNT(DISTINCT s.id)::int AS students_count,
              COALESCE(SUM(eb.paid), 0)::bigint AS paid_amount,
              COALESCE(SUM(eb.balance), 0)::bigint AS balance_amount
       FROM public.licence_categories lc
       LEFT JOIN public.students s ON s.licence_category_id = lc.id
       LEFT JOIN public.enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
       LEFT JOIN public.enrollment_balances eb ON eb.enrollment_id = e.id
       GROUP BY lc.id, lc.code, lc.name
       ORDER BY lc.code`
    );
    const recentPaymentsRes = await client.query(
      `SELECT p.id, p.amount::bigint AS amount, p.method, p.receipt_number, p.paid_at,
              p.cancelled_at, p.cancel_reason,
              s.id AS student_id, s.full_name, s.phone,
              g.name AS group_name
       FROM public.payments p
       JOIN public.enrollments e ON e.id = p.enrollment_id
       JOIN public.students s ON s.id = e.student_id
       JOIN public.groups g ON g.id = e.group_id
       ORDER BY p.paid_at DESC
       LIMIT 10`
    );

    const overdueActionList = overdueRes.rows.map((r) => {
      const amountOwedOnTranche = Math.max(
        0,
        Number(r.cumulative_due) - Number(r.paid_total)
      );
      const dueStr = new Date(r.due_date).toLocaleDateString('fr-FR');
      const msg = formatReminderMessage({
        studentName: r.full_name,
        type: 'installment_overdue',
        trancheLabel: r.label,
        amountDue: amountOwedOnTranche,
        dueDate: dueStr,
      });
      return {
        ...r,
        amount: Number(r.amount),
        amount_owed_on_tranche: amountOwedOnTranche,
        wa_me_link: buildWaMeLink(r.phone, msg),
      };
    });

    const expiredTrialsActionList = expiredTrialRes.rows.map((r) => {
      const msg = formatReminderMessage({
        studentName: r.full_name,
        type: 'trial_day_14',
      });
      return {
        ...r,
        wa_me_link: buildWaMeLink(r.phone, msg),
      };
    });

    return c.json({
      kpis: kpiRes.rows[0].kpis,
      actionList: {
        overdueInstallments: overdueActionList,
        expiredUnpaidTrials: expiredTrialsActionList,
      },
      licenceBreakdown: byLicenceRes.rows.map((b) => ({
        ...b,
        paid_amount: Number(b.paid_amount),
        balance_amount: Number(b.balance_amount),
      })),
      recentPayments: recentPaymentsRes.rows.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
    });
  });
});

// 2. List Students with Search, Filters & Computed Statuses
adminRoutes.get('/students', async (c) => {
  const user = c.get('user')!;
  const search = (c.req.query('search') || '').trim().toLowerCase();
  const licenceId = (c.req.query('licenceCategoryId') || '').trim();
  const groupId = (c.req.query('groupId') || '').trim();
  const statusFilter = (c.req.query('status') || '').trim();

  if (licenceId && !isValidUuid(licenceId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant de catégorie de permis invalide.' }, 400);
  }
  if (groupId && !isValidUuid(groupId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant de groupe invalide.' }, 400);
  }

  return withUserContext(user.id, async (client) => {
    const stuRes = await client.query(
      `SELECT s.*,
              lc.code AS licence_code,
              lc.name AS licence_name,
              e.id AS enrollment_id,
              e.group_id,
              e.status AS enrollment_status,
              g.name AS group_name,
              COALESCE(eb.total_fee, 0)::bigint AS total_fee,
              COALESCE(eb.paid, 0)::bigint AS paid,
              COALESCE(eb.balance, 0)::bigint AS balance,
              public.student_has_paid(s.id) AS has_paid,
              public.student_has_access(s.id) AS has_access,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (s.trial_ends_at - now())) / 86400.0))::int AS trial_days_left
       FROM public.students s
       LEFT JOIN public.licence_categories lc ON lc.id = s.licence_category_id
       LEFT JOIN public.enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
       LEFT JOIN public.groups g ON g.id = e.group_id
       LEFT JOIN public.enrollment_balances eb ON eb.enrollment_id = e.id
       ORDER BY s.registered_at DESC`
    );

    const instRes = await client.query(
      `SELECT enrollment_id, installment_id, position, label, amount::bigint AS amount,
              due_date, cumulative_due::bigint AS cumulative_due, paid_total::bigint AS paid_total, status
       FROM public.installment_status
       ORDER BY enrollment_id, position ASC`
    );

    const instByEnrollment: Record<string, any[]> = {};
    for (const row of instRes.rows) {
      if (!instByEnrollment[row.enrollment_id]) instByEnrollment[row.enrollment_id] = [];
      instByEnrollment[row.enrollment_id].push({
        ...row,
        amount: Number(row.amount),
        cumulative_due: Number(row.cumulative_due),
        paid_total: Number(row.paid_total),
      });
    }

    let students = stuRes.rows.map((s) => {
      const installments = s.enrollment_id ? instByEnrollment[s.enrollment_id] || [] : [];
      const computedStatus = computeStudentGlobalStatus({
        enrollmentStatus: s.enrollment_status,
        balance: Number(s.balance),
        hasPaid: Boolean(s.has_paid),
        trialDaysLeft: Number(s.trial_days_left ?? 0),
        installments,
      });
      const nextInstallment = installments.find((i) => i.status !== 'paid') || null;
      return {
        ...s,
        total_fee: Number(s.total_fee),
        paid: Number(s.paid),
        balance: Number(s.balance),
        computed_status: computedStatus,
        installments,
        next_installment: nextInstallment,
      };
    });

    if (search) {
      students = students.filter(
        (s) =>
          s.full_name.toLowerCase().includes(search) ||
          s.phone.toLowerCase().includes(search) ||
          (s.email && s.email.toLowerCase().includes(search))
      );
    }
    if (licenceId) {
      students = students.filter((s) => s.licence_category_id === licenceId);
    }
    if (groupId) {
      students = students.filter((s) => s.group_id === groupId);
    }
    if (statusFilter) {
      students = students.filter((s) => s.computed_status === statusFilter);
    }

    return c.json({ students });
  });
});

// 3. Single Student 360° Dossier (Fiche Élève)
adminRoutes.get('/students/:id', async (c) => {
  const user = c.get('user')!;
  const studentId = c.req.param('id');
  if (!isValidUuid(studentId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant élève invalide.' }, 400);
  }

  return withUserContext(user.id, async (client) => {
    const stuRes = await client.query(
      `SELECT s.*,
              lc.code AS licence_code,
              lc.name AS licence_name,
              public.student_has_paid(s.id) AS has_paid,
              public.student_has_access(s.id) AS has_access,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (s.trial_ends_at - now())) / 86400.0))::int AS trial_days_left
       FROM public.students s
       LEFT JOIN public.licence_categories lc ON lc.id = s.licence_category_id
       WHERE s.id = $1`,
      [studentId]
    );

    if (stuRes.rowCount === 0) {
      return c.json({ error: 'NOT_FOUND', message: 'Élève introuvable.' }, 404);
    }

    const student = stuRes.rows[0];
    const enrolRes = await client.query(
      `SELECT e.id AS enrollment_id, e.group_id, e.status AS enrollment_status, e.created_at,
              g.name AS group_name, g.start_date,
              eb.total_fee::bigint AS total_fee, eb.paid::bigint AS paid, eb.balance::bigint AS balance
       FROM public.enrollments e
       JOIN public.groups g ON g.id = e.group_id
       JOIN public.enrollment_balances eb ON eb.enrollment_id = e.id
       WHERE e.student_id = $1
       ORDER BY e.created_at DESC LIMIT 1`,
      [studentId]
    );

    const enrollment = enrolRes.rows[0]
      ? {
          ...enrolRes.rows[0],
          total_fee: Number(enrolRes.rows[0].total_fee),
          paid: Number(enrolRes.rows[0].paid),
          balance: Number(enrolRes.rows[0].balance),
        }
      : null;

    let installments: any[] = [];
    let payments: any[] = [];

    if (enrollment) {
      const instRes = await client.query(
        `SELECT installment_id, position, label, amount::bigint AS amount, due_date,
                cumulative_due::bigint AS cumulative_due, paid_total::bigint AS paid_total, status
         FROM public.installment_status
         WHERE enrollment_id = $1 ORDER BY position ASC`,
        [enrollment.enrollment_id]
      );
      const payRes = await client.query(
        `SELECT p.id, p.enrollment_id, p.amount::bigint AS amount, p.method, p.reference,
                p.receipt_number, p.paid_at, p.cancelled_at, p.cancel_reason,
                u.name AS recorded_by_name
         FROM public.payments p
         LEFT JOIN public.users u ON u.id = p.recorded_by
         WHERE p.enrollment_id = $1
         ORDER BY p.paid_at DESC`,
        [enrollment.enrollment_id]
      );

      installments = instRes.rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        cumulative_due: Number(r.cumulative_due),
        paid_total: Number(r.paid_total),
      }));

      payments = payRes.rows.map((p) => ({
        ...p,
        amount: Number(p.amount),
      }));
    }

    const attemptsRes = await client.query(
      `SELECT qa.id, qa.quiz_id, q.title AS quiz_title, q.topic, q.is_mock_exam,
              qa.score, qa.total, qa.taken_at
       FROM public.quiz_attempts qa
       JOIN public.quizzes q ON q.id = qa.quiz_id
       WHERE qa.student_id = $1
       ORDER BY qa.taken_at DESC`,
      [studentId]
    );

    const computedStatus = computeStudentGlobalStatus({
      enrollmentStatus: enrollment?.enrollment_status ?? null,
      balance: enrollment?.balance ?? 0,
      hasPaid: Boolean(student.has_paid),
      trialDaysLeft: Number(student.trial_days_left ?? 0),
      installments,
    });

    return c.json({
      student: { ...student, computed_status: computedStatus },
      enrollment,
      installments,
      payments,
      quizAttempts: attemptsRes.rows,
    });
  });
});

// 4. Rapid Walk-In Student Creation + Automatic 1-Time Invite Code Generation
const quickStudentSchema = z.object({
  fullName: z.string().trim().min(2, 'Nom complet requis'),
  phone: z
    .string()
    .min(8)
    .transform(normalizeCameroonPhone)
    .refine((v) => /^\+[0-9]{8,15}$/.test(v), 'Numéro de téléphone invalide (+237...)'),
  groupId: z.string().uuid('Groupe requis'),
  email: z.string().email().optional().or(z.literal('')).transform((v) => v || null),
});

adminRoutes.post('/students', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = quickStudentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const { fullName, phone, groupId, email } = parsed.data;

  try {
    const result = await withUserContext(user.id, async (client) => {
      const grpRes = await client.query(
        `SELECT g.id, g.licence_category_id, g.name, g.status, lc.is_active AS category_is_active
         FROM public.groups g
         JOIN public.licence_categories lc ON lc.id = g.licence_category_id
         WHERE g.id = $1`,
        [groupId]
      );
      if (grpRes.rowCount === 0) {
        throw new Error('INVALID_GROUP');
      }
      const group = grpRes.rows[0];
      if (!group.category_is_active) {
        throw new Error('INACTIVE_LICENCE_CATEGORY');
      }
      if (group.status !== 'open') {
        throw new Error('INVALID_GROUP');
      }

      const stuRes = await client.query(
        `INSERT INTO public.students (full_name, phone, email, licence_category_id, created_by_admin)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [fullName, phone, email, group.licence_category_id]
      );
      const student = stuRes.rows[0];

      const enrolRes = await client.query(
        `INSERT INTO public.enrollments (student_id, group_id)
         VALUES ($1, $2)
         RETURNING id AS enrollment_id, group_id, status`,
        [student.id, groupId]
      );

      const invRes = await client.query(`SELECT public.create_invite($1, 7) AS code`, [student.id]);
      const inviteCode = invRes.rows[0].code as string;

      return { student, enrollment: enrolRes.rows[0], inviteCode };
    });

    const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:4200';
    const messageText = formatInviteMessage({
      studentName: fullName,
      inviteCode: result.inviteCode,
      appUrl,
    });
    const notification = await dispatchNotification({
      event: 'student_invite',
      recipientPhone: phone,
      messageText,
      dedupKey: `student_invite:${result.student.id}:${result.inviteCode}`,
      persistOutbox: true,
      metadata: { studentId: result.student.id, inviteCode: result.inviteCode },
    });

    return c.json(
      {
        ...result,
        notification,
      },
      201
    );
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('students_phone_key')) {
      return c.json({ error: 'PHONE_EXISTS', message: 'Ce numéro de téléphone est déjà enregistré.' }, 409);
    }
    if (msg.includes('INACTIVE_LICENCE_CATEGORY')) {
      return c.json(
        { error: 'INACTIVE_LICENCE_CATEGORY', message: 'Cette catégorie de permis est désactivée.' },
        400
      );
    }
    if (msg.includes('INVALID_GROUP')) {
      return c.json({ error: 'INVALID_GROUP', message: 'Groupe introuvable ou fermé.' }, 400);
    }
    return c.json({ error: 'CREATE_STUDENT_FAILED', message: msg }, 400);
  }
});

// 5. Generate New Invite Code for Walk-In Student
adminRoutes.post('/students/:id/invite', async (c) => {
  const user = c.get('user')!;
  const studentId = c.req.param('id');
  if (!isValidUuid(studentId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant élève invalide.' }, 400);
  }

  const result = await withUserContext(user.id, async (client) => {
    const stuRes = await client.query(
      `SELECT id, full_name, phone, user_id FROM public.students WHERE id = $1`,
      [studentId]
    );
    if (stuRes.rowCount === 0) return null;
    const student = stuRes.rows[0];
    const invRes = await client.query(`SELECT public.create_invite($1, 7) AS code`, [studentId]);
    return { student, inviteCode: invRes.rows[0].code as string };
  });

  if (!result) {
    return c.json({ error: 'NOT_FOUND', message: 'Élève introuvable.' }, 404);
  }

  const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:4200';
  const messageText = formatInviteMessage({
    studentName: result.student.full_name,
    inviteCode: result.inviteCode,
    appUrl,
  });
  const notification = await dispatchNotification({
    event: 'student_invite',
    recipientPhone: result.student.phone,
    messageText,
    dedupKey: `student_invite:${studentId}:${result.inviteCode}`,
    persistOutbox: true,
    metadata: { studentId, inviteCode: result.inviteCode },
  });

  return c.json({
    inviteCode: result.inviteCode,
    notification,
  });
});

// 6. Record Payment (Calls public.record_payment with Idempotency & Balance Guard)
const recordPaymentSchema = z.object({
  enrollmentId: z.string().uuid('Inscription invalide'),
  amount: safePositiveMoneySchema,
  method: z.enum(['cash', 'mtn_momo', 'orange_money', 'bank']).default('cash'),
  reference: z.string().trim().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  receiptNumber: z.string().trim().optional().nullable(),
});

adminRoutes.post('/payments', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = recordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const { enrollmentId, amount, method, reference, clientId, paidAt, receiptNumber } = parsed.data;

  try {
    const result = await withUserContext(user.id, async (client) => {
      const payRes = await client.query(
        `SELECT * FROM public.record_payment(
           $1::uuid,
           $2::bigint,
           $3::public.payment_method,
           $4::text,
           $5::uuid,
           COALESCE($6::timestamptz, now()),
           $7::text
         )`,
        [
          enrollmentId,
          amount,
          method,
          reference ?? null,
          clientId ?? null,
          paidAt ?? null,
          receiptNumber ?? null,
        ]
      );
      const payment = payRes.rows[0];

      const detailsRes = await client.query(
        `SELECT s.id AS student_id, s.full_name, s.phone,
                g.name AS group_name, lc.code AS licence_code, lc.name AS licence_name,
                eb.total_fee::bigint AS total_fee, eb.paid::bigint AS paid, eb.balance::bigint AS balance
         FROM public.enrollments e
         JOIN public.students s ON s.id = e.student_id
         JOIN public.groups g ON g.id = e.group_id
         JOIN public.licence_categories lc ON lc.id = g.licence_category_id
         JOIN public.enrollment_balances eb ON eb.enrollment_id = e.id
         WHERE e.id = $1`,
        [enrollmentId]
      );

      const nextInstRes = await client.query(
        `SELECT label, due_date, amount::bigint AS amount
         FROM public.installment_status
         WHERE enrollment_id = $1 AND status <> 'paid'
         ORDER BY position ASC LIMIT 1`,
        [enrollmentId]
      );

      return {
        payment: { ...payment, amount: Number(payment.amount) },
        details: {
          ...detailsRes.rows[0],
          total_fee: Number(detailsRes.rows[0].total_fee),
          paid: Number(detailsRes.rows[0].paid),
          balance: Number(detailsRes.rows[0].balance),
        },
        nextInstallment: nextInstRes.rows[0] || null,
      };
    });

    const nextDueStr = result.nextInstallment?.due_date
      ? new Date(result.nextInstallment.due_date).toLocaleDateString('fr-FR')
      : null;

    const messageText = formatPaymentConfirmationMessage({
      studentName: result.details.full_name,
      amount: result.payment.amount,
      receiptNumber: result.payment.receipt_number,
      method: result.payment.method,
      balance: result.details.balance,
      nextDueDate: nextDueStr,
    });

    const notification = await dispatchNotification({
      event: 'payment_confirmed',
      recipientPhone: result.details.phone,
      messageText,
      dedupKey: `payment_confirmed:${result.payment.id}`,
      persistOutbox: true,
      metadata: {
        paymentId: result.payment.id,
        receiptNumber: result.payment.receipt_number,
        amount: result.payment.amount,
        balance: result.details.balance,
      },
    });

    return c.json(
      {
        ...result,
        notification,
      },
      201
    );
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('GROUP_FULL')) {
      return c.json(
        {
          error: 'GROUP_FULL',
          message: 'Ce groupe a atteint sa capacité maximale de places confirmées.',
        },
        409
      );
    }
    if (msg.includes('IDEMPOTENCY_CONFLICT')) {
      return c.json(
        {
          error: 'IDEMPOTENCY_CONFLICT',
          message: "Conflit d'identifiant de transaction (clientId déjà attribué à une autre opération).",
        },
        409
      );
    }
    if (msg.includes('EXCEEDS_BALANCE')) {
      return c.json(
        {
          error: 'EXCEEDS_BALANCE',
          message: "Le montant saisi dépasse le solde restant dû par l'élève.",
        },
        400
      );
    }
    if (msg.includes('ENROLLMENT_NOT_FOUND')) {
      return c.json({ error: 'ENROLLMENT_NOT_FOUND', message: 'Inscription introuvable.' }, 404);
    }
    return c.json({ error: 'PAYMENT_ERROR', message: msg }, 400);
  }
});

// 7. Cancel Payment (Mandatory Reason — Original Row Remains Visible + Audit Log)
adminRoutes.post('/payments/:id/cancel', async (c) => {
  const user = c.get('user')!;
  const paymentId = c.req.param('id');
  if (!isValidUuid(paymentId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant de paiement invalide.' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!reason) {
    return c.json(
      { error: 'REASON_REQUIRED', message: "Le motif d'annulation est obligatoire." },
      400
    );
  }

  try {
    await withUserContext(user.id, async (client) => {
      await client.query(`SELECT public.cancel_payment($1::uuid, $2::text)`, [paymentId, reason]);
    });
    return c.json({ ok: true, paymentId, cancelReason: reason });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('NOT_FOUND_OR_ALREADY_CANCELLED')) {
      return c.json(
        { error: 'NOT_FOUND_OR_ALREADY_CANCELLED', message: 'Paiement introuvable ou déjà annulé.' },
        400
      );
    }
    return c.json({ error: 'CANCEL_FAILED', message: msg }, 400);
  }
});

// 8. Catalogue Configuration: Groups & Installment Plan Builder
const createGroupSchema = z.object({
  licenceCategoryId: z.string().uuid(),
  name: z.string().trim().min(2),
  startDate: isoCalendarDateSchema.optional().nullable(),
  capacity: z.number().int().positive().max(10000).optional().nullable(),
  totalFee: safeNonNegativeMoneySchema,
  status: z.enum(['open', 'closed', 'finished']).default('open'),
  installments: z
    .array(
      z.object({
        position: z.number().int().positive(),
        label: z.string().trim().min(1),
        amount: safePositiveMoneySchema,
        dueDate: isoCalendarDateSchema,
      })
    )
    .min(1, "L'échéancier doit comporter au moins une tranche")
    .max(24, "L'échéancier ne peut pas dépasser 24 tranches"),
});

adminRoutes.get('/groups', async (c) => {
  const user = c.get('user')!;
  return withUserContext(user.id, async (client) => {
    const licences = await client.query(`SELECT * FROM public.licence_categories ORDER BY code`);
    const groups = await client.query(
      `SELECT g.*, lc.code AS licence_code, lc.name AS licence_name,
              go.confirmed_seats, go.trial_seats
       FROM public.groups g
       JOIN public.licence_categories lc ON lc.id = g.licence_category_id
       LEFT JOIN public.group_occupancy go ON go.group_id = g.id
       ORDER BY g.created_at DESC`
    );
    const installments = await client.query(`SELECT * FROM public.installments ORDER BY group_id, position ASC`);

    const instByGroup: Record<string, any[]> = {};
    for (const i of installments.rows) {
      if (!instByGroup[i.group_id]) instByGroup[i.group_id] = [];
      instByGroup[i.group_id].push({ ...i, amount: Number(i.amount) });
    }

    return c.json({
      licenceCategories: licences.rows,
      groups: groups.rows.map((g) => ({
        ...g,
        total_fee: Number(g.total_fee),
        installments: instByGroup[g.id] || [],
      })),
    });
  });
});

adminRoutes.post('/groups', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  const data = parsed.data;

  // E07: Enforce contiguous positions (1..N) and chronological dueDate order
  const sortedInst = [...data.installments].sort((a, b) => a.position - b.position);
  for (let idx = 0; idx < sortedInst.length; idx++) {
    const expectedPos = idx + 1;
    if (sortedInst[idx].position !== expectedPos) {
      return c.json(
        {
          error: 'INVALID_INSTALLMENT_POSITIONS',
          message: `Les positions des tranches doivent être continues de 1 à ${sortedInst.length} sans doublon ni saut.`,
        },
        400
      );
    }
    if (idx > 0 && sortedInst[idx].dueDate < sortedInst[idx - 1].dueDate) {
      return c.json(
        {
          error: 'INVALID_INSTALLMENT_CHRONOLOGY',
          message: `Les dates d'échéance des tranches doivent suivre un ordre chronologique (Tranche ${expectedPos} ne peut pas précéder Tranche ${idx}).`,
        },
        400
      );
    }
  }

  const sumInstallments = sortedInst.reduce((acc, item) => acc + item.amount, 0);
  if (sumInstallments !== data.totalFee) {
    return c.json(
      {
        error: 'INSTALLMENT_SUM_MISMATCH',
        message: `La somme des tranches (${sumInstallments.toLocaleString('fr-FR')} FCFA) doit être exactement égale aux frais totaux du groupe (${data.totalFee.toLocaleString('fr-FR')} FCFA).`,
      },
      400
    );
  }

  try {
    const group = await withUserContext(user.id, async (client) => {
      const catCheck = await client.query(
        `SELECT id, is_active FROM public.licence_categories WHERE id = $1`,
        [data.licenceCategoryId]
      );
      if (catCheck.rowCount === 0) {
        throw new Error('INVALID_LICENCE_CATEGORY');
      }
      if (!catCheck.rows[0].is_active) {
        throw new Error('INACTIVE_LICENCE_CATEGORY');
      }

      const gRes = await client.query(
        `INSERT INTO public.groups (licence_category_id, name, start_date, capacity, total_fee, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          data.licenceCategoryId,
          data.name,
          data.startDate ?? null,
          data.capacity ?? null,
          data.totalFee,
          data.status,
        ]
      );
      const createdGroup = gRes.rows[0];

      for (const inst of sortedInst) {
        await client.query(
          `INSERT INTO public.installments (group_id, position, label, amount, due_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [createdGroup.id, inst.position, inst.label, inst.amount, inst.dueDate]
        );
      }

      return createdGroup;
    });

    return c.json({ group: { ...group, total_fee: Number(group.total_fee) } }, 201);
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('INACTIVE_LICENCE_CATEGORY')) {
      return c.json(
        {
          error: 'INACTIVE_LICENCE_CATEGORY',
          message: 'Impossible de créer un groupe pour une catégorie de permis désactivée.',
        },
        400
      );
    }
    if (msg.includes('INVALID_LICENCE_CATEGORY')) {
      return c.json(
        { error: 'INVALID_LICENCE_CATEGORY', message: 'Catégorie de permis introuvable.' },
        400
      );
    }
    throw err;
  }
});

// 9. Pedagogical Content Management (Resources & Quizzes)
adminRoutes.get('/content', async (c) => {
  const user = c.get('user')!;
  return withUserContext(user.id, async (client) => {
    const resources = await client.query(
      `SELECT r.*, lc.code AS licence_code
       FROM public.resources r
       JOIN public.licence_categories lc ON lc.id = r.licence_category_id
       ORDER BY lc.code, r.sort_order ASC`
    );
    const quizzes = await client.query(
      `SELECT q.*, lc.code AS licence_code
       FROM public.quizzes q
       JOIN public.licence_categories lc ON lc.id = q.licence_category_id
       ORDER BY lc.code, q.created_at DESC`
    );
    const questions = await client.query(`SELECT * FROM public.questions ORDER BY quiz_id, position ASC`);

    return c.json({
      resources: resources.rows,
      quizzes: quizzes.rows,
      questions: questions.rows,
    });
  });
});

adminRoutes.post('/content/resources', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({
    licenceCategoryId: z.string().uuid(),
    title: z.string().trim().min(2),
    description: z.string().optional().nullable(),
    type: z.enum(['pdf', 'video', 'image', 'link']),
    storagePath: z.string().optional().nullable(),
    externalUrl: z.string().optional().nullable(),
    fileSizeKb: z.number().int().positive().optional().nullable(),
    sortOrder: z.number().int().default(0),
    isPublished: z.boolean().default(true),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }
  const d = parsed.data;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `INSERT INTO public.resources
       (licence_category_id, title, description, type, storage_path, external_url, file_size_kb, sort_order, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        d.licenceCategoryId,
        d.title,
        d.description ?? null,
        d.type,
        d.storagePath ?? `resources/${Date.now()}.pdf`,
        d.externalUrl ?? null,
        d.fileSizeKb ?? 500,
        d.sortOrder,
        d.isPublished,
      ]
    );
    return c.json({ resource: res.rows[0] }, 201);
  });
});

// 10. Immutable Payment Audit Log
adminRoutes.get('/audit-log', async (c) => {
  const user = c.get('user')!;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `SELECT al.id, al.at, al.actor, u.name AS actor_name, al.action, al.table_name, al.row_id, al.details
       FROM public.audit_log al
       LEFT JOIN public.users u ON u.id = al.actor
       ORDER BY al.at DESC
       LIMIT 100`
    );
    return c.json({ auditLog: res.rows });
  });
});

// 11. E12 — Durable Notification Outbox & Scheduled Reminders (Africa/Douala)
adminRoutes.get('/notifications/outbox', async (c) => {
  const user = c.get('user')!;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `SELECT id, dedup_key, event_type, recipient_phone, status, attempts, last_error,
              next_retry_at, sent_at, created_at, updated_at
       FROM public.notification_outbox
       ORDER BY created_at DESC
       LIMIT 100`
    );
    return c.json({ outbox: res.rows });
  });
});

const runRemindersSchema = z.object({
  referenceDate: isoCalendarDateSchema.optional(),
  includeWeeklySummary: z.boolean().optional().default(true),
  dryRunExternal: z.boolean().optional(),
});

adminRoutes.post('/notifications/run-reminders', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = runRemindersSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }
  const summary = await runScheduledReminders(parsed.data);
  return c.json(summary);
});

// 12. E10 — School Settings, Licence Categories & Group Status Management
adminRoutes.get('/settings', async (c) => {
  const user = c.get('user')!;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(`SELECT * FROM public.app_settings WHERE id = 1`);
    return c.json({ settings: res.rows[0] });
  });
});

const updateSettingsSchema = z.object({
  schoolName: z.string().trim().min(2).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  receiptPrefix: z.string().trim().min(1).max(16).optional(),
  schoolPhone: z.string().trim().optional().nullable(),
  schoolAddress: z.string().trim().optional().nullable(),
});

adminRoutes.patch('/settings', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }
  const d = parsed.data;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `UPDATE public.app_settings
       SET school_name = COALESCE($1, school_name),
           trial_days = COALESCE($2, trial_days),
           receipt_prefix = COALESCE($3, receipt_prefix),
           school_phone = COALESCE($4, school_phone),
           school_address = COALESCE($5, school_address)
       WHERE id = 1
       RETURNING *`,
      [
        d.schoolName ?? null,
        d.trialDays ?? null,
        d.receiptPrefix ?? null,
        d.schoolPhone ?? null,
        d.schoolAddress ?? null,
      ]
    );
    return c.json({ settings: res.rows[0] });
  });
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(2).optional(),
  isActive: z.boolean().optional(),
});

adminRoutes.patch('/licence-categories/:id', async (c) => {
  const user = c.get('user')!;
  const categoryId = c.req.param('id');
  if (!isValidUuid(categoryId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant de catégorie invalide.' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }
  const d = parsed.data;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `UPDATE public.licence_categories
       SET name = COALESCE($1, name),
           is_active = COALESCE($2, is_active)
       WHERE id = $3
       RETURNING *`,
      [d.name ?? null, d.isActive ?? null, categoryId]
    );
    if (res.rowCount === 0) {
      return c.json({ error: 'NOT_FOUND', message: 'Catégorie introuvable.' }, 404);
    }
    return c.json({ licenceCategory: res.rows[0] });
  });
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(2).optional(),
  startDate: isoCalendarDateSchema.optional().nullable(),
  capacity: z.number().int().positive().max(10000).optional(),
  status: z.enum(['open', 'closed', 'completed']).optional(),
});

adminRoutes.patch('/groups/:id', async (c) => {
  const user = c.get('user')!;
  const groupId = c.req.param('id');
  if (!isValidUuid(groupId)) {
    return c.json({ error: 'INVALID_UUID', message: 'Identifiant de groupe invalide.' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }
  const d = parsed.data;
  return withUserContext(user.id, async (client) => {
    const res = await client.query(
      `UPDATE public.groups
       SET name = COALESCE($1, name),
           start_date = COALESCE($2::date, start_date),
           capacity = COALESCE($3, capacity),
           status = COALESCE($4::public.group_status, status)
       WHERE id = $5
       RETURNING *`,
      [d.name ?? null, d.startDate ?? null, d.capacity ?? null, d.status ?? null, groupId]
    );
    if (res.rowCount === 0) {
      return c.json({ error: 'NOT_FOUND', message: 'Groupe introuvable.' }, 404);
    }
    return c.json({ group: { ...res.rows[0], total_fee: Number(res.rows[0].total_fee) } });
  });
});



import { Hono } from 'hono';
import { z } from 'zod';
import { withUserContext } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { createResourceDownloadUrl } from '../services/storage.js';

export const studentRoutes = new Hono();

studentRoutes.use('*', requireAuth);

export function computeStudentGlobalStatus(params: {
  enrollmentStatus: string | null;
  balance: number;
  hasPaid: boolean;
  trialDaysLeft: number;
  installments: Array<{ status: string; due_date: string }>;
}): string {
  if (params.enrollmentStatus === 'completed' && params.balance <= 0) {
    return 'termine';
  }
  if (!params.hasPaid) {
    return params.trialDaysLeft > 0 ? 'en_essai_gratuit' : 'essai_termine_sans_paiement';
  }
  const hasOverdue = params.installments.some((i) => i.status === 'overdue');
  if (hasOverdue) {
    return 'tranche_en_retard';
  }
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  const hasUpcomingSoon = params.installments.some((i) => {
    if (i.status !== 'upcoming' && i.status !== 'partial') return false;
    const dueMs = new Date(i.due_date).getTime();
    return dueMs >= nowMs && dueMs - nowMs <= sevenDaysMs;
  });
  if (hasUpcomingSoon) {
    return 'tranche_bientot_due';
  }
  return 'inscrit_a_jour';
}

// 1. Student Dashboard, Profile, Installment Schedule & Receipts (Read-Only)
studentRoutes.get('/me', async (c) => {
  const user = c.get('user')!;

  const result = await withUserContext(user.id, async (client) => {
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
      [user.id]
    );

    const settingsRes = await client.query(`SELECT * FROM public.app_settings WHERE id = 1`);
    const settings = settingsRes.rows[0];

    if (stuRes.rowCount === 0) {
      return { student: null, settings };
    }

    const student = stuRes.rows[0];

    const enrolRes = await client.query(
      `SELECT e.id AS enrollment_id, e.group_id, e.status AS enrollment_status, e.created_at,
              g.name AS group_name, g.start_date, g.capacity,
              eb.total_fee::bigint AS total_fee,
              eb.paid::bigint AS paid,
              eb.balance::bigint AS balance
       FROM public.enrollments e
       JOIN public.groups g ON g.id = e.group_id
       JOIN public.enrollment_balances eb ON eb.enrollment_id = e.id
       WHERE e.student_id = $1
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [student.id]
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
      const [instRes, payRes] = await Promise.all([
        client.query(
          `SELECT installment_id, position, label, amount::bigint AS amount, due_date,
                  cumulative_due::bigint AS cumulative_due, paid_total::bigint AS paid_total, status
           FROM public.installment_status
           WHERE enrollment_id = $1
           ORDER BY position ASC`,
          [enrollment.enrollment_id]
        ),
        client.query(
          `SELECT id, enrollment_id, amount::bigint AS amount, method, reference, receipt_number,
                  paid_at, cancelled_at, cancel_reason
           FROM public.payments
           WHERE enrollment_id = $1
           ORDER BY paid_at DESC`,
          [enrollment.enrollment_id]
        ),
      ]);

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
              qa.score, qa.total, qa.taken_at, qa.client_id
       FROM public.quiz_attempts qa
       JOIN public.quizzes q ON q.id = qa.quiz_id
       WHERE qa.student_id = $1
       ORDER BY qa.taken_at DESC
       LIMIT 50`,
      [student.id]
    );

    const computedStatus = computeStudentGlobalStatus({
      enrollmentStatus: enrollment?.enrollment_status ?? null,
      balance: enrollment?.balance ?? 0,
      hasPaid: Boolean(student.has_paid),
      trialDaysLeft: Number(student.trial_days_left ?? 0),
      installments,
    });

    const nextInstallment =
      installments.find((i) => i.status !== 'paid') || null;

    return {
      settings,
      student: {
        ...student,
        computed_status: computedStatus,
      },
      enrollment,
      installments,
      nextInstallment,
      payments,
      quizAttempts: attemptsRes.rows,
    };
  });

  if (!result.student) {
    return c.json({ error: 'STUDENT_NOT_FOUND', message: 'Aucun profil élève associé à ce compte.' }, 404);
  }

  return c.json(result);
});

// 2. Course Resources (Strictly Gated by student_has_access + student's licence_category_id)
studentRoutes.get('/resources', async (c) => {
  const user = c.get('user')!;

  return withUserContext(user.id, async (client) => {
    const stuRes = await client.query(
      `SELECT s.id, s.full_name, s.licence_category_id, s.trial_ends_at,
              public.student_has_paid(s.id) AS has_paid,
              public.student_has_access(s.id) AS has_access
       FROM public.students s
       WHERE s.user_id = $1`,
      [user.id]
    );

    if (stuRes.rowCount === 0) {
      return c.json({ error: 'STUDENT_NOT_FOUND', message: 'Profil élève introuvable.' }, 404);
    }

    const student = stuRes.rows[0];
    if (!student.has_access) {
      const settingsRes = await client.query(`SELECT * FROM public.app_settings WHERE id = 1`);
      return c.json(
        {
          error: 'ACCESS_EXPIRED',
          message:
            "Votre essai gratuit de 14 jours est terminé. Réglez votre 1re tranche à l'auto-école pour débloquer définitivement vos cours et quiz.",
          trialEndsAt: student.trial_ends_at,
          settings: settingsRes.rows[0],
        },
        403
      );
    }

    const resRows = await client.query(
      `SELECT id, licence_category_id, title, description, type, storage_path, external_url,
              file_size_kb, sort_order, created_at
       FROM public.resources
       WHERE is_published = true AND licence_category_id = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [student.licence_category_id]
    );

    const resources = await Promise.all(
      resRows.rows.map(async (r) => ({
        ...r,
        download_url: r.storage_path
          ? await createResourceDownloadUrl(r.storage_path)
          : r.external_url,
      }))
    );

    return c.json({ resources });
  });
});

// 3. Offline-Capable Built-In Course File Streamer (Generates valid PDF binary for local/demo resources)
studentRoutes.get('/resources/file/:key', async (c) => {
  const user = c.get('user')!;
  const key = decodeURIComponent(c.req.param('key'));

  return withUserContext(user.id, async (client) => {
    if (user.role !== 'admin') {
      const stuRes = await client.query(
        `SELECT id, licence_category_id, public.student_has_access(id) AS has_access
         FROM public.students WHERE user_id = $1`,
        [user.id]
      );
      if (stuRes.rowCount === 0 || !stuRes.rows[0].has_access) {
        return c.json({ error: 'ACCESS_EXPIRED', message: 'Accès aux ressources bloqué.' }, 403);
      }
      const resCheck = await client.query(
        `SELECT title, description FROM public.resources
         WHERE storage_path = $1 AND licence_category_id = $2 AND is_published = true`,
        [key, stuRes.rows[0].licence_category_id]
      );
      if (resCheck.rowCount === 0) {
        return c.json({ error: 'FORBIDDEN_RESOURCE', message: 'Ressource non autorisée pour votre permis.' }, 403);
      }
    }

    // Generate a clean, valid minimal PDF document for offline caching & reading
    const safeTitle = key.replace(/[^a-zA-Z0-9 \-_/]/g, '');
    const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 220 >> stream
BT
/F1 18 Tf
50 770 Td
(Auto-ecole La Marseillaise - Support de Cours Officiel) Tj
/F1 12 Tf
0 -35 Td
(Document : ${safeTitle}) Tj
0 -25 Td
(Disponible en mode hors ligne - Revise votre code de la route CEMAC.) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000513 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
581
%%EOF`;

    return new Response(pdfContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${key.split('/').pop() || 'cours.pdf'}"`,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  });
});

// 4. Quizzes & Questions Pack (Strictly Gated by student_has_access + student's licence_category_id)
studentRoutes.get('/quizzes', async (c) => {
  const user = c.get('user')!;

  return withUserContext(user.id, async (client) => {
    const stuRes = await client.query(
      `SELECT id, licence_category_id, trial_ends_at,
              public.student_has_access(id) AS has_access
       FROM public.students
       WHERE user_id = $1`,
      [user.id]
    );

    if (stuRes.rowCount === 0) {
      return c.json({ error: 'STUDENT_NOT_FOUND', message: 'Profil élève introuvable.' }, 404);
    }

    const student = stuRes.rows[0];
    if (!student.has_access) {
      return c.json(
        {
          error: 'ACCESS_EXPIRED',
          message:
            "Votre essai gratuit de 14 jours est terminé. Réglez votre 1re tranche à l'auto-école pour accéder aux quiz et examens blancs.",
          trialEndsAt: student.trial_ends_at,
        },
        403
      );
    }

    const quizzesRes = await client.query(
      `SELECT id, licence_category_id, title, topic, duration_minutes, is_mock_exam, created_at
       FROM public.quizzes
       WHERE is_published = true AND licence_category_id = $1
       ORDER BY is_mock_exam ASC, created_at ASC`,
      [student.licence_category_id]
    );

    const quizIds = quizzesRes.rows.map((q) => q.id);
    let questionsByQuiz: Record<string, any[]> = {};

    if (quizIds.length > 0) {
      const qRes = await client.query(
        `SELECT id, quiz_id, position, body, options, correct_index, explanation
         FROM public.questions
         WHERE quiz_id = ANY($1::uuid[])
         ORDER BY quiz_id, position ASC`,
        [quizIds]
      );
      for (const q of qRes.rows) {
        if (!questionsByQuiz[q.quiz_id]) questionsByQuiz[q.quiz_id] = [];
        questionsByQuiz[q.quiz_id].push(q);
      }
    }

    const quizzes = quizzesRes.rows.map((quiz) => ({
      ...quiz,
      questions: questionsByQuiz[quiz.id] || [],
    }));

    return c.json({ quizzes });
  });
});

// 5. Submit / Sync Quiz Attempts (Supports Offline Batch Sync & client_id Idempotency)
// Note: Allowed even if the student's trial ended while offline, matching the schema rule!
const attemptItemSchema = z.object({
  quizId: z.string().uuid(),
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  takenAt: z.string().datetime().optional(),
  clientId: z.string().uuid(),
});

studentRoutes.post('/quiz-attempts', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));

  const itemsRaw = Array.isArray(body?.attempts) ? body.attempts : [body];
  const parsed = z.array(attemptItemSchema).min(1).max(100).safeParse(itemsRaw);
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, 400);
  }

  for (const item of parsed.data) {
    if (item.score > item.total) {
      return c.json({ error: 'INVALID_SCORE', message: 'Le score ne peut pas dépasser le total.' }, 400);
    }
  }

  return withUserContext(user.id, async (client) => {
    const stuRes = await client.query(`SELECT id FROM public.students WHERE user_id = $1`, [user.id]);
    if (stuRes.rowCount === 0) {
      return c.json({ error: 'STUDENT_NOT_FOUND', message: 'Profil élève introuvable.' }, 404);
    }
    const studentId = stuRes.rows[0].id;

    const synced: any[] = [];
    for (const item of parsed.data) {
      const ins = await client.query(
        `INSERT INTO public.quiz_attempts (student_id, quiz_id, score, total, taken_at, client_id)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6)
         ON CONFLICT (client_id) DO UPDATE SET score = public.quiz_attempts.score
         RETURNING id, quiz_id, score, total, taken_at, client_id`,
        [studentId, item.quizId, item.score, item.total, item.takenAt ?? null, item.clientId]
      );
      synced.push(ins.rows[0]);
    }

    return c.json({ ok: true, synced }, 201);
  });
});

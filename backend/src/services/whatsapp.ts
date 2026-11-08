import type pg from 'pg';
import crypto from 'node:crypto';
import { getPool } from '../db.js';

export interface WhatsAppNotificationResult {
  outboxId?: string;
  dedupKey?: string;
  deduplicated?: boolean;
  sentViaApi: boolean;
  sentViaN8n: boolean;
  smsFallbackStatus: 'unavailable_pending_provider';
  waMeLink: string;
  messageText: string;
}

/**
 * Formats a zero-cost 1-tap `https://wa.me/` deep link for Cameroon numbers
 * AND optionally triggers the Meta WhatsApp Cloud API & n8n webhook.
 */
export function buildWaMeLink(phoneE164: string, messageText: string): string {
  const digitsOnly = phoneE164.replace(/[^0-9]/g, '');
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(messageText)}`;
}

/**
 * E12 — Computes HMAC-SHA256 signature binding both the ISO timestamp and raw JSON body.
 */
export function signWebhookPayload(rawBody: string, timestamp: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

/**
 * E12 — Verifies webhook HMAC-SHA256 signature and enforces a bounded replay window (default 5 minutes).
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  maxSkewMs?: number;
  nowMs?: number;
}): {
  valid: boolean;
  reason: 'OK' | 'MISSING_PARAMETERS' | 'TIMESTAMP_OUT_OF_RANGE' | 'INVALID_SIGNATURE';
} {
  if (!params.rawBody || !params.timestamp || !params.signature || !params.secret) {
    return { valid: false, reason: 'MISSING_PARAMETERS' };
  }

  const tsMs = Date.parse(params.timestamp);
  if (!Number.isFinite(tsMs)) {
    return { valid: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const maxSkewMs = params.maxSkewMs ?? 5 * 60_000;
  if (Math.abs(nowMs - tsMs) > maxSkewMs) {
    return { valid: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  }

  const expectedHex = signWebhookPayload(params.rawBody, params.timestamp, params.secret);
  const providedBuf = Buffer.from(params.signature, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  return { valid: true, reason: 'OK' };
}

export function formatPaymentConfirmationMessage(params: {
  studentName: string;
  amount: number;
  receiptNumber: string;
  method: string;
  balance: number;
  nextDueDate?: string | null;
}): string {
  const methodLabels: Record<string, string> = {
    cash: 'Espèces',
    mtn_momo: 'MTN Mobile Money',
    orange_money: 'Orange Money',
    bank: 'Virement / Banque',
  };
  const methodLabel = methodLabels[params.method] || params.method;
  const formattedAmount = params.amount.toLocaleString('fr-FR');
  const formattedBalance = params.balance.toLocaleString('fr-FR');
  const nextDueLine =
    params.balance > 0 && params.nextDueDate
      ? `\n📅 Prochaine échéance : *${params.nextDueDate}*`
      : params.balance === 0
      ? `\n🎉 *Félicitations, votre formation est intégralement soldée !*`
      : '';

  return (
    `✅ *Auto-école La Marseillaise — Reçu de Paiement*\n\n` +
    `Bonjour *${params.studentName}*,\n` +
    `Nous confirmons la réception de votre paiement :\n` +
    `• Reçu N° : *${params.receiptNumber}*\n` +
    `• Montant payé : *${formattedAmount} FCFA* (${methodLabel})\n` +
    `• Solde restant : *${formattedBalance} FCFA*` +
    `${nextDueLine}\n\n` +
    `Votre accès aux cours et quiz est actif en illimité dans l'application.`
  );
}

export function formatInviteMessage(params: {
  studentName: string;
  inviteCode: string;
  appUrl: string;
}): string {
  const magicLink = `${params.appUrl}/activer-compte?code=${encodeURIComponent(params.inviteCode)}`;
  return (
    `🚗 *Bienvenue à l'Auto-école La Marseillaise !*\n\n` +
    `Bonjour *${params.studentName}*,\n` +
    `Votre dossier d'élève a été créé par la direction.\n\n` +
    `🔑 Votre code d'activation unique : *${params.inviteCode}*\n` +
    `👉 Cliquez ici pour activer votre compte et réviser vos cours & quiz : ${magicLink}`
  );
}

export function formatReminderMessage(params: {
  studentName: string;
  type: 'trial_day_7' | 'trial_day_12' | 'trial_day_14' | 'installment_upcoming' | 'installment_overdue';
  daysLeft?: number;
  trancheLabel?: string;
  amountDue?: number;
  dueDate?: string;
}): string {
  switch (params.type) {
    case 'trial_day_7':
    case 'trial_day_12':
      return (
        `⏳ *Auto-école La Marseillaise — Essai Gratuit*\n\n` +
        `Bonjour *${params.studentName}*, il vous reste *${params.daysLeft ?? 2} jour(s)* d'essai gratuit sur l'application.\n` +
        `Pensez à régler votre 1re tranche à l'auto-école pour conserver votre accès aux cours et examens blancs sans interruption.`
      );
    case 'trial_day_14':
      return (
        `🔒 *Auto-école La Marseillaise — Fin de l'essai gratuit*\n\n` +
        `Bonjour *${params.studentName}*, votre période d'essai de 14 jours est arrivée à échéance.\n` +
        `Rendez-vous à l'Auto-école La Marseillaise pour enregistrer votre 1er versement et débloquer définitivement vos cours et quiz.`
      );
    case 'installment_upcoming':
      return (
        `📅 *Auto-école La Marseillaise — Rappel d'échéance*\n\n` +
        `Bonjour *${params.studentName}*, votre échéance *${params.trancheLabel}* de *${(params.amountDue ?? 0).toLocaleString('fr-FR')} FCFA* arrive à échéance le *${params.dueDate}*.`
      );
    case 'installment_overdue':
      return (
        `⚠️ *Auto-école La Marseillaise — Échéance en retard*\n\n` +
        `Bonjour *${params.studentName}*, votre tranche *${params.trancheLabel}* (*${(params.amountDue ?? 0).toLocaleString('fr-FR')} FCFA*, prévue le ${params.dueDate}) est en retard.\n` +
        `Merci de régulariser votre situation auprès de la direction.`
      );
  }
}

export function formatWeeklyDirectionSummaryMessage(params: {
  schoolName: string;
  referenceDate: string;
  studentsTotal: number;
  inFreeTrial: number;
  trialEndedUnpaid: number;
  studentsOverdue: number;
  collectedThisMonth: number;
  stillOwed: number;
}): string {
  return (
    `📊 *${params.schoolName} — Bilan Hebdomadaire (${params.referenceDate})*\n\n` +
    `• Élèves inscrits : *${params.studentsTotal}*\n` +
    `• En essai gratuit : *${params.inFreeTrial}*\n` +
    `• Essai expiré (non payé) : *${params.trialEndedUnpaid}*\n` +
    `• Élèves en retard de tranche : *${params.studentsOverdue}*\n` +
    `• Encaissé ce mois : *${params.collectedThisMonth.toLocaleString('fr-FR')} FCFA*\n` +
    `• Reste à recouvrer : *${params.stillOwed.toLocaleString('fr-FR')} FCFA*`
  );
}

/**
 * E12 — Guard ensuring automated tests with generated phone numbers never trigger live external messages
 * unless explicitly authorized via `WHATSAPP_AUTHORIZED_TEST_PHONES`.
 */
function isExternalDeliveryAllowed(recipientPhone: string, dryRunExternal?: boolean): boolean {
  if (dryRunExternal) return false;
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    const allowedList = (process.env.WHATSAPP_AUTHORIZED_TEST_PHONES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return allowedList.includes(recipientPhone);
  }
  return true;
}

export interface NotificationInput {
  event: string; recipientPhone: string; messageText: string;
  metadata?: Record<string, unknown>; dedupKey?: string;
  persistOutbox?: boolean; dryRunExternal?: boolean; deliveryOnly?: boolean;
}

/** Use the business transaction's client so payment and notification commit together. */
export async function enqueueNotification(client: Pick<pg.PoolClient, 'query'>, params: NotificationInput): Promise<WhatsAppNotificationResult> {
  const key = params.dedupKey || `${params.event}:${params.recipientPhone}:${crypto.randomUUID()}`;
  const link = buildWaMeLink(params.recipientPhone, params.messageText);
  const inserted = await client.query(`INSERT INTO public.notification_outbox(dedup_key,event_type,recipient_phone,message_text,wa_me_link,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(dedup_key) DO NOTHING RETURNING id`, [key,params.event,params.recipientPhone,params.messageText,link,JSON.stringify(params.metadata || {})]);
  const existing = inserted.rowCount ? inserted : await client.query(`SELECT id FROM public.notification_outbox WHERE dedup_key=$1`,[key]);
  return { outboxId: existing.rows[0].id, dedupKey: key, deduplicated: !inserted.rowCount, sentViaApi: false, sentViaN8n: false, smsFallbackStatus: 'unavailable_pending_provider', waMeLink: link, messageText: params.messageText };
}

export async function dispatchNotification(params: NotificationInput): Promise<WhatsAppNotificationResult> {
  if (!params.deliveryOnly && (params.dedupKey || params.persistOutbox)) return enqueueNotification(getPool(), params);
  const waMeLink = buildWaMeLink(params.recipientPhone, params.messageText);
  let sentViaApi = false;
  let sentViaN8n = false;
  let outboxId: string | undefined;
  let deduplicated = false;

  const pool = getPool();
  const shouldPersist = false;
  const dedupKey =
    params.dedupKey || `${params.event}:${params.recipientPhone}:${crypto.randomUUID()}`;

  const allowExternal = isExternalDeliveryAllowed(params.recipientPhone, params.dryRunExternal);
  let lastError: string | null = null;

  if (allowExternal) {
    // 1. Optional Meta WhatsApp Cloud API
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const version = process.env.WHATSAPP_API_VERSION || 'v21.0';

    if (phoneId && token && !phoneId.startsWith('replace-')) {
      try {
        const resp = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.recipientPhone.replace('+', ''),
            type: 'text',
            text: { body: params.messageText },
          }),
          signal: AbortSignal.timeout(5000),
        });
        sentViaApi = resp.ok;
        if (!resp.ok) {
          lastError = `WHATSAPP_HTTP_${resp.status}`;
        }
      } catch (err: any) {
        sentViaApi = false;
        lastError = err?.message || 'WHATSAPP_NETWORK_ERROR';
      }
    }

    // 2. Optional n8n Webhook (only when N8N_ENABLED === 'true')
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    const n8nEnabled = process.env.N8N_ENABLED === 'true';
    const n8nSecret = process.env.N8N_WEBHOOK_SECRET || '';
    if (!sentViaApi && n8nEnabled && n8nUrl && n8nSecret && !n8nUrl.includes('replace-')) {
      try {
        const timestamp = new Date().toISOString();
        const bodyStr = JSON.stringify({
          event: params.event,
          dedupKey,
          recipientPhone: params.recipientPhone,
          messageText: params.messageText,
          waMeLink,
          metadata: params.metadata ?? {},
          smsFallbackStatus: 'unavailable_pending_provider',
          timestamp,
        });
        const signature = signWebhookPayload(bodyStr, timestamp, n8nSecret);

        const resp = await fetch(n8nUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Timestamp': timestamp,
            'X-Webhook-Signature': signature,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(3500),
        });
        sentViaN8n = resp.ok;
        if (!resp.ok) {
          lastError = `N8N_HTTP_${resp.status}`;
        }
      } catch (err: any) {
        sentViaN8n = false;
        lastError = err?.message || 'N8N_NETWORK_ERROR';
      }
    }
  }

  return {
    outboxId,
    dedupKey,
    deduplicated,
    sentViaApi,
    sentViaN8n,
    smsFallbackStatus: 'unavailable_pending_provider',
    waMeLink,
    messageText: params.messageText,
  };
}

/**
 * E12 — Evaluates and enqueues scheduled reminders in Africa/Douala timezone:
 * 1. Trial reminders at Day 7 (7 days left), Day 12 (2 days left), and Day 14 (0 days left / expired today).
 * 2. Upcoming installments (due within 3 days) and overdue installments (only for active/paid or non-cancelled enrollments).
 * 3. Weekly direction summary to `app_settings.school_phone`.
 * Enforces idempotency via deterministic `dedup_key`s in `public.notification_outbox`.
 */
export async function runScheduledReminders(params: {
  referenceDate?: string;
  includeWeeklySummary?: boolean;
  dryRunExternal?: boolean;
} = {}): Promise<{
  ok: boolean;
  timezone: 'Africa/Douala';
  referenceDate: string;
  enqueuedCount: number;
  skippedDuplicatesCount: number;
  items: Array<{ dedupKey: string; event: string; recipientPhone: string; deduplicated: boolean }>;
}> {
  const pool = getPool();
  // Determine reference date in Africa/Douala (UTC+1)
  const refDate =
    params.referenceDate ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Douala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  let enqueuedCount = 0;
  let skippedDuplicatesCount = 0;
  const items: Array<{ dedupKey: string; event: string; recipientPhone: string; deduplicated: boolean }> = [];

  // 1. Trial reminders (Day 7 -> 7 days remaining, Day 12 -> 2 days remaining, Day 14 -> 0 days remaining)
  const trialCandidates = await pool.query(
    `SELECT s.id, s.full_name, s.phone,
            (14 - ($1::date - (s.activated_at AT TIME ZONE 'Africa/Douala')::date))::int AS days_left
     FROM public.students s
     WHERE s.trial_ends_at IS NOT NULL
       AND NOT public.student_has_paid(s.id)
       AND ($1::date - (s.activated_at AT TIME ZONE 'Africa/Douala')::date) IN (7,12,14)`,
    [refDate]
  );

  for (const stu of trialCandidates.rows) {
    let type: 'trial_day_7' | 'trial_day_12' | 'trial_day_14' | null = null;
    if (stu.days_left === 7) type = 'trial_day_7';
    else if (stu.days_left === 2) type = 'trial_day_12';
    else if (stu.days_left === 0) type = 'trial_day_14';

    if (type) {
      const dedupKey = `reminder:${type}:${stu.id}:${refDate}`;
      const messageText = formatReminderMessage({
        studentName: stu.full_name,
        type,
        daysLeft: stu.days_left,
      });
      const res = await dispatchNotification({
        event: type,
        recipientPhone: stu.phone,
        messageText,
        dedupKey,
        persistOutbox: true,
        dryRunExternal: params.dryRunExternal,
        metadata: { studentId: stu.id, referenceDate: refDate, timezone: 'Africa/Douala' },
      });
      if (res.deduplicated) skippedDuplicatesCount++;
      else enqueuedCount++;
      items.push({ dedupKey, event: type, recipientPhone: stu.phone, deduplicated: Boolean(res.deduplicated) });
    }
  }

  // 2. Upcoming (due in 1..3 days) & Overdue installments for non-cancelled enrollments of paid students
  const instCandidates = await pool.query(
    `SELECT ist.enrollment_id, ist.student_id, ist.installment_id, ist.label, LEAST(ist.amount, GREATEST(0, ist.cumulative_due - ist.paid_total))::bigint AS amount,
            ist.due_date::text AS due_date, ist.status,
            s.full_name, s.phone,
            (ist.due_date - $1::date)::int AS days_until_due
     FROM public.installment_status ist
     JOIN public.enrollments e ON e.id = ist.enrollment_id
     JOIN public.students s ON s.id = ist.student_id
     WHERE e.status = 'active'
       AND public.student_has_paid(s.id)
       AND ist.status IN ('upcoming', 'partial', 'overdue')`,
    [refDate]
  );

  for (const row of instCandidates.rows) {
    let type: 'installment_upcoming' | 'installment_overdue' | null = null;
    if (row.days_until_due < 0) {
      type = 'installment_overdue';
    } else if (row.days_until_due >= 0 && row.days_until_due <= 3) {
      type = 'installment_upcoming';
    }

    if (type) {
      const dedupKey = `reminder:${type}:${row.enrollment_id}:${row.installment_id}:${refDate}`;
      const messageText = formatReminderMessage({
        studentName: row.full_name,
        type,
        trancheLabel: row.label,
        amountDue: Number(row.amount),
        dueDate: row.due_date,
      });
      const res = await dispatchNotification({
        event: type,
        recipientPhone: row.phone,
        messageText,
        dedupKey,
        persistOutbox: true,
        dryRunExternal: params.dryRunExternal,
        metadata: {
          studentId: row.student_id,
          enrollmentId: row.enrollment_id,
          installmentId: row.installment_id,
          referenceDate: refDate,
          timezone: 'Africa/Douala',
        },
      });
      if (res.deduplicated) skippedDuplicatesCount++;
      else enqueuedCount++;
      items.push({ dedupKey, event: type, recipientPhone: row.phone, deduplicated: Boolean(res.deduplicated) });
    }
  }

  // 3. Weekly direction summary (Africa/Douala)
  if (params.includeWeeklySummary !== false) {
    const settingsRes = await pool.query(`SELECT school_name, school_phone FROM public.app_settings WHERE id = 1`);
    const schoolName = settingsRes.rows[0]?.school_name || 'Auto-école La Marseillaise';
    const schoolPhone = settingsRes.rows[0]?.school_phone || '+237699000001';

    const kpiRes = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM public.students) AS students_total,
        (SELECT count(*)::int FROM public.students s WHERE s.trial_ends_at > now() AND NOT public.student_has_paid(s.id)) AS in_free_trial,
        (SELECT count(*)::int FROM public.students s WHERE s.trial_ends_at <= now() AND NOT public.student_has_paid(s.id)) AS trial_ended_unpaid,
        (SELECT count(DISTINCT student_id)::int FROM public.installment_status WHERE status = 'overdue') AS students_overdue,
        (SELECT coalesce(sum(amount), 0)::bigint FROM public.payments WHERE cancelled_at IS NULL AND paid_at >= date_trunc('month', now())) AS collected_this_month,
        (SELECT coalesce(sum(balance), 0)::bigint FROM public.enrollment_balances b JOIN public.enrollments e ON e.id = b.enrollment_id WHERE e.status <> 'cancelled') AS still_owed
    `);
    const kpis = kpiRes.rows[0];
    const weekRes = await pool.query(`SELECT to_char($1::date,'IYYY-IW') AS week`,[refDate]);
    const dedupKey = `reminder:weekly_direction_summary:${weekRes.rows[0].week}`;
    const messageText = formatWeeklyDirectionSummaryMessage({
      schoolName,
      referenceDate: refDate,
      studentsTotal: Number(kpis.students_total ?? 0),
      inFreeTrial: Number(kpis.in_free_trial ?? 0),
      trialEndedUnpaid: Number(kpis.trial_ended_unpaid ?? 0),
      studentsOverdue: Number(kpis.students_overdue ?? 0),
      collectedThisMonth: Number(kpis.collected_this_month ?? 0),
      stillOwed: Number(kpis.still_owed ?? 0),
    });

    const res = await dispatchNotification({
      event: 'weekly_direction_summary',
      recipientPhone: schoolPhone,
      messageText,
      dedupKey,
      persistOutbox: true,
      dryRunExternal: params.dryRunExternal,
      metadata: { referenceDate: refDate, timezone: 'Africa/Douala', kpis },
    });
    if (res.deduplicated) skippedDuplicatesCount++;
    else enqueuedCount++;
    items.push({
      dedupKey,
      event: 'weekly_direction_summary',
      recipientPhone: schoolPhone,
      deduplicated: Boolean(res.deduplicated),
    });
  }

  return {
    ok: true,
    timezone: 'Africa/Douala',
    referenceDate: refDate,
    enqueuedCount,
    skippedDuplicatesCount,
    items,
  };
}

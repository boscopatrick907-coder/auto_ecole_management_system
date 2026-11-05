import crypto from 'node:crypto';

export interface WhatsAppNotificationResult {
  sentViaApi: boolean;
  sentViaN8n: boolean;
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

export async function dispatchNotification(params: {
  event: string;
  recipientPhone: string;
  messageText: string;
  metadata?: Record<string, unknown>;
}): Promise<WhatsAppNotificationResult> {
  const waMeLink = buildWaMeLink(params.recipientPhone, params.messageText);
  let sentViaApi = false;
  let sentViaN8n = false;

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
      });
      sentViaApi = resp.ok;
    } catch {
      sentViaApi = false;
    }
  }

  // 2. Optional n8n Webhook (only when N8N_ENABLED === 'true')
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  const n8nEnabled = process.env.N8N_ENABLED === 'true';
  const n8nSecret = process.env.N8N_WEBHOOK_SECRET || '';
  if (n8nEnabled && n8nUrl && !n8nUrl.includes('replace-')) {
    try {
      const bodyStr = JSON.stringify({
        event: params.event,
        recipientPhone: params.recipientPhone,
        messageText: params.messageText,
        waMeLink,
        metadata: params.metadata ?? {},
        timestamp: new Date().toISOString(),
      });
      const signature = crypto
        .createHmac('sha256', n8nSecret)
        .update(bodyStr)
        .digest('hex');

      const resp = await fetch(n8nUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(2500),
      });
      sentViaN8n = resp.ok;
    } catch {
      sentViaN8n = false;
    }
  }

  return {
    sentViaApi,
    sentViaN8n,
    waMeLink,
    messageText: params.messageText,
  };
}

import { getPool } from '../db.js';
import { dispatchNotification, runScheduledReminders, type NotificationInput, type WhatsAppNotificationResult } from './whatsapp.js';

export async function processNotificationBatch(options: { limit?: number; deliver?: (input: NotificationInput) => Promise<WhatsAppNotificationResult> } = {}) {
  if (!options.deliver && process.env.NOTIFICATION_DELIVERY_ENABLED !== 'true') return { processed: 0, disabled: true };
  const pool = getPool();
  await pool.query(`UPDATE public.notification_outbox SET status='failed_permanent',locked_until=NULL,last_error='RETRY_LIMIT_EXCEEDED' WHERE status='processing' AND locked_until<now() AND attempts>=8`);
  const deliver = options.deliver || dispatchNotification;
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  let processed=0;
  // Claim immediately before delivery, rather than leasing a batch that waits behind network I/O.
  for(let index=0;index<limit;index++) {
    const rows=await pool.query(`WITH due AS (
      SELECT id FROM public.notification_outbox WHERE ((status IN ('pending','failed_retryable') AND next_retry_at<=now()) OR (status='processing' AND locked_until<now())) AND attempts<8
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE public.notification_outbox o SET status='processing',attempts=o.attempts+1,locked_until=now()+interval '60 seconds',lock_token=gen_random_uuid(),updated_at=now() FROM due WHERE o.id=due.id RETURNING o.*`);
    const row=rows.rows[0];if(!row)break;
    let sent=false;
    try {const result=await deliver({event:row.event_type,recipientPhone:row.recipient_phone,messageText:row.message_text,metadata:row.metadata,dedupKey:row.dedup_key,deliveryOnly:true});sent=result.sentViaApi||result.sentViaN8n;}catch{/* persist unconfirmed delivery below */}
    await pool.query(`UPDATE public.notification_outbox SET status=$2,locked_until=NULL,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,last_error=CASE WHEN $2='sent' THEN NULL ELSE 'DELIVERY_UNCONFIRMED' END,next_retry_at=now()+($3::int*interval '1 minute'),updated_at=now() WHERE id=$1 AND status='processing' AND lock_token=$4`,[row.id,sent?'sent':row.attempts>=8?'failed_permanent':'failed_retryable',Math.min(60,2**row.attempts),row.lock_token]);
    processed++;
  }
  return {processed,disabled:false};
}

export async function runWorkerTick() {
  const pool=getPool();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Douala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const exists=await pool.query(`SELECT 1 FROM public.notification_schedule_runs WHERE reference_date=$1`,[today]);
  if(!exists.rowCount){
    await runScheduledReminders({referenceDate:today,includeWeeklySummary:true,dryRunExternal:true});
    // Mark only after enqueueing; crashes before this point safely retry via event dedup keys.
    await pool.query(`INSERT INTO public.notification_schedule_runs(reference_date) VALUES($1) ON CONFLICT DO NOTHING`,[today]);
  }
  return processNotificationBatch();
}

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { withUserContext } from '../db.js';
import { safePositiveMoneySchema, ApiError } from '../utils/validation.js';

/** Merchant onboarding has not been completed. Fail closed; never fabricate settlement. */
export const onlinePaymentRoutes=new Hono();
onlinePaymentRoutes.use('*',requireAuth);
onlinePaymentRoutes.get('/providers',c=>c.json({currency:'XAF',providers:[
 {id:'mtn_momo',collectionEnabled:false,refundEnabled:false,reason:'MERCHANT_ONBOARDING_REQUIRED'},
 {id:'orange_money',collectionEnabled:false,refundEnabled:false,reason:'MERCHANT_ONBOARDING_REQUIRED'}
]}));
const intentSchema=z.object({enrollmentId:z.string().uuid(),provider:z.enum(['mtn_momo','orange_money']),amount:safePositiveMoneySchema,clientId:z.string().uuid()});
onlinePaymentRoutes.post('/intents',async c=>{
 const parsed=intentSchema.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)throw new ApiError(400,'VALIDATION_ERROR',parsed.error.issues[0].message);
 const user=c.get('user')!;
 if(!['student','admin','cashier'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Accès non autorisé.');
 return withUserContext(user.id,async client=>{
  const enrollment=await client.query(`SELECT e.id FROM public.enrollments e JOIN public.students s ON s.id=e.student_id WHERE e.id=$1 AND ($2::boolean OR s.user_id=$3) AND e.status='active'`,[parsed.data.enrollmentId,user.role==='admin'||user.role==='cashier',user.id]);
  if(!enrollment.rowCount)throw new ApiError(404,'ENROLLMENT_NOT_FOUND','Inscription introuvable.');
  throw new ApiError(503,'MERCHANT_ONBOARDING_REQUIRED','Les comptes marchands MTN/Orange ne sont pas encore activés. Aucun paiement n’a été initié ni enregistré.');
 });
});

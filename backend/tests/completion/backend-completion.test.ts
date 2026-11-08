import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { app } from '../../src/app.js';
import { getPool, withUserContext } from '../../src/db.js';
import { runMigrationsAndSeed } from '../../src/scripts/migrate.js';
import { enqueueNotification, dispatchNotification } from '../../src/services/whatsapp.js';
import { processNotificationBatch } from '../../src/services/notification-worker.js';
const pool=getPool();
const phone=()=>`+23769${crypto.randomInt(1000000,9999999)}`;
async function req(path:string,body?:any,token?:string,method?:string){const r=await app.request('/api'+path,{method:method||(body!==undefined?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body!==undefined?JSON.stringify(body):undefined});return {status:r.status,data:await r.json() as any};}
let admin:string,adminId:string,category:string,group:string;
let teacher:any,otherTeacher:any,cashier:any,student:any;
async function staff(role:string){const password='InitialLocal123!';const created=await req('/operations/staff',{name:'Staff completion',phone:phone(),password,role},admin);expect(created.status).toBe(201);const row=await pool.query('SELECT phone FROM users WHERE id=$1',[created.data.staff.id]);const logged=await req('/auth/login',{identifier:row.rows[0].phone,password});expect(logged.status).toBe(200);expect((await req('/operations/sessions',undefined,logged.data.token)).data.error).toBe('PASSWORD_CHANGE_REQUIRED');expect((await req('/auth/change-password',{currentPassword:password,newPassword:'ChangedLocal123!'},logged.data.token)).status).toBe(200);return {...created.data.staff,token:logged.data.token};}
describe('Backend completion regressions',()=>{
 beforeAll(async()=>{
  await runMigrationsAndSeed();const logged=await req('/auth/login',{identifier:'+237699000001',password:'Admin@Marseillaise2026!'});expect(logged.status).toBe(200);admin=logged.data.token;adminId=logged.data.user.id;
  category=(await pool.query(`SELECT id FROM licence_categories WHERE code='B'`)).rows[0].id;
  const created=await req('/admin/groups',{licenceCategoryId:category,name:'Completion group',capacity:30,totalFee:10000,installments:[{position:1,label:'Only',amount:10000,dueDate:'2026-12-01'}]},admin);expect(created.status).toBe(201);group=created.data.group.id;
  const p=phone();const otp=await req('/auth/request-otp',{phone:p});const reg=await req('/auth/register',{phone:p,fullName:'Completion student',password:'StudentLocal123!',otpCode:otp.data.devOtpPreview,licenceCategoryId:category,groupId:group});expect(reg.status).toBe(201);student=reg.data;
  teacher=await staff('instructor');otherTeacher=await staff('instructor');cashier=await staff('cashier');
 },120000);
 afterAll(async()=>{await pool.end();});
 it('never exposes an OTP in production when delivery is unavailable',async()=>{
  const mode=process.env.NODE_ENV;process.env.NODE_ENV='production';try{const result=await req('/auth/request-otp',{phone:phone()});expect(result.status).toBe(503);expect(result.data.devOtpPreview).toBeUndefined();}finally{process.env.NODE_ENV=mode;}
 });
 it('does not reflect untrusted CORS origins and limits request bodies',async()=>{
  const r=await app.request('/api/health',{headers:{Origin:'https://untrusted.example'}});expect(r.headers.get('access-control-allow-origin')).toBeNull();
  const large=await app.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:'x'.repeat(1024*1024)})});expect(large.status).toBe(413);
 });
 it('gives instructors only assigned rosters and blocks financial access',async()=>{
  const session=await req('/operations/sessions',{groupId:group,instructorId:teacher.id,startsAt:'2026-12-10T08:00:00+01:00',endsAt:'2026-12-10T09:00:00+01:00',location:'Bastos'},admin);expect(session.status).toBe(201);
  expect((await req(`/operations/sessions/${session.data.session.id}/roster`,undefined,teacher.token)).data.students.some((s:any)=>s.id===student.studentId)).toBe(true);
  expect((await req(`/operations/sessions/${session.data.session.id}/roster`,undefined,otherTeacher.token)).status).toBe(404);
  expect((await req('/admin/students',undefined,teacher.token)).status).toBe(403);
  await withUserContext(teacher.id,async client=>{expect((await client.query('SELECT * FROM public.enrollment_balances')).rowCount).toBe(0);expect((await client.query('SELECT * FROM public.payments')).rowCount).toBe(0);});
 });
 it('serializes overlapping instructor/vehicle sessions and audits attendance corrections',async()=>{
  const vehicle=await req('/operations/vehicles',{label:'Teaching car',registration:crypto.randomUUID()},admin);expect(vehicle.status).toBe(201);
  const body={groupId:group,instructorId:teacher.id,vehicleId:vehicle.data.vehicle.id,startsAt:'2026-12-11T08:00:00+01:00',endsAt:'2026-12-11T09:00:00+01:00',location:'Bastos'};
  const results=await Promise.all([req('/operations/sessions',body,admin),req('/operations/sessions',body,admin)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  const id=results.find(r=>r.status===201)!.data.session.id;
  expect((await req('/operations/vehicles',undefined,teacher.token)).data.vehicles.some((v:any)=>v.id===vehicle.data.vehicle.id)).toBe(true);
  const path=`/operations/sessions/${id}/attendance/${student.studentId}`;
  expect((await req(path,{status:'present',expectedVersion:0},otherTeacher.token,'PUT')).status).toBe(403);
  expect((await req(path,{status:'present',expectedVersion:0},teacher.token,'PUT')).status).toBe(200);
  expect((await req(path,{status:'absent',expectedVersion:1},teacher.token,'PUT')).status).toBe(400);
  expect((await req(path,{status:'absent',expectedVersion:1,reason:'Correction test'},teacher.token,'PUT')).data.attendance.version).toBe(2);
  expect((await req(path,{status:'present',expectedVersion:1,reason:'Stale update'},teacher.token,'PUT')).status).toBe(409);
  expect((await req('/operations/attendance',undefined,student.token)).data.attendance).toHaveLength(1);
  expect((await pool.query(`SELECT id FROM audit_log WHERE table_name='session_attendance' AND action='UPDATE'`)).rowCount).toBeGreaterThan(0);
 });
 it('permits cashier collection but prevents settings/cancellation and payment replay mismatches',async()=>{
  const me=await req('/student/me',undefined,student.token);const body={enrollmentId:me.data.enrollment.enrollment_id,amount:1000,method:'cash',clientId:crypto.randomUUID()};
  const payment=await req('/admin/payments',body,cashier.token);expect(payment.status).toBe(201);
  expect((await req('/admin/payments',body,cashier.token)).data.payment.id).toBe(payment.data.payment.id);
  expect((await req('/admin/payments',{...body,amount:2000},cashier.token)).status).toBe(409);
  expect((await req(`/admin/payments/${payment.data.payment.id}/cancel`,{reason:'Not authorized'},cashier.token)).status).toBe(403);
  expect((await req('/admin/groups',undefined,cashier.token)).status).toBe(403);
  expect((await pool.query(`SELECT id FROM notification_outbox WHERE dedup_key=$1`,[`payment_confirmed:${payment.data.payment.id}`])).rowCount).toBe(1);
 });
 it('rolls back a payment when its notification cannot commit',async()=>{
  const me=await req('/student/me',undefined,student.token);const before=Number(me.data.enrollment.paid);const clientId=crypto.randomUUID();
  await expect(withUserContext(adminId,async client=>{await client.query(`SELECT public.record_payment($1,1000,'cash',NULL,$2)`,[me.data.enrollment.enrollment_id,clientId]);await enqueueNotification(client,{event:'test',recipientPhone:undefined as any,messageText:'fail',dedupKey:crypto.randomUUID()});})).rejects.toThrow();
  expect((await pool.query('SELECT id FROM payments WHERE client_id=$1',[clientId])).rowCount).toBe(0);
  expect((await req('/student/me',undefined,student.token)).data.enrollment.paid).toBe(before);
 });
 it('claims outbox rows once and preserves failed delivery for retry',async()=>{
  const notification=await enqueueNotification(pool,{event:'worker_test',recipientPhone:phone(),messageText:'Worker local test',dedupKey:crypto.randomUUID()});
  // Isolate this test message from older pending test data without sending any external request.
  await pool.query(`UPDATE notification_outbox SET next_retry_at=now()+interval '1 day' WHERE id<>$1 AND status IN('pending','failed_retryable')`,[notification.outboxId]);
  const delivered=vi.fn(async()=>({...notification,sentViaApi:true}));
  await Promise.all([processNotificationBatch({deliver:delivered}),processNotificationBatch({deliver:delivered})]);expect(delivered).toHaveBeenCalledTimes(1);
  expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[notification.outboxId])).rows[0].status).toBe('sent');
  const failed=await enqueueNotification(pool,{event:'worker_fail',recipientPhone:phone(),messageText:'No delivery',dedupKey:crypto.randomUUID()});
  await processNotificationBatch({deliver:async()=>failed});
  const row=(await pool.query('SELECT status,next_retry_at,attempts FROM notification_outbox WHERE id=$1',[failed.outboxId])).rows[0];expect(row.status).toBe('failed_retryable');expect(row.attempts).toBe(1);
 });
 it('deactivates staff without deleting history and immediately revokes sessions',async()=>{
  expect((await req(`/operations/staff/${otherTeacher.id}`,{active:false},admin,'PATCH')).status).toBe(200);
  expect((await req('/operations/sessions',undefined,otherTeacher.token)).status).toBe(401);
  expect((await pool.query('SELECT id FROM users WHERE id=$1',[otherTeacher.id])).rowCount).toBe(1);
 });
 it('keeps the trial fixed at fourteen days and reports merchant onboarding explicitly',async()=>{
  expect((await req('/admin/settings',{trialDays:30},admin,'PATCH')).status).toBe(400);
  expect((await req('/payments/providers',undefined,student.token)).data.providers.every((p:any)=>p.collectionEnabled===false)).toBe(true);
  const me=await req('/student/me',undefined,student.token);
  const result=await req('/payments/intents',{enrollmentId:me.data.enrollment.enrollment_id,provider:'mtn_momo',amount:1000,clientId:crypto.randomUUID()},student.token);
  expect(result.status).toBe(503);expect(result.data.error).toBe('MERCHANT_ONBOARDING_REQUIRED');
 });
 it('grades actual answers, rejects foreign quizzes and allows legitimate late sync',async()=>{
  const quizzes=await req('/student/quizzes',undefined,student.token);const quiz=quizzes.data.quizzes[0];
  const answers=Object.fromEntries(quiz.questions.map((q:any)=>[q.id,String(q.correct_index)]));
  const result=await req('/student/quiz-attempts',{quizId:quiz.id,answers,score:0,total:1,clientId:crypto.randomUUID()},student.token);
  expect(result.status).toBe(201);expect(result.data.synced[0].score).toBe(quiz.questions.length);expect(result.data.synced[0].total).toBe(quiz.questions.length);
  await pool.query(`UPDATE students SET trial_ends_at=now()-interval '1 day' WHERE id=$1`,[student.studentId]);
  const late=await req('/student/quiz-attempts',{quizId:quiz.id,answers,clientId:crypto.randomUUID()},student.token);expect(late.status).toBe(201);
  const foreign=await pool.query('SELECT id FROM quizzes WHERE licence_category_id<>$1 LIMIT 1',[category]);
  expect((await req('/student/quiz-attempts',{quizId:foreign.rows[0].id,answers:{},clientId:crypto.randomUUID()},student.token)).status).toBe(403);
 });
 it('does not send the end-of-trial reminder every subsequent day',async()=>{
  const {runScheduledReminders}=await import('../../src/services/whatsapp.js');
  const fixture=await pool.query(`INSERT INTO students(full_name,phone,licence_category_id,activated_at,trial_ends_at) VALUES('Reminder coverage',$1,$2,'2026-11-24T08:00:00+01:00','2026-12-08T08:00:00+01:00') RETURNING id`,[phone(),category]);
  for(const referenceDate of ['2026-12-01','2026-12-06','2026-12-08','2026-12-09'])await runScheduledReminders({referenceDate,includeWeeklySummary:false,dryRunExternal:true});
  const rows=await pool.query(`SELECT event_type FROM notification_outbox WHERE metadata->>'studentId'=$1 AND event_type LIKE 'trial_day_%'`,[fixture.rows[0].id]);
  expect(rows.rows.map(r=>r.event_type).sort()).toEqual(['trial_day_12','trial_day_14','trial_day_7']);
 });

 it('does not let payment in one group bypass another group capacity',async()=>{
  const newGroup=await req('/admin/groups',{licenceCategoryId:category,name:'Second full group',capacity:1,totalFee:1000,installments:[{position:1,label:'Only',amount:1000,dueDate:'2026-12-01'}]},admin);expect(newGroup.status).toBe(201);
  const walk=await req('/admin/students',{fullName:'Other seat holder',phone:phone(),groupId:newGroup.data.group.id},admin);expect(walk.status).toBe(201);
  expect((await req('/admin/payments',{enrollmentId:walk.data.enrollment.enrollment_id,amount:1000,clientId:crypto.randomUUID()},admin)).status).toBe(201);
  const extra=await pool.query('INSERT INTO enrollments(student_id,group_id) VALUES($1,$2) RETURNING id',[student.studentId,newGroup.data.group.id]);
  expect((await req('/admin/payments',{enrollmentId:extra.rows[0].id,amount:1,clientId:crypto.randomUUID()},admin)).data.error).toBe('GROUP_FULL');
  const occupancy=await pool.query('SELECT confirmed_seats FROM group_occupancy WHERE group_id=$1',[newGroup.data.group.id]);expect(occupancy.rows[0].confirmed_seats).toBe(1);
 });
 it('recovers crashed worker leases and dead-letters exhausted claims',async()=>{
  const message=await enqueueNotification(pool,{event:'crash_recovery',recipientPhone:phone(),messageText:'Local recovery',dedupKey:crypto.randomUUID()});
  await pool.query(`UPDATE notification_outbox SET next_retry_at=now()+interval '1 day' WHERE id<>$1 AND status IN('pending','failed_retryable')`,[message.outboxId]);
  const old=crypto.randomUUID();await pool.query(`UPDATE notification_outbox SET status='processing',attempts=1,locked_until=now()-interval '1 minute',lock_token=$2 WHERE id=$1`,[message.outboxId,old]);
  await processNotificationBatch({deliver:async()=>({...message,sentViaN8n:true})});
  const row=(await pool.query('SELECT status,attempts,lock_token FROM notification_outbox WHERE id=$1',[message.outboxId])).rows[0];expect(row.status).toBe('sent');expect(row.attempts).toBe(2);expect(row.lock_token).not.toBe(old);
  const exhausted=await enqueueNotification(pool,{event:'exhausted',recipientPhone:phone(),messageText:'Retry bound',dedupKey:crypto.randomUUID()});
  await pool.query(`UPDATE notification_outbox SET status='processing',attempts=8,locked_until=now()-interval '1 minute' WHERE id=$1`,[exhausted.outboxId]);
  const transport=vi.fn(async()=>exhausted);await processNotificationBatch({deliver:transport});expect(transport).not.toHaveBeenCalled();
  expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[exhausted.outboxId])).rows[0].status).toBe('failed_permanent');
 });

 it('publishes actual quiz content and rejects fabricated resource paths',async()=>{
  expect((await req('/admin/content/resources',{licenceCategoryId:category,title:'Missing actual document',type:'pdf'},admin)).data.error).toBe('RESOURCE_URL_REQUIRED');
  expect((await req('/admin/content/resources',{licenceCategoryId:category,title:'Unsafe URL',type:'pdf',externalUrl:'javascript:alert(1)'},admin)).status).toBe(400);
  const body={licenceCategoryId:category,title:'Authored acceptance quiz',questions:[{body:'Which option?',options:['First','Second'],correctIndex:1,explanation:'Second is correct.'}]};
  expect((await req('/admin/content/quizzes',{...body,questions:[{...body.questions[0],correctIndex:9}]},admin)).status).toBe(400);
  const created=await req('/admin/content/quizzes',body,admin);expect(created.status).toBe(201);
  const question=(await pool.query('SELECT id FROM questions WHERE quiz_id=$1',[created.data.quiz.id])).rows[0];
  const scored=await req('/student/quiz-attempts',{quizId:created.data.quiz.id,answers:{[question.id]:'B'},clientId:crypto.randomUUID()},student.token);expect(scored.data.synced[0].score).toBe(1);
  expect((await req('/operations/content',undefined,teacher.token)).data.quizzes.some((q:any)=>q.id===created.data.quiz.id)).toBe(true);
  expect((await req(`/admin/content/quizzes/${created.data.quiz.id}`,{isPublished:false},admin,'PATCH')).status).toBe(200);
  expect((await req('/operations/content',undefined,teacher.token)).data.quizzes.some((q:any)=>q.id===created.data.quiz.id)).toBe(false);
 });

});

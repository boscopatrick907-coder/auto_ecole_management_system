import { createResourceDownloadUrl } from '../services/storage.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { withUserContext } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { hashPassword, normalizeCameroonPhone } from '../utils/crypto.js';
import { ApiError, isValidUuid } from '../utils/validation.js';
export const operationsRoutes = new Hono();
operationsRoutes.use('*',requireAuth);
const parse = <T>(schema:z.ZodType<T>, body:unknown):T => { const data=schema.safeParse(body);if(!data.success)throw new ApiError(400,'VALIDATION_ERROR',data.error.issues[0].message);return data.data; };
const uuid=(value:string | undefined)=>{if(!isValidUuid(value))throw new ApiError(400,'INVALID_UUID','Identifiant invalide.');return value;};
operationsRoutes.post('/staff',requireAdmin,async c=>{
 const d=parse(z.object({name:z.string().trim().min(2).max(150),phone:z.string().transform(normalizeCameroonPhone).refine(v=>/^\+237[26][0-9]{8}$/.test(v)),email:z.string().email().optional(),password:z.string().min(12).max(200),role:z.enum(['cashier','instructor'])}),await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>{
  const created=await client.query(`SELECT public.create_staff_account($1,$2,$3,$4,$5) AS id`,[d.name,d.phone,d.email||null,await hashPassword(d.password),d.role]);
  return c.json({staff:{id:created.rows[0].id,name:d.name,role:d.role,mustChangePassword:true}},201);
 });
});
operationsRoutes.get('/staff',requireAdmin,async c=>withUserContext(c.get('user')!.id,async client=>c.json({staff:(await client.query(`SELECT u.id,u.name,u.phone,p.role FROM public.users u JOIN public.profiles p ON p.id=u.id WHERE p.role IN('instructor','cashier') ORDER BY u.name`)).rows})));
operationsRoutes.post('/vehicles',requireAdmin,async c=>{
 const d=parse(z.object({label:z.string().trim().min(2).max(150),registration:z.string().trim().min(2).max(40)}),await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>c.json({vehicle:(await client.query(`INSERT INTO public.school_vehicles(label,registration) VALUES($1,$2) RETURNING *`,[d.label,d.registration])).rows[0]},201));
});
operationsRoutes.patch('/vehicles/:id',requireAdmin,async c=>{
 const id=uuid(c.req.param('id'));const d=parse(z.object({active:z.boolean()}),await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>{const result=await client.query(`UPDATE public.school_vehicles SET active=$2 WHERE id=$1 RETURNING *`,[id,d.active]);if(!result.rowCount)throw new ApiError(404,'NOT_FOUND','Véhicule introuvable.');return c.json({vehicle:result.rows[0]});});
});
operationsRoutes.get('/vehicles',async c=>withUserContext(c.get('user')!.id,async client=>c.json({vehicles:(await client.query('SELECT id,label,registration,active FROM public.school_vehicles ORDER BY label')).rows})));
const sessionSchema=z.object({groupId:z.string().uuid(),instructorId:z.string().uuid(),vehicleId:z.string().uuid().nullable().optional(),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),location:z.string().trim().min(2).max(200)}).refine(d=>new Date(d.endsAt)>new Date(d.startsAt),'La fin doit suivre le début.');
operationsRoutes.post('/sessions',requireAdmin,async c=>{
 const d=parse(sessionSchema,await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>c.json({session:(await client.query(`INSERT INTO public.school_sessions(group_id,instructor_id,vehicle_id,starts_at,ends_at,location,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[d.groupId,d.instructorId,d.vehicleId||null,d.startsAt,d.endsAt,d.location,c.get('user')!.id])).rows[0]},201));
});
operationsRoutes.patch('/sessions/:id',requireAdmin,async c=>{
 const id=uuid(c.req.param('id'));const d=parse(z.object({status:z.enum(['scheduled','finished','cancelled'])}),await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>{const result=await client.query(`UPDATE public.school_sessions SET status=$2 WHERE id=$1 RETURNING *`,[id,d.status]);if(!result.rowCount)throw new ApiError(404,'NOT_FOUND','Séance introuvable.');return c.json({session:result.rows[0]});});
});
operationsRoutes.get('/sessions',async c=>withUserContext(c.get('user')!.id,async client=>c.json({sessions:(await client.query(`SELECT id,group_id,instructor_id,vehicle_id,starts_at,ends_at,location,status FROM public.school_sessions ORDER BY starts_at DESC LIMIT 200`)).rows})));
operationsRoutes.get('/sessions/:id/roster',async c=>{
 const id=uuid(c.req.param('id'));const user=c.get('user')!;
 if(!['admin','instructor'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Accès réservé au moniteur affecté.');
 return withUserContext(user.id,async client=>{
  const session=await client.query(`SELECT group_id FROM public.school_sessions WHERE id=$1`,[id]);if(!session.rowCount)throw new ApiError(404,'NOT_FOUND','Séance introuvable.');
  return c.json({students:(await client.query(`SELECT s.id,s.full_name,s.licence_category_id FROM public.students s JOIN public.enrollments e ON e.student_id=s.id WHERE e.group_id=$1 AND e.status<>'cancelled' ORDER BY s.full_name`,[session.rows[0].group_id])).rows});
 });
});
operationsRoutes.put('/sessions/:id/attendance/:studentId',async c=>{
 const id=uuid(c.req.param('id')),student=uuid(c.req.param('studentId'));const user=c.get('user')!;
 if(!['admin','instructor'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Accès non autorisé.');
 const d=parse(z.object({status:z.enum(['present','absent','excused']),expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(4).max(500).optional()}),await c.req.json().catch(()=>null));
 return withUserContext(user.id,async client=>{
  const assigned=await client.query(`SELECT id FROM public.school_sessions WHERE id=$1 AND ($2::boolean OR instructor_id=$3) AND status<>'cancelled'`,[id,user.role==='admin',user.id]);if(!assigned.rowCount)throw new ApiError(403,'FORBIDDEN','Séance non affectée.');
  if(d.expectedVersion>0&&!d.reason)throw new ApiError(400,'CORRECTION_REASON_REQUIRED','Motif de correction requis.');
  const result=d.expectedVersion===0
   ?await client.query(`INSERT INTO public.session_attendance(session_id,student_id,status,recorded_by) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,student_id) DO NOTHING RETURNING *`,[id,student,d.status,user.id])
   :await client.query(`UPDATE public.session_attendance SET status=$3,reason=$4 WHERE session_id=$1 AND student_id=$2 AND version=$5 RETURNING *`,[id,student,d.status,d.reason,d.expectedVersion]);
  if(!result.rowCount)throw new ApiError(409,'ATTENDANCE_CONFLICT','Pointage modifié : actualisez la fiche.');return c.json({attendance:result.rows[0]});
 });
});
operationsRoutes.get('/attendance',async c=>withUserContext(c.get('user')!.id,async client=>c.json({attendance:(await client.query(`SELECT id,session_id,student_id,status,reason,version,updated_at FROM public.session_attendance ORDER BY updated_at DESC LIMIT 200`)).rows})));

operationsRoutes.patch('/staff/:id',requireAdmin,async c=>{
 const id=uuid(c.req.param('id'));const d=parse(z.object({active:z.boolean()}),await c.req.json().catch(()=>null));
 return withUserContext(c.get('user')!.id,async client=>{await client.query(`SELECT public.set_staff_active($1,$2)`,[id,d.active]);return c.json({ok:true});});
});
operationsRoutes.get('/content',async c=>{
 const user=c.get('user')!;if(!['admin','instructor'].includes(user.role))throw new ApiError(403,'FORBIDDEN','Accès non autorisé.');
 return withUserContext(user.id,async client=>{const rows=await client.query(`SELECT id,title,type,description,licence_category_id,file_size_kb,storage_path,external_url FROM public.resources WHERE is_published ORDER BY sort_order LIMIT 200`);const resources=await Promise.all(rows.rows.map(async r=>({...r,download_url:r.storage_path?await createResourceDownloadUrl(r.storage_path):r.external_url})));return c.json({resources,quizzes:(await client.query(`SELECT id,title,topic,licence_category_id,duration_minutes FROM public.quizzes WHERE is_published ORDER BY title LIMIT 200`)).rows});});
});

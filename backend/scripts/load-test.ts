import { serve } from '@hono/node-server';
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { app } from '../src/app.js';
import { getPool } from '../src/db.js';
// Use a disposable database: the fixture creates a student, payment and attempts.
if (!process.env.DATABASE_URL || !['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Load tests require an explicitly configured local disposable database.');
process.env.N8N_ENABLED = 'false';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';
const concurrency=Number(process.env.LOAD_CONCURRENCY || 50);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>1000) throw new Error('LOAD_CONCURRENCY must be 1..1000');
async function fixture(path: string, body?: any, token?: string) {
 const r=await app.request('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
 if(!r.ok) throw new Error(`Fixture ${path}: ${r.status}`); return await r.json() as any;
}
const pool=getPool();
const admin=await fixture('/auth/login',{identifier:'+237699000001',password:'Admin@Marseillaise2026!'});
const cat=await fixture('/auth/catalogue');
const category=cat.licenceCategories.find((c:any)=>c.code==='B');
const group=(await fixture('/admin/groups',{licenceCategoryId:category.id,name:'Disposable load '+crypto.randomUUID(),capacity:10000,totalFee:120000,startDate:'2026-12-01',installments:[{position:1,label:'Load fixture',amount:120000,dueDate:'2026-12-01'}]},admin.token)).group;
const phone=`+23769${crypto.randomInt(1000000,9999999)}`;
const otp=await fixture('/auth/request-otp',{phone});
const student=await fixture('/auth/register',{fullName:'Charge test locale',phone,password:'LoadTest123!',otpCode:otp.devOtpPreview,licenceCategoryId:category.id,groupId:group.id});
const me=await fixture('/student/me',undefined,student.token);
const quizzes=await fixture('/student/quizzes',undefined,student.token);
const payment={enrollmentId:me.enrollment.enrollment_id,amount:1,clientId:crypto.randomUUID()};
const firstPayment=await fixture('/admin/payments',payment,admin.token);
const server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'});
await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
const port=(server.address() as any).port;
const jobs=Array.from({length:1000},(_,i)=> {
 const paths=['/auth/catalogue','/student/me','/student/resources','/student/quizzes','/admin/dashboard','/admin/students','/admin/content','/admin/audit-log','/student/quiz-attempts','/admin/payments'];
 const which=i%10;return {path:paths[which],token:which>=4&&which<=7||which===9?admin.token:student.token,
 body:which===8?{quizId:quizzes.quizzes[0].id,answers:{},score:0,total:quizzes.quizzes[0].questions.length,clientId:crypto.randomUUID()}:which===9?payment:undefined,expected:which>=8?201:200};
});
let next=0;const latencies:number[]=[];const failures:any[]=[];const statuses:Record<string,number>={};
const started=performance.now();
try {
 await Promise.all(Array.from({length:concurrency},async()=>{
  while(next<jobs.length){const index=next++;const job=jobs[index];const start=performance.now();
   try {const r=await fetch(`http://127.0.0.1:${port}/api${job.path}`,{method:job.body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${job.token}`},body:job.body?JSON.stringify(job.body):undefined,signal:AbortSignal.timeout(30000)});
    const data:any=await r.json();statuses[r.status]=(statuses[r.status]||0)+1;
    if(r.status!==job.expected|| (job.path==='/admin/payments'&&data.payment?.id!==firstPayment.payment.id)) failures.push({index,path:job.path,status:r.status,error:data.error});
   }catch(e){failures.push({index,path:job.path,error:String(e)});}finally{latencies.push(performance.now()-start);}
  }
 }));
 const elapsedMs=performance.now()-started;latencies.sort((a,b)=>a-b);
 const balance=await pool.query('SELECT paid,balance FROM enrollment_balances WHERE enrollment_id=$1',[me.enrollment.enrollment_id]);
 const invariant=Number(balance.rows[0].paid)===1&&Number(balance.rows[0].balance)===Number(me.enrollment.total_fee)-1;
 const health=await fixture('/health');
 const report={requests:1000,concurrency,failures:failures.length,statuses,elapsedMs:Math.round(elapsedMs),requestsPerSecond:Math.round(1000000/elapsedMs),latencyMs:{p50:Math.round(latencies[499]),p95:Math.round(latencies[949]),p99:Math.round(latencies[989]),max:Math.round(latencies[999])},paymentInvariant:invariant,healthAfter:health.status,failureExamples:failures.slice(0,10)};
 console.log(JSON.stringify(report,null,2));
 if(process.env.LOAD_REPORT_PATH) await writeFile(process.env.LOAD_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
 if(failures.length||!invariant||health.status!=='ok')process.exitCode=1;
}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pool.end();}

-- Additive foundation. Run as migration owner on a backed-up disposable branch first.
-- Global identity is deliberately separate from school-scoped domain data.
create extension if not exists pgcrypto;
create schema if not exists identity;
create schema if not exists school_app;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'aem_tenant_runtime') then create role aem_tenant_runtime nologin nobypassrls nocreatedb nocreaterole; end if; if not exists (select 1 from pg_roles where rolname = 'aem_identity_runtime') then create role aem_identity_runtime nologin nobypassrls nocreatedb nocreaterole; end if; alter role aem_tenant_runtime nologin nobypassrls nocreatedb nocreaterole; alter role aem_identity_runtime nologin nobypassrls nocreatedb nocreaterole; if (select rolsuper from pg_roles where rolname = current_user) then alter role aem_tenant_runtime nosuperuser; alter role aem_identity_runtime nosuperuser; end if; end $$;
-- Role attributes verified for both Neon CREATEROLE and local superuser.
-- aem_tenant_runtime configured above.
-- aem_identity_runtime configured above.
-- Better Auth PostgreSQL adapter names/columns (quoted camelCase).
create table if not exists identity."user" (id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null default false, image text, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now());
create table if not exists identity."session" (id text primary key, "expiresAt" timestamptz not null, token text not null unique, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), "ipAddress" text, "userAgent" text, "userId" text not null references identity."user"(id) on delete cascade);
create table if not exists identity.account (id text primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references identity."user"(id) on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now());
create table if not exists identity.verification (id text primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now());
create index if not exists session_user_idx on identity."session"("userId");
create index if not exists account_user_idx on identity.account("userId");
create index if not exists verification_identifier_idx on identity.verification(identifier);
create table if not exists school_app.schools (
 id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'), logo text,
 colors jsonb not null default '{"primary":"#1f4e8c","accent":"#f5a623"}', trial_days integer not null default 14 check(trial_days=14), receipt_prefix text not null default 'RC' check(receipt_prefix ~ '^[A-Z0-9]{1,8}$'),
 address text not null default '', phone text not null default '', whatsapp text not null default '', agrement_number text not null default '', status text not null default 'active' check(status in ('active','suspended'))
);
create table if not exists school_app.school_members (school_id uuid not null references school_app.schools(id), user_id text not null references identity."user"(id), role text not null check(role in ('admin','student')), primary key(school_id,user_id));
create table if not exists school_app.platform_admins (user_id text primary key references identity."user"(id));
create table if not exists school_app.platform_audit (id bigint generated always as identity primary key, actor text not null, school_id uuid not null references school_app.schools(id), action text not null, reason text not null check(length(trim(reason))>=5), at timestamptz not null default now());
create table if not exists school_app.licence_categories (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), code text not null, name text not null, is_active boolean not null default true, unique(school_id,id), unique(school_id,code));
create table if not exists school_app.groups (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), licence_category_id uuid not null, name text not null, schedule_text text not null default '', start_date date, capacity integer not null check(capacity>0), total_fee bigint not null check(total_fee>=0 and total_fee<=1000000000), status text not null default 'open' check(status in ('open','closed','finished')), unique(school_id,id), foreign key(school_id,licence_category_id) references school_app.licence_categories(school_id,id));
create table if not exists school_app.installments (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), group_id uuid not null, position integer not null check(position>0), label text not null, amount bigint not null check(amount>0), due_date date not null, unique(school_id,id), unique(school_id,group_id,position), foreign key(school_id,group_id) references school_app.groups(school_id,id));
create table if not exists school_app.students (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), user_id text references identity."user"(id), student_number bigint generated by default as identity(start with 1000), full_name text not null, phone text not null check(phone ~ '^\+237[26][0-9]{8}$'), licence_category_id uuid not null, activated_at timestamptz, trial_ends_at timestamptz, registered_at timestamptz not null default now(), unique(school_id,id), unique(school_id,phone), unique(school_id,user_id), unique(school_id,student_number), foreign key(school_id,licence_category_id) references school_app.licence_categories(school_id,id));
create table if not exists school_app.enrollments (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), student_id uuid not null, group_id uuid not null, status text not null default 'active' check(status in ('active','completed','cancelled')), created_at timestamptz not null default now(), unique(school_id,id), unique(school_id,student_id,group_id), foreign key(school_id,student_id) references school_app.students(school_id,id), foreign key(school_id,group_id) references school_app.groups(school_id,id));
create table if not exists school_app.invites (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), student_id uuid not null, code_hash text not null, expires_at timestamptz not null, used_at timestamptz, created_by text not null references identity."user"(id), unique(school_id,id), foreign key(school_id,student_id) references school_app.students(school_id,id));
create index if not exists invites_lookup on school_app.invites(school_id,code_hash);
create table if not exists school_app.receipt_counters (school_id uuid not null references school_app.schools(id), year integer not null, last_value integer not null default 0, primary key(school_id,year));
create table if not exists school_app.payments (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), enrollment_id uuid not null, amount bigint not null check(amount>0), method text not null check(method in ('cash','mtn_momo','orange_money','bank')), reference text, receipt_number text not null, paid_at timestamptz not null default now(), recorded_by text not null references identity."user"(id), client_id uuid not null, cancelled_at timestamptz, cancelled_by text references identity."user"(id), cancel_reason text, unique(school_id,id), unique(school_id,receipt_number), unique(school_id,client_id), foreign key(school_id,enrollment_id) references school_app.enrollments(school_id,id), check((cancelled_at is null and cancelled_by is null and cancel_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(trim(cancel_reason))>=1)));
create index if not exists payments_enrollment on school_app.payments(school_id,enrollment_id) where cancelled_at is null;
create table if not exists school_app.audit_log (id bigint generated always as identity primary key, school_id uuid not null references school_app.schools(id), actor text, action text not null, row_id uuid, details jsonb not null, at timestamptz not null default now());
create table if not exists school_app.resources (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), licence_category_id uuid not null, title text not null, description text not null default '', type text not null default 'pdf', storage_path text, external_url text, is_published boolean not null default false, unique(school_id,id), foreign key(school_id,licence_category_id) references school_app.licence_categories(school_id,id));
create table if not exists school_app.quizzes (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), licence_category_id uuid not null, title text not null, duration_minutes integer not null check(duration_minutes>0), is_published boolean not null default false, unique(school_id,id), foreign key(school_id,licence_category_id) references school_app.licence_categories(school_id,id));
create table if not exists school_app.questions (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), quiz_id uuid not null, body text not null, options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options)>=2), correct_index integer not null check(correct_index>=0), image_url text, position integer not null, unique(school_id,id), foreign key(school_id,quiz_id) references school_app.quizzes(school_id,id));
create table if not exists school_app.quiz_attempts (id uuid primary key default gen_random_uuid(), school_id uuid not null references school_app.schools(id), student_id uuid not null, quiz_id uuid not null, answers jsonb not null, score integer not null, total integer not null, taken_at timestamptz not null, client_id uuid not null, unique(school_id,id), unique(school_id,client_id), foreign key(school_id,student_id) references school_app.students(school_id,id), foreign key(school_id,quiz_id) references school_app.quizzes(school_id,id));
create or replace function school_app.user_id() returns text language sql stable as $$ select nullif(current_setting('app.user_id',true),'') $$;
create or replace function school_app.school_id() returns uuid language sql stable as $$ select nullif(current_setting('app.school_id',true),'')::uuid $$;
create or replace function school_app.member_role() returns text language sql stable security definer set search_path=pg_catalog,school_app as $$ select role from school_app.school_members where school_id=school_app.school_id() and user_id=school_app.user_id() $$;
create or replace function school_app.is_admin() returns boolean language sql stable as $$ select coalesce(school_app.member_role()='admin',false) $$;
create or replace function school_app.owns_student(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,school_app as $$ select exists(select 1 from school_app.students where school_id=school_app.school_id() and id=p_id and user_id=school_app.user_id()) $$;
create or replace function school_app.owns_enrollment(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,school_app as $$ select exists(select 1 from school_app.enrollments e join school_app.students s on s.school_id=e.school_id and s.id=e.student_id where e.school_id=school_app.school_id() and e.id=p_id and s.user_id=school_app.user_id()) $$;
create or replace function school_app.student_has_paid(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,school_app as $$ select exists(select 1 from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id where e.school_id=school_app.school_id() and e.student_id=p_id and p.cancelled_at is null) $$;
create or replace function school_app.student_has_access(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,school_app as $$ select exists(select 1 from school_app.students s where s.school_id=school_app.school_id() and s.id=p_id and (s.trial_ends_at>now() or school_app.student_has_paid(s.id))) $$;
create or replace function school_app.can_learn(p_category uuid) returns boolean language sql stable security definer set search_path=pg_catalog,school_app as $$ select school_app.is_admin() or exists(select 1 from school_app.students where school_id=school_app.school_id() and user_id=school_app.user_id() and licence_category_id=p_category and school_app.student_has_access(id)) $$;
create or replace function school_app.set_trial() returns trigger language plpgsql security definer set search_path=pg_catalog,school_app as $$ begin if new.user_id is not null and new.trial_ends_at is null and (tg_op='INSERT' or old.user_id is null) then new.activated_at=now(); new.trial_ends_at=now()+(select make_interval(days=>trial_days) from school_app.schools where id=new.school_id); end if; return new; end $$;
drop trigger if exists students_trial on school_app.students;
create trigger students_trial before insert or update of user_id on school_app.students for each row execute function school_app.set_trial();
-- RLS: restrictive tenant boundary plus permissive operation-specific policies.
do $$ declare t text; begin foreach t in array array['school_members','licence_categories','groups','installments','students','enrollments','invites','receipt_counters','payments','audit_log','resources','quizzes','questions','quiz_attempts'] loop
 execute format('alter table school_app.%I enable row level security',t);
 execute format('drop policy if exists tenant_boundary on school_app.%I',t);
 execute format('create policy tenant_boundary on school_app.%I as restrictive for all to aem_tenant_runtime using(school_id=school_app.school_id()) with check(school_id=school_app.school_id())',t);
 end loop; end $$;
alter table school_app.schools enable row level security;
drop policy if exists school_read on school_app.schools; create policy school_read on school_app.schools for select to aem_tenant_runtime using(id=school_app.school_id() and status='active');
drop policy if exists school_admin on school_app.schools; create policy school_admin on school_app.schools for update to aem_tenant_runtime using(id=school_app.school_id() and school_app.is_admin()) with check(id=school_app.school_id() and school_app.is_admin());
do $$ declare t text; begin foreach t in array array['licence_categories','groups','installments'] loop
 execute format('drop policy if exists catalogue_read on school_app.%I',t); execute format('create policy catalogue_read on school_app.%I for select to aem_tenant_runtime using(true)',t);
 execute format('drop policy if exists admin_write on school_app.%I',t); execute format('create policy admin_write on school_app.%I for all to aem_tenant_runtime using(school_app.is_admin()) with check(school_app.is_admin())',t); end loop; end $$;
drop policy if exists member_read on school_app.school_members; create policy member_read on school_app.school_members for select to aem_tenant_runtime using(user_id=school_app.user_id() or school_app.is_admin());
drop policy if exists student_read on school_app.students; create policy student_read on school_app.students for select to aem_tenant_runtime using(user_id=school_app.user_id() or school_app.is_admin());
drop policy if exists student_admin on school_app.students; create policy student_admin on school_app.students for all to aem_tenant_runtime using(school_app.is_admin()) with check(school_app.is_admin());
drop policy if exists enrollment_read on school_app.enrollments; create policy enrollment_read on school_app.enrollments for select to aem_tenant_runtime using(school_app.owns_student(student_id) or school_app.is_admin());
drop policy if exists enrollment_admin on school_app.enrollments; create policy enrollment_admin on school_app.enrollments for all to aem_tenant_runtime using(school_app.is_admin()) with check(school_app.is_admin());
drop policy if exists payment_read on school_app.payments; create policy payment_read on school_app.payments for select to aem_tenant_runtime using(school_app.owns_enrollment(enrollment_id) or school_app.is_admin());
drop policy if exists attempt_read on school_app.quiz_attempts; create policy attempt_read on school_app.quiz_attempts for select to aem_tenant_runtime using(school_app.owns_student(student_id) or school_app.is_admin());
do $$ declare t text; begin foreach t in array array['invites','audit_log','receipt_counters'] loop execute format('drop policy if exists admin_only on school_app.%I',t);execute format('create policy admin_only on school_app.%I for select to aem_tenant_runtime using(school_app.is_admin())',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['resources','quizzes'] loop execute format('drop policy if exists content_read on school_app.%I',t); execute format('create policy content_read on school_app.%I for select to aem_tenant_runtime using(school_app.is_admin() or (is_published and school_app.can_learn(licence_category_id)))',t);end loop;end $$;
drop policy if exists question_read on school_app.questions;create policy question_read on school_app.questions for select to aem_tenant_runtime using(exists(select 1 from school_app.quizzes q where q.id=quiz_id and q.school_id=questions.school_id));
-- Student answer keys are never granted, including through SELECT *.
grant usage on schema school_app to aem_tenant_runtime;
grant select on school_app.schools,school_app.school_members,school_app.licence_categories,school_app.groups,school_app.installments,school_app.students,school_app.enrollments,school_app.payments,school_app.invites,school_app.audit_log,school_app.resources,school_app.quizzes,school_app.quiz_attempts to aem_tenant_runtime;
grant select(id,school_id,quiz_id,body,options,image_url,position) on school_app.questions to aem_tenant_runtime;
grant insert,update on school_app.licence_categories,school_app.groups,school_app.installments,school_app.students,school_app.enrollments to aem_tenant_runtime;
grant update(name,logo,colors,address,phone,whatsapp,agrement_number) on school_app.schools to aem_tenant_runtime;
grant usage on all sequences in schema school_app to aem_tenant_runtime;
create or replace view school_app.enrollment_balances with(security_invoker=true) as select e.school_id,e.id as enrollment_id,e.student_id,e.group_id,g.name as group_name,g.total_fee,coalesce(sum(p.amount) filter(where p.cancelled_at is null),0)::bigint as paid,(g.total_fee-coalesce(sum(p.amount) filter(where p.cancelled_at is null),0))::bigint as balance from school_app.enrollments e join school_app.groups g on g.school_id=e.school_id and g.id=e.group_id left join school_app.payments p on p.school_id=e.school_id and p.enrollment_id=e.id group by e.school_id,e.id,e.student_id,e.group_id,g.name,g.total_fee;
create or replace view school_app.installment_status with(security_invoker=true) as with x as(select b.school_id,b.enrollment_id,i.id,i.position,i.label,i.amount,i.due_date,b.paid,sum(i.amount) over(partition by b.school_id,b.enrollment_id order by i.position) as cumulative_due from school_app.enrollment_balances b join school_app.installments i on i.school_id=b.school_id and i.group_id=b.group_id) select *,greatest(0,least(amount,paid-(cumulative_due-amount)))::bigint as paid_amount,case when paid>=cumulative_due then 'paid' when due_date<(now() at time zone 'Africa/Douala')::date then 'overdue' when paid>cumulative_due-amount then 'partial' else 'upcoming' end as status from x;
grant select on school_app.enrollment_balances,school_app.installment_status to aem_tenant_runtime;
create or replace function school_app.record_payment(p_enrollment uuid,p_amount bigint,p_method text,p_reference text,p_client uuid,p_paid_at timestamptz default now(),p_receipt text default null) returns school_app.payments language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare e school_app.enrollments;g school_app.groups;r school_app.payments;n integer;y integer;v_balance bigint;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_client is null or p_amount<=0 or p_amount>1000000000 then raise exception 'INVALID_PAYMENT';end if;
 perform pg_advisory_xact_lock(hashtextextended(school_app.school_id()::text||p_client::text,0));
 select * into r from school_app.payments where school_id=school_app.school_id() and client_id=p_client;
 if found then if r.enrollment_id<>p_enrollment or r.amount<>p_amount or r.method<>p_method or r.reference is distinct from p_reference then raise exception 'IDEMPOTENCY_CONFLICT';end if;return r;end if;
 select * into e from school_app.enrollments where school_id=school_app.school_id() and id=p_enrollment;
 if not found or e.status='cancelled' then raise exception 'ENROLLMENT_NOT_FOUND';end if;
 select * into g from school_app.groups where school_id=e.school_id and id=e.group_id for update;
 perform 1 from school_app.enrollments where school_id=e.school_id and id=e.id for update;
 select g.total_fee-coalesce(sum(amount),0) into v_balance from school_app.payments where school_id=e.school_id and enrollment_id=e.id and cancelled_at is null;
 if p_amount>v_balance then raise exception 'EXCEEDS_BALANCE';end if;
 if not exists(select 1 from school_app.payments where school_id=e.school_id and enrollment_id=e.id and cancelled_at is null) and (select count(distinct en.id) from school_app.enrollments en join school_app.payments p on p.school_id=en.school_id and p.enrollment_id=en.id and p.cancelled_at is null where en.school_id=e.school_id and en.group_id=e.group_id and en.status<>'cancelled')>=g.capacity then raise exception 'GROUP_FULL';end if;
 if p_receipt is null then y=extract(year from now() at time zone 'Africa/Douala');insert into school_app.receipt_counters values(e.school_id,y,1) on conflict(school_id,year) do update set last_value=school_app.receipt_counters.last_value+1 returning last_value into n;p_receipt=(select receipt_prefix from school_app.schools where id=e.school_id)||'-'||y||'-'||lpad(n::text,6,'0');end if;
 insert into school_app.payments(school_id,enrollment_id,amount,method,reference,receipt_number,paid_at,recorded_by,client_id) values(e.school_id,e.id,p_amount,p_method,p_reference,p_receipt,p_paid_at,school_app.user_id(),p_client) returning * into r;return r;
end $$;
create or replace function school_app.guard_payment() returns trigger language plpgsql as $$ begin
 if tg_op='DELETE' then raise exception 'APPEND_ONLY';end if;
 if (to_jsonb(new)-array['cancelled_at','cancelled_by','cancel_reason']) is distinct from (to_jsonb(old)-array['cancelled_at','cancelled_by','cancel_reason']) or old.cancelled_at is not null then raise exception 'APPEND_ONLY';end if;
 if new.cancelled_at is null or length(trim(new.cancel_reason))<3 then raise exception 'REASON_REQUIRED';end if;return new;end $$;
drop trigger if exists payment_guard on school_app.payments;create trigger payment_guard before update or delete on school_app.payments for each row execute function school_app.guard_payment();
create or replace function school_app.audit_payment() returns trigger language plpgsql security definer set search_path=pg_catalog,school_app as $$ begin insert into school_app.audit_log(school_id,actor,action,row_id,details) values(new.school_id,school_app.user_id(),tg_op,new.id,to_jsonb(new));return new;end $$;
drop trigger if exists payment_audit on school_app.payments;create trigger payment_audit after insert or update on school_app.payments for each row execute function school_app.audit_payment();
create or replace function school_app.cancel_payment(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare g uuid;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;if length(trim(p_reason))<3 then raise exception 'REASON_REQUIRED';end if;
 select e.group_id into g from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id where p.school_id=school_app.school_id() and p.id=p_id;
 if g is null then raise exception 'PAYMENT_NOT_FOUND';end if;perform 1 from school_app.groups where school_id=school_app.school_id() and id=g for update;
 update school_app.payments set cancelled_at=now(),cancelled_by=school_app.user_id(),cancel_reason=trim(p_reason) where school_id=school_app.school_id() and id=p_id and cancelled_at is null;
end $$;
create or replace function school_app.enroll_self(p_group uuid,p_name text,p_phone text) returns uuid language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare g school_app.groups;s uuid;begin
 if school_app.user_id() is null then raise exception 'AUTH_REQUIRED';end if;
 select * into g from school_app.groups where school_id=school_app.school_id() and id=p_group and status='open';if not found then raise exception 'INVALID_GROUP';end if;
 if not exists(select 1 from school_app.licence_categories where school_id=g.school_id and id=g.licence_category_id and is_active) then raise exception 'INVALID_LICENCE';end if;
 insert into school_app.school_members values(g.school_id,school_app.user_id(),'student') on conflict do nothing;
 insert into school_app.students(school_id,user_id,full_name,phone,licence_category_id) values(g.school_id,school_app.user_id(),p_name,p_phone,g.licence_category_id) returning id into s;
 insert into school_app.enrollments(school_id,student_id,group_id) values(g.school_id,s,g.id);return s;
end $$;
create or replace function school_app.create_invite(p_student uuid) returns text language plpgsql security definer set search_path=pg_catalog,school_app,public as $$ declare code text;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if not exists(select 1 from school_app.students where school_id=school_app.school_id() and id=p_student and user_id is null) then raise exception 'INVALID_STUDENT';end if;
 code=upper(encode(gen_random_bytes(12),'hex'));
 update school_app.invites set expires_at=now() where school_id=school_app.school_id() and student_id=p_student and used_at is null;
 insert into school_app.invites(school_id,student_id,code_hash,expires_at,created_by) values(school_app.school_id(),p_student,encode(digest(code,'sha256'),'hex'),now()+interval '7 days',school_app.user_id());return code;
end $$;
create or replace function school_app.claim_invite(p_code text,p_phone text) returns uuid language plpgsql security definer set search_path=pg_catalog,school_app,public as $$ declare i school_app.invites;s uuid;begin
 if school_app.user_id() is null then raise exception 'AUTH_REQUIRED';end if;
 select * into i from school_app.invites where school_id=school_app.school_id() and code_hash=encode(digest(upper(trim(p_code)),'sha256'),'hex') and used_at is null and expires_at>now() for update;
 if not found then raise exception 'INVALID_INVITE';end if;
 update school_app.students set user_id=school_app.user_id() where school_id=i.school_id and id=i.student_id and phone=p_phone and user_id is null returning id into s;
 if s is null then raise exception 'INVALID_INVITE';end if;
 insert into school_app.school_members values(i.school_id,school_app.user_id(),'student') on conflict do nothing;
 update school_app.invites set used_at=now() where school_id=i.school_id and id=i.id;return s;
end $$;
create or replace function school_app.submit_quiz(p_quiz uuid,p_answers jsonb,p_client uuid,p_taken timestamptz) returns school_app.quiz_attempts language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare s school_app.students;q school_app.quizzes;r school_app.quiz_attempts;v_score integer;v_total integer;begin
 select * into s from school_app.students where school_id=school_app.school_id() and user_id=school_app.user_id();if not found then raise exception 'STUDENT_REQUIRED';end if;
 select * into q from school_app.quizzes where school_id=s.school_id and id=p_quiz and licence_category_id=s.licence_category_id and is_published;if not found then raise exception 'QUIZ_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(s.school_id::text||p_client::text,0));
 select * into r from school_app.quiz_attempts where school_id=s.school_id and client_id=p_client;if found then if r.student_id<>s.id or r.quiz_id<>q.id or r.answers<>p_answers then raise exception 'IDEMPOTENCY_CONFLICT';end if;return r;end if;
 select count(*)::integer,count(*) filter(where p_answers->>id::text=correct_index::text)::integer into v_total,v_score from school_app.questions where school_id=s.school_id and quiz_id=q.id;
 if v_total=0 then raise exception 'EMPTY_QUIZ';end if;
 insert into school_app.quiz_attempts(school_id,student_id,quiz_id,answers,score,total,taken_at,client_id) values(s.school_id,s.id,q.id,p_answers,v_score,v_total,p_taken,p_client) returning * into r;return r;
end $$;
-- No public execute on security definers; expose only reviewed entry points.
revoke all on all functions in schema school_app from public;
grant execute on function school_app.user_id(),school_app.school_id(),school_app.member_role(),school_app.is_admin(),school_app.owns_student(uuid),school_app.owns_enrollment(uuid),school_app.student_has_paid(uuid),school_app.student_has_access(uuid),school_app.can_learn(uuid),school_app.record_payment(uuid,bigint,text,text,uuid,timestamptz,text),school_app.cancel_payment(uuid,text),school_app.enroll_self(uuid,text,text),school_app.create_invite(uuid),school_app.claim_invite(text,text),school_app.submit_quiz(uuid,jsonb,uuid,timestamptz) to aem_tenant_runtime;
-- Auth role cannot read domain tables; application role cannot read password/session tables.
grant usage on schema identity to aem_identity_runtime;
grant select,insert,update,delete on all tables in schema identity to aem_identity_runtime;
create or replace function school_app.resolve_school(p_slug text) returns table(id uuid) language sql stable security definer set search_path=pg_catalog,school_app as $$ select id from school_app.schools where slug=p_slug and status='active' $$;
revoke all on function school_app.resolve_school(text) from public;
grant execute on function school_app.resolve_school(text) to aem_tenant_runtime;
create table if not exists identity."rateLimit" (id text primary key, key text unique not null, count integer not null, "lastRequest" bigint not null);
grant select,insert,update,delete on identity."rateLimit" to aem_identity_runtime;
-- Append-only logs, including migration-owner accidental mutation protection.
create or replace function school_app.immutable_log() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_APPEND_ONLY';end $$;
drop trigger if exists immutable_audit on school_app.audit_log;create trigger immutable_audit before update or delete on school_app.audit_log for each row execute function school_app.immutable_log();
drop trigger if exists immutable_platform_audit on school_app.platform_audit;create trigger immutable_platform_audit before update or delete on school_app.platform_audit for each row execute function school_app.immutable_log();
-- Platform access is explicit, reasoned and audited; never an RLS bypass for school data.
create or replace function school_app.platform_action(p_action text,p_school uuid,p_reason text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare result jsonb;target uuid;begin
 if not exists(select 1 from school_app.platform_admins where user_id=school_app.user_id()) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if length(trim(p_reason))<5 then raise exception 'REASON_REQUIRED';end if;
 if p_action='create_school' then
  insert into school_app.schools(name,slug,address,phone,whatsapp,agrement_number) values(p_data->>'name',p_data->>'slug',coalesce(p_data->>'address',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'whatsapp',''),coalesce(p_data->>'agrement_number','')) returning id into target;
  if p_data->>'adminUserId' is not null then insert into school_app.school_members values(target,p_data->>'adminUserId','admin');end if;
 elsif p_action in ('suspend_school','activate_school') then target=p_school;update school_app.schools set status=case when p_action='suspend_school' then 'suspended' else 'active' end where id=target;if not found then raise exception 'SCHOOL_NOT_FOUND';end if;
 else raise exception 'INVALID_PLATFORM_ACTION';end if;
 insert into school_app.platform_audit(actor,school_id,action,reason) values(school_app.user_id(),target,p_action,p_reason);
 select to_jsonb(s) into result from school_app.schools s where id=target;return result;
end $$;
revoke all on function school_app.immutable_log(),school_app.platform_action(text,uuid,text,jsonb) from public;
grant execute on function school_app.platform_action(text,uuid,text,jsonb) to aem_tenant_runtime;

alter table school_app.resources add column if not exists external_url text;
alter table school_app.resources alter column storage_path drop not null;

alter table school_app.questions add column if not exists explanation text not null default '';
do $$ begin alter table school_app.questions add constraint questions_correct_index_bounds check(correct_index >= 0 and correct_index < jsonb_array_length(options)); exception when duplicate_object then null; end $$;
create table if not exists school_app.legacy_deferred_archive (id bigint generated always as identity primary key, school_id uuid not null references school_app.schools(id), source_table text not null, source_id text not null, payload jsonb not null, archived_at timestamptz not null default now(), unique(school_id, source_table, source_id));
alter table school_app.legacy_deferred_archive enable row level security;
drop policy if exists tenant_boundary on school_app.legacy_deferred_archive;
create policy tenant_boundary on school_app.legacy_deferred_archive as restrictive for all to aem_tenant_runtime using(school_id=school_app.school_id()) with check(school_id=school_app.school_id());
drop policy if exists admin_only on school_app.legacy_deferred_archive;
create policy admin_only on school_app.legacy_deferred_archive for select to aem_tenant_runtime using(school_app.is_admin());
grant select on school_app.legacy_deferred_archive to aem_tenant_runtime;
drop trigger if exists immutable_legacy_archive on school_app.legacy_deferred_archive;
create trigger immutable_legacy_archive before update or delete on school_app.legacy_deferred_archive for each row execute function school_app.immutable_log();
create index if not exists tenant_payment_date on school_app.payments(school_id,paid_at desc,id);

-- E04 & E05: explanation grant, offline receipt separation, deterministic error codes, and admin content authoring
grant select(explanation) on school_app.questions to aem_tenant_runtime;

create or replace function school_app.actor_display_name(p_user_id text) returns text language sql stable security definer set search_path=pg_catalog,identity,school_app as $$
 select case when school_app.user_id() is not null and school_app.school_id() is not null then (select u.name from identity."user" u where u.id=p_user_id) else null end
$$;

create or replace function school_app.record_payment(p_enrollment uuid,p_amount bigint,p_method text,p_reference text,p_client uuid,p_paid_at timestamptz default now(),p_receipt text default null) returns school_app.payments language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare e school_app.enrollments;g school_app.groups;r school_app.payments;n integer;y integer;v_balance bigint;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 if p_client is null or p_amount<=0 or p_amount>1000000000 then raise exception 'INVALID_PAYMENT';end if;
 if p_receipt is not null and (p_receipt !~ '^RC-[A-Z0-9]{4,32}-[0-9]{1,12}$' or p_receipt ~ '^RC-[0-9]{4}-[0-9]+$') then raise exception 'INVALID_RECEIPT_NUMBER';end if;
 perform pg_advisory_xact_lock(hashtextextended(school_app.school_id()::text||p_client::text,0));
 select * into r from school_app.payments where school_id=school_app.school_id() and client_id=p_client;
 if found then if r.enrollment_id<>p_enrollment or r.amount<>p_amount or r.method<>p_method or r.reference is distinct from p_reference or (p_receipt is not null and r.receipt_number<>p_receipt) then raise exception 'IDEMPOTENCY_CONFLICT';end if;return r;end if;
 select * into e from school_app.enrollments where school_id=school_app.school_id() and id=p_enrollment;
 if not found or e.status='cancelled' then raise exception 'ENROLLMENT_NOT_FOUND';end if;
 select * into g from school_app.groups where school_id=e.school_id and id=e.group_id for update;
 perform 1 from school_app.enrollments where school_id=e.school_id and id=e.id for update;
 select g.total_fee-coalesce(sum(amount),0) into v_balance from school_app.payments where school_id=e.school_id and enrollment_id=e.id and cancelled_at is null;
 if p_amount>v_balance then raise exception 'EXCEEDS_BALANCE';end if;
 if not exists(select 1 from school_app.payments where school_id=e.school_id and enrollment_id=e.id and cancelled_at is null) and (select count(distinct en.id) from school_app.enrollments en join school_app.payments p on p.school_id=en.school_id and p.enrollment_id=en.id and p.cancelled_at is null where en.school_id=e.school_id and en.group_id=e.group_id and en.status<>'cancelled')>=g.capacity then raise exception 'GROUP_FULL';end if;
 if p_receipt is not null then
  if exists(select 1 from school_app.payments where school_id=e.school_id and receipt_number=p_receipt) then raise exception 'RECEIPT_NUMBER_CONFLICT';end if;
 else
  y=extract(year from now() at time zone 'Africa/Douala');insert into school_app.receipt_counters values(e.school_id,y,1) on conflict(school_id,year) do update set last_value=school_app.receipt_counters.last_value+1 returning last_value into n;p_receipt=(select receipt_prefix from school_app.schools where id=e.school_id)||'-'||y||'-'||lpad(n::text,6,'0');
 end if;
 insert into school_app.payments(school_id,enrollment_id,amount,method,reference,receipt_number,paid_at,recorded_by,client_id) values(e.school_id,e.id,p_amount,p_method,p_reference,p_receipt,p_paid_at,school_app.user_id(),p_client) returning * into r;return r;
end $$;

create or replace function school_app.audit_payment() returns trigger language plpgsql security definer set search_path=pg_catalog,school_app as $$ begin insert into school_app.audit_log(school_id,actor,action,row_id,details) values(new.school_id,school_app.user_id(),tg_op,new.id,to_jsonb(new)||jsonb_build_object('school_snapshot',(select jsonb_build_object('name',s.name,'address',s.address,'phone',s.phone,'whatsapp',s.whatsapp,'agrement_number',s.agrement_number,'receipt_prefix',s.receipt_prefix) from school_app.schools s where s.id=new.school_id),'balance_snapshot',(select b.balance from school_app.enrollment_balances b where b.school_id=new.school_id and b.enrollment_id=new.enrollment_id)));return new;end $$;

create or replace function school_app.cancel_payment(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare g uuid;v_cancelled timestamptz;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;if length(trim(p_reason))<3 then raise exception 'REASON_REQUIRED';end if;
 select e.group_id,p.cancelled_at into g,v_cancelled from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id where p.school_id=school_app.school_id() and p.id=p_id;
 if g is null then raise exception 'PAYMENT_NOT_FOUND';end if;
 if v_cancelled is not null then raise exception 'PAYMENT_ALREADY_CANCELLED';end if;
 perform 1 from school_app.groups where school_id=school_app.school_id() and id=g for update;
 update school_app.payments set cancelled_at=now(),cancelled_by=school_app.user_id(),cancel_reason=trim(p_reason) where school_id=school_app.school_id() and id=p_id and cancelled_at is null;
end $$;

create or replace function school_app.enroll_self(p_group uuid,p_name text,p_phone text) returns uuid language plpgsql security definer set search_path=pg_catalog,school_app as $$ declare g school_app.groups;s uuid;begin
 if school_app.user_id() is null then raise exception 'AUTH_REQUIRED';end if;
 select * into g from school_app.groups where school_id=school_app.school_id() and id=p_group and status='open';if not found then raise exception 'INVALID_GROUP';end if;
 if not exists(select 1 from school_app.licence_categories where school_id=g.school_id and id=g.licence_category_id and is_active) then raise exception 'INVALID_LICENCE';end if;
 if exists(select 1 from school_app.students where school_id=g.school_id and user_id=school_app.user_id()) then raise exception 'STUDENT_ALREADY_REGISTERED';end if;
 if exists(select 1 from school_app.students where school_id=g.school_id and phone=p_phone) then raise exception 'PHONE_ALREADY_REGISTERED';end if;
 insert into school_app.school_members values(g.school_id,school_app.user_id(),'student') on conflict do nothing;
 insert into school_app.students(school_id,user_id,full_name,phone,licence_category_id) values(g.school_id,school_app.user_id(),p_name,p_phone,g.licence_category_id) returning id into s;
 insert into school_app.enrollments(school_id,student_id,group_id) values(g.school_id,s,g.id);return s;
end $$;

create or replace function school_app.create_invite(p_student uuid) returns text language plpgsql security definer set search_path=pg_catalog,school_app,public as $$ declare code text;v_user text;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 select user_id into v_user from school_app.students where school_id=school_app.school_id() and id=p_student;
 if not found then raise exception 'STUDENT_NOT_FOUND';end if;
 if v_user is not null then raise exception 'STUDENT_ALREADY_ACTIVATED';end if;
 code=upper(encode(gen_random_bytes(12),'hex'));
 update school_app.invites set expires_at=now() where school_id=school_app.school_id() and student_id=p_student and used_at is null;
 insert into school_app.invites(school_id,student_id,code_hash,expires_at,created_by) values(school_app.school_id(),p_student,encode(digest(code,'sha256'),'hex'),now()+interval '7 days',school_app.user_id());return code;
end $$;

create or replace function school_app.claim_invite(p_code text,p_phone text) returns uuid language plpgsql security definer set search_path=pg_catalog,school_app,public as $$ declare i school_app.invites;s uuid;begin
 if school_app.user_id() is null then raise exception 'AUTH_REQUIRED';end if;
 select * into i from school_app.invites where school_id=school_app.school_id() and code_hash=encode(digest(upper(trim(p_code)),'sha256'),'hex') and used_at is null and expires_at>now() for update;
 if not found then raise exception 'INVALID_INVITE';end if;
 if exists(select 1 from school_app.students where school_id=i.school_id and user_id=school_app.user_id() and id<>i.student_id) then raise exception 'STUDENT_ALREADY_REGISTERED';end if;
 update school_app.students set user_id=school_app.user_id() where school_id=i.school_id and id=i.student_id and phone=p_phone and user_id is null returning id into s;
 if s is null then raise exception 'INVALID_INVITE';end if;
 insert into school_app.school_members values(i.school_id,school_app.user_id(),'student') on conflict do nothing;
 update school_app.invites set used_at=now() where school_id=i.school_id and id=i.id;return s;
end $$;

create or replace function school_app.admin_save_category(p_id uuid,p_code text,p_name text,p_is_active boolean default true) returns school_app.licence_categories language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare r school_app.licence_categories;v_school uuid;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_school=school_app.school_id();
 if exists(select 1 from school_app.licence_categories where school_id=v_school and upper(trim(code))=upper(trim(p_code)) and (p_id is null or id<>p_id)) then raise exception 'CATEGORY_CODE_CONFLICT';end if;
 if p_id is null then
  insert into school_app.licence_categories(school_id,code,name,is_active) values(v_school,upper(trim(p_code)),trim(p_name),coalesce(p_is_active,true)) returning * into r;
 else
  update school_app.licence_categories set code=upper(trim(p_code)),name=trim(p_name),is_active=coalesce(p_is_active,is_active) where school_id=v_school and id=p_id returning * into r;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 insert into school_app.audit_log(school_id,actor,action,row_id,details) values(v_school,school_app.user_id(),'SAVE_CATEGORY',r.id,to_jsonb(r));
 return r;
end $$;

create or replace function school_app.admin_save_resource(p_id uuid,p_category uuid,p_title text,p_description text,p_type text,p_storage_path text,p_external_url text,p_is_published boolean) returns school_app.resources language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare r school_app.resources;v_school uuid;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_school=school_app.school_id();
 if not exists(select 1 from school_app.licence_categories where school_id=v_school and id=p_category) then raise exception 'INVALID_LICENCE';end if;
 if (p_storage_path is null or length(trim(p_storage_path))=0) and (p_external_url is null or p_external_url !~ '^https://') then raise exception 'VALIDATION_ERROR';end if;
 if p_storage_path is not null and position(v_school::text||'/' in p_storage_path)<>1 and not exists(select 1 from school_app.resources where school_id=v_school and id=p_id and storage_path=p_storage_path) then raise exception 'RESOURCE_FORBIDDEN';end if;
 if p_id is null then
  insert into school_app.resources(school_id,licence_category_id,title,description,type,storage_path,external_url,is_published) values(v_school,p_category,trim(p_title),coalesce(p_description,''),p_type,nullif(trim(p_storage_path),''),nullif(trim(p_external_url),''),coalesce(p_is_published,false)) returning * into r;
 else
  update school_app.resources set licence_category_id=p_category,title=trim(p_title),description=coalesce(p_description,''),type=p_type,storage_path=nullif(trim(p_storage_path),''),external_url=nullif(trim(p_external_url),''),is_published=coalesce(p_is_published,is_published) where school_id=v_school and id=p_id returning * into r;
  if not found then raise exception 'RESOURCE_NOT_FOUND';end if;
 end if;
 insert into school_app.audit_log(school_id,actor,action,row_id,details) values(v_school,school_app.user_id(),'SAVE_RESOURCE',r.id,to_jsonb(r));
 return r;
end $$;

create or replace function school_app.admin_save_quiz(p_id uuid,p_category uuid,p_title text,p_duration integer,p_is_published boolean) returns school_app.quizzes language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare r school_app.quizzes;v_school uuid;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_school=school_app.school_id();
 if not exists(select 1 from school_app.licence_categories where school_id=v_school and id=p_category) then raise exception 'INVALID_LICENCE';end if;
 if p_duration is null or p_duration<=0 then raise exception 'VALIDATION_ERROR';end if;
 if p_id is null then
  insert into school_app.quizzes(school_id,licence_category_id,title,duration_minutes,is_published) values(v_school,p_category,trim(p_title),p_duration,coalesce(p_is_published,false)) returning * into r;
 else
  if p_is_published and not exists(select 1 from school_app.questions where school_id=v_school and quiz_id=p_id) then raise exception 'EMPTY_QUIZ';end if;
  update school_app.quizzes set licence_category_id=p_category,title=trim(p_title),duration_minutes=p_duration,is_published=coalesce(p_is_published,is_published) where school_id=v_school and id=p_id returning * into r;
  if not found then raise exception 'QUIZ_NOT_FOUND';end if;
 end if;
 insert into school_app.audit_log(school_id,actor,action,row_id,details) values(v_school,school_app.user_id(),'SAVE_QUIZ',r.id,to_jsonb(r));
 return r;
end $$;

create or replace function school_app.admin_save_question(p_id uuid,p_quiz uuid,p_body text,p_options jsonb,p_correct_index integer,p_image_url text,p_explanation text,p_position integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,school_app as $$
declare r school_app.questions;v_school uuid;begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 v_school=school_app.school_id();
 if not exists(select 1 from school_app.quizzes where school_id=v_school and id=p_quiz) then raise exception 'QUIZ_NOT_FOUND';end if;
 if p_options is null or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)<2 or p_correct_index is null or p_correct_index<0 or p_correct_index>=jsonb_array_length(p_options) then raise exception 'INVALID_QUESTION_OPTIONS';end if;
 if p_id is null then
  insert into school_app.questions(school_id,quiz_id,body,options,correct_index,image_url,explanation,position) values(v_school,p_quiz,trim(p_body),p_options,p_correct_index,nullif(trim(p_image_url),''),coalesce(p_explanation,''),p_position) returning * into r;
 else
  update school_app.questions set quiz_id=p_quiz,body=trim(p_body),options=p_options,correct_index=p_correct_index,image_url=nullif(trim(p_image_url),''),explanation=coalesce(p_explanation,''),position=p_position where school_id=v_school and id=p_id returning * into r;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 insert into school_app.audit_log(school_id,actor,action,row_id,details) values(v_school,school_app.user_id(),'SAVE_QUESTION',r.id,to_jsonb(r));
 return to_jsonb(r);
end $$;

create or replace function school_app.admin_list_questions(p_quiz uuid default null) returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,school_app as $$
begin
 if not school_app.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 return query select to_jsonb(q) from school_app.questions q where q.school_id=school_app.school_id() and (p_quiz is null or q.quiz_id=p_quiz) order by q.quiz_id,q.position,q.id;
end $$;

revoke all on function school_app.actor_display_name(text),school_app.admin_save_category(uuid,text,text,boolean),school_app.admin_save_resource(uuid,uuid,text,text,text,text,text,boolean),school_app.admin_save_quiz(uuid,uuid,text,integer,boolean),school_app.admin_save_question(uuid,uuid,text,jsonb,integer,text,text,integer),school_app.admin_list_questions(uuid) from public;
grant execute on function school_app.actor_display_name(text),school_app.admin_save_category(uuid,text,text,boolean),school_app.admin_save_resource(uuid,uuid,text,text,text,text,text,boolean),school_app.admin_save_quiz(uuid,uuid,text,integer,boolean),school_app.admin_save_question(uuid,uuid,text,jsonb,integer,text,text,integer),school_app.admin_list_questions(uuid) to aem_tenant_runtime;

-- P1: Dedicated read-only backup policies for aem_backup_reader
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'aem_backup_reader') then
    create role aem_backup_reader login nobypassrls nocreatedb nocreaterole;
  end if;
  alter role aem_backup_reader login nobypassrls nocreatedb nocreaterole;
  if (select rolsuper from pg_roles where rolname = current_user) then
    alter role aem_backup_reader nosuperuser;
  end if;
end $$;

grant usage on schema school_app, identity, public to aem_backup_reader;
grant select on all tables in schema school_app, identity, public to aem_backup_reader;
grant usage, select on all sequences in schema school_app, identity, public to aem_backup_reader;
alter default privileges in schema school_app, identity, public grant usage, select on sequences to aem_backup_reader;

do $$ declare t text; begin
  foreach t in array array['schools','school_members','platform_admins','licence_categories','groups','installments','students','enrollments','invites','receipt_counters','payments','audit_log','resources','quizzes','questions','quiz_attempts','legacy_deferred_archive','platform_audit'] loop
    execute format('drop policy if exists backup_read on school_app.%I', t);
    execute format('create policy backup_read on school_app.%I for select to aem_backup_reader using(true)', t);
  end loop;
end $$;

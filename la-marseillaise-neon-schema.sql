-- =====================================================================
-- Auto-école La Marseillaise: Database Schema v1 (Neon Serverless PostgreSQL)
-- Target: Neon (PostgreSQL 15/16+).
-- Money is stored in FCFA (XAF) as whole numbers (bigint).
-- Phone numbers are stored in E.164 format (+237XXXXXXXXX).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Session Context Helper (Replaces Supabase auth.uid())
--    The Backend API sets `app.current_user_id` at the start of each
--    authenticated transaction:
--    SELECT set_config('app.current_user_id', '<user-uuid>', true);
-- ---------------------------------------------------------------------
create or replace function public.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role         as enum ('admin', 'student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.group_status      as enum ('open', 'closed', 'finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrollment_status as enum ('active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method    as enum ('cash', 'mtn_momo', 'orange_money', 'bank');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.resource_type     as enum ('pdf', 'video', 'image', 'link');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Authentication Tables (Better Auth + Native Users) & Settings
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id             int  primary key default 1 check (id = 1),
  school_name    text not null default 'Auto-école La Marseillaise',
  trial_days     int  not null default 14 check (trial_days >= 0),
  receipt_prefix text not null default 'LM',
  school_phone   text not null default '+237690000000',
  school_address text not null default 'Yaoundé, Cameroun (Partenaire IUSJ)'
);
insert into public.app_settings default values on conflict (id) do nothing;

create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text unique,
  email_verified boolean not null default false,
  phone          text unique check (phone is null or phone ~ '^\+[0-9]{8,15}$'),
  phone_verified boolean not null default false,
  password_hash  text,
  image          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on public.sessions (user_id);

create table if not exists public.verifications (
  id         uuid primary key default gen_random_uuid(),
  identifier text not null,          -- e.g. phone number '+2376...'
  value      text not null,          -- SHA-256 hash of 6-digit OTP code
  expires_at timestamptz not null,
  used_at    timestamptz,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists verifications_identifier_idx on public.verifications (identifier);

create table if not exists public.profiles (
  id         uuid primary key references public.users(id) on delete cascade,
  role       public.user_role not null default 'student',
  created_at timestamptz not null default now()
);

-- Every new user in public.users automatically gets a 'student' profile.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_user_created on public.users;
create trigger on_user_created
  after insert on public.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_user_id() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Catalogue: licences, groups, instalment plans
-- ---------------------------------------------------------------------
create table if not exists public.licence_categories (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  is_active boolean not null default true
);

create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  licence_category_id uuid not null references public.licence_categories(id),
  name                text not null,
  start_date          date,
  capacity            int  check (capacity > 0),
  total_fee           bigint not null check (total_fee >= 0),
  status              public.group_status not null default 'open',
  created_at          timestamptz not null default now()
);

create table if not exists public.installments (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  position int  not null check (position > 0),
  label    text not null,
  amount   bigint not null check (amount > 0),
  due_date date not null,
  unique (group_id, position)
);

-- ---------------------------------------------------------------------
-- 4. Students, enrolments, invitations
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid unique references public.users(id) on delete set null,
  full_name           text not null,
  phone               text not null check (phone ~ '^\+[0-9]{8,15}$'),
  email               text,
  licence_category_id uuid references public.licence_categories(id),
  created_by_admin    boolean not null default false,
  registered_at       timestamptz not null default now(),
  activated_at        timestamptz,
  trial_ends_at       timestamptz
);
create unique index if not exists students_phone_key on public.students (phone);

create table if not exists public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  group_id   uuid not null references public.groups(id),
  status     public.enrollment_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (student_id, group_id)
);

create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists invites_code_hash_idx on public.invites (code_hash);

-- Free trial starts when a user login is linked to the student record.
create or replace function public.set_trial_end() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  if new.user_id is not null and new.trial_ends_at is null then
    select trial_days into v_days from public.app_settings where id = 1;
    new.activated_at  := coalesce(new.activated_at, now());
    new.trial_ends_at := now() + make_interval(days => v_days);
  end if;
  return new;
end $$;

drop trigger if exists trg_students_trial on public.students;
create trigger trg_students_trial
  before insert or update of user_id on public.students
  for each row execute function public.set_trial_end();

-- ---------------------------------------------------------------------
-- 5. Payments (append-only, cancellable) and audit log
-- ---------------------------------------------------------------------
create table if not exists public.receipt_counters (
  year       int primary key,
  last_value int not null default 0
);

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.enrollments(id),
  amount         bigint not null check (amount > 0),
  method         public.payment_method not null default 'cash',
  reference      text,
  receipt_number text not null unique,
  paid_at        timestamptz not null default now(),
  recorded_by    uuid not null default public.current_user_id() references public.users(id),
  client_id      uuid unique,           -- idempotency key for offline sync retries
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.users(id),
  cancel_reason  text,
  check ((cancelled_at is null) = (cancel_reason is null))
);
create index if not exists payments_enrollment_idx on public.payments (enrollment_id);

-- Receipt numbers: LM-2026-000001, 000002, ... with no gaps.
-- An offline device may supply its own (e.g. LM-D1-0007).
create or replace function public.set_receipt_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.receipt_number is null or length(trim(new.receipt_number)) = 0 then
    insert into public.receipt_counters (year, last_value)
    values (extract(year from now())::int, 1)
    on conflict (year) do update set last_value = public.receipt_counters.last_value + 1
    returning last_value into v_n;

    new.receipt_number := (select receipt_prefix from public.app_settings where id = 1)
      || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_n::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_receipt on public.payments;
create trigger trg_payments_receipt
  before insert on public.payments
  for each row execute function public.set_receipt_number();

-- A recorded payment can never be edited or deleted, only cancelled with a reason.
create or replace function public.payments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted. Cancel them instead.';
  end if;
  if new.enrollment_id <> old.enrollment_id or new.amount <> old.amount
     or new.method <> old.method or new.receipt_number <> old.receipt_number
     or new.paid_at <> old.paid_at or new.recorded_by <> old.recorded_by then
    raise exception 'Payments cannot be edited. Cancel it and record a new one.';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'A cancelled payment cannot be restored.';
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_guard on public.payments;
create trigger trg_payments_guard
  before update or delete on public.payments
  for each row execute function public.payments_guard();

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  table_name text not null,
  row_id     uuid,
  details    jsonb
);

create or replace function public.audit_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor, action, table_name, row_id, details)
  values (coalesce(public.current_user_id(), new.recorded_by), tg_op, 'payments', new.id, to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_payments_audit on public.payments;
create trigger trg_payments_audit
  after insert or update on public.payments
  for each row execute function public.audit_payment();

-- ---------------------------------------------------------------------
-- 6. Content: resources (Cloudflare R2 + links) and quizzes
-- ---------------------------------------------------------------------
create table if not exists public.resources (
  id                  uuid primary key default gen_random_uuid(),
  licence_category_id uuid not null references public.licence_categories(id),
  title               text not null,
  description         text,
  type                public.resource_type not null,
  storage_path        text,              -- object key in Cloudflare R2 'la-marseillaise-resources'
  external_url        text,              -- or external link / video
  file_size_kb        int,
  sort_order          int not null default 0,
  is_published        boolean not null default true,
  created_at          timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);
create index if not exists resources_licence_idx on public.resources (licence_category_id);

create table if not exists public.quizzes (
  id                  uuid primary key default gen_random_uuid(),
  licence_category_id uuid not null references public.licence_categories(id),
  title               text not null,
  topic               text,
  duration_minutes    int check (duration_minutes > 0),
  is_mock_exam        boolean not null default false,
  is_published        boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists quizzes_licence_idx on public.quizzes (licence_category_id);

create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  position      int  not null,
  body          text not null,
  options       jsonb not null check (jsonb_typeof(options) = 'array'),
  correct_index int  not null check (correct_index >= 0),
  explanation   text,
  unique (quiz_id, position)
);

create table if not exists public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  quiz_id    uuid not null references public.quizzes(id) on delete cascade,
  score      int  not null,
  total      int  not null check (total > 0),
  taken_at   timestamptz not null default now(),
  client_id  uuid unique,                -- idempotency key for offline sync
  check (score between 0 and total)
);
create index if not exists quiz_attempts_student_idx on public.quiz_attempts (student_id);

-- ---------------------------------------------------------------------
-- 7. Helper functions and THE ACCESS RULE
--    access = trial still running OR at least one valid (non-cancelled) payment
-- ---------------------------------------------------------------------
create or replace function public.current_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.students where user_id = public.current_user_id();
$$;

create or replace function public.current_licence_id() returns uuid
language sql stable security definer set search_path = public as $$
  select licence_category_id from public.students where user_id = public.current_user_id();
$$;

create or replace function public.student_has_paid(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.payments p
    join public.enrollments e on e.id = p.enrollment_id
    where e.student_id = p_student and p.cancelled_at is null
  );
$$;

create or replace function public.student_has_access(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.trial_ends_at > now() from public.students s where s.id = p_student), false)
      or public.student_has_paid(p_student);
$$;

-- ---------------------------------------------------------------------
-- 8. Views: balances, instalment status, and occupied group seats
-- ---------------------------------------------------------------------
create or replace view public.enrollment_balances as
select e.id            as enrollment_id,
       e.student_id,
       e.group_id,
       g.total_fee,
       coalesce(sum(p.amount) filter (where p.cancelled_at is null), 0)::bigint                as paid,
       (g.total_fee - coalesce(sum(p.amount) filter (where p.cancelled_at is null), 0))::bigint as balance
from public.enrollments e
join public.groups g on g.id = e.group_id
left join public.payments p on p.enrollment_id = e.id
group by e.id, g.id;

create or replace view public.installment_status as
with plan as (
  select e.id as enrollment_id, e.student_id, i.id as installment_id,
         i.position, i.label, i.amount, i.due_date,
         sum(i.amount) over (partition by e.id order by i.position)::bigint as cumulative_due
  from public.enrollments e
  join public.installments i on i.group_id = e.group_id
), paid as (
  select enrollment_id, sum(amount)::bigint as paid_total
  from public.payments
  where cancelled_at is null
  group by enrollment_id
)
select pl.*,
       coalesce(pa.paid_total, 0)::bigint as paid_total,
       case
         when coalesce(pa.paid_total, 0) >= pl.cumulative_due           then 'paid'
         when pl.due_date < current_date                                then 'overdue'
         when coalesce(pa.paid_total, 0) > pl.cumulative_due - pl.amount then 'partial'
         else 'upcoming'
       end as status
from plan pl
left join paid pa on pa.enrollment_id = pl.enrollment_id;

-- Rule 6.2: A group seat is only counted once at least 1 valid payment is recorded.
create or replace view public.group_occupancy as
select g.id as group_id,
       g.name,
       g.licence_category_id,
       g.start_date,
       g.capacity,
       g.total_fee,
       g.status,
       count(distinct e.student_id) filter (
         where e.status <> 'cancelled' and public.student_has_paid(e.student_id)
       )::int as confirmed_seats,
       count(distinct e.student_id) filter (
         where e.status <> 'cancelled' and not public.student_has_paid(e.student_id)
       )::int as trial_seats
from public.groups g
left join public.enrollments e on e.group_id = g.id
group by g.id;

-- ---------------------------------------------------------------------
-- 9. Stored Procedures / RPC Functions
-- ---------------------------------------------------------------------
create or replace function public.register_student(
  p_full_name           text,
  p_phone               text,
  p_email               text,
  p_licence_category_id uuid,
  p_group_id            uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_student uuid;
begin
  if public.current_user_id() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from students where user_id = public.current_user_id()) then
    raise exception 'ALREADY_REGISTERED';
  end if;
  if exists (select 1 from students where phone = p_phone) then
    raise exception 'PHONE_EXISTS';
  end if;
  if p_group_id is not null and not exists (
       select 1 from groups
       where id = p_group_id and licence_category_id = p_licence_category_id and status = 'open') then
    raise exception 'INVALID_GROUP';
  end if;

  insert into students (user_id, full_name, phone, email, licence_category_id)
  values (public.current_user_id(), p_full_name, p_phone, p_email, p_licence_category_id)
  returning id into v_student;

  if p_group_id is not null then
    insert into enrollments (student_id, group_id) values (v_student, p_group_id);
  end if;
  return v_student;
end $$;

create or replace function public.create_invite(p_student uuid, p_valid_days int default 7) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  v_code := upper(encode(gen_random_bytes(4), 'hex'));
  insert into invites (student_id, code_hash, expires_at, created_by)
  values (p_student, encode(digest(v_code, 'sha256'), 'hex'),
          now() + make_interval(days => p_valid_days), public.current_user_id());
  return v_code;
end $$;

create or replace function public.claim_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype;
begin
  if public.current_user_id() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from students where user_id = public.current_user_id()) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select * into v_inv from invites
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'INVALID_OR_EXPIRED_CODE'; end if;

  update students set user_id = public.current_user_id()
  where id = v_inv.student_id and user_id is null;
  if not found then raise exception 'ALREADY_CLAIMED'; end if;

  update invites set used_at = now() where id = v_inv.id;
  return v_inv.student_id;
end $$;

create or replace function public.cancel_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
  update payments
     set cancelled_at = now(), cancelled_by = public.current_user_id(), cancel_reason = trim(p_reason)
   where id = p_payment and cancelled_at is null;
  if not found then raise exception 'NOT_FOUND_OR_ALREADY_CANCELLED'; end if;
end $$;

create or replace function public.record_payment(
  p_enrollment_id  uuid,
  p_amount         bigint,
  p_method         public.payment_method default 'cash',
  p_reference      text                  default null,
  p_client_id      uuid                  default null,
  p_paid_at        timestamptz           default now(),
  p_receipt_number text                  default null
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_row     public.payments;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  if p_client_id is not null then
    select * into v_row from payments where client_id = p_client_id;
    if found then return v_row; end if;
  end if;

  select balance into v_balance from enrollment_balances where enrollment_id = p_enrollment_id;
  if v_balance is null then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if p_amount > v_balance then raise exception 'EXCEEDS_BALANCE'; end if;

  insert into payments (enrollment_id, amount, method, reference, client_id, paid_at, receipt_number, recorded_by)
  values (p_enrollment_id, p_amount, p_method, p_reference, p_client_id, p_paid_at, p_receipt_number, public.current_user_id())
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'students_total',        (select count(*) from students),
    'without_app_account',   (select count(*) from students where user_id is null),
    'in_free_trial',         (select count(*) from students s
                               where s.trial_ends_at > now() and not public.student_has_paid(s.id)),
    'trial_ended_unpaid',    (select count(*) from students s
                               where s.trial_ends_at <= now() and not public.student_has_paid(s.id)),
    'collected_this_month',  (select coalesce(sum(amount), 0) from payments
                               where cancelled_at is null and paid_at >= date_trunc('month', now())),
    'collected_total',       (select coalesce(sum(paid), 0)    from enrollment_balances),
    'still_owed',            (select coalesce(sum(balance), 0) from enrollment_balances b
                               join enrollments e on e.id = b.enrollment_id
                               where e.status <> 'cancelled'),
    'students_overdue',      (select count(distinct student_id) from installment_status
                               where status = 'overdue')
  );
end $$;

-- ---------------------------------------------------------------------
-- 10. Starter Seed Data (Auto-école La Marseillaise - Cameroun)
-- ---------------------------------------------------------------------
insert into public.licence_categories (code, name) values
  ('A', 'Permis A (Moto)'),
  ('B', 'Permis B (Voiture légère / Tourisme)'),
  ('C', 'Permis C (Poids lourds / Camion)'),
  ('D', 'Permis D (Transport en commun / Bus)')
on conflict (code) do nothing;

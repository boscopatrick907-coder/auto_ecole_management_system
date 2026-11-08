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
--    enrollment_balances and installment_status use security_invoker = true
--    so RLS on enrollments/payments is strictly enforced for student callers.
-- ---------------------------------------------------------------------
create or replace view public.enrollment_balances
with (security_invoker = true) as
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

create or replace view public.installment_status
with (security_invoker = true) as
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
  if p_licence_category_id is null or not exists (
       select 1 from licence_categories
       where id = p_licence_category_id and is_active = true) then
    raise exception 'INACTIVE_LICENCE_CATEGORY';
  end if;
  if p_group_id is null then
    raise exception 'GROUP_REQUIRED';
  end if;
  if not exists (
       select 1 from groups
       where id = p_group_id and licence_category_id = p_licence_category_id and status = 'open') then
    raise exception 'INVALID_GROUP';
  end if;

  insert into students (user_id, full_name, phone, email, licence_category_id)
  values (public.current_user_id(), p_full_name, p_phone, p_email, p_licence_category_id)
  returning id into v_student;

  insert into enrollments (student_id, group_id) values (v_student, p_group_id);
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
  v_group_id       uuid;
  v_student_id     uuid;
  v_enrol_status   public.enrollment_status;
  v_capacity       int;
  v_confirmed      int;
  v_already_seated boolean;
  v_balance        bigint;
  v_row            public.payments;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  -- Fast pre-lock check for idempotent replay or cross-enrollment clientId conflict
  if p_client_id is not null then
    select * into v_row from payments where client_id = p_client_id;
    if found then
      if v_row.enrollment_id <> p_enrollment_id then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_row;
    end if;
  end if;

  select e.group_id, e.student_id, e.status
    into v_group_id, v_student_id, v_enrol_status
    from enrollments e
   where e.id = p_enrollment_id;

  if v_group_id is null then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if v_enrol_status = 'cancelled' then raise exception 'ENROLLMENT_CANCELLED'; end if;

  -- E02: Serialize seat acquisition in strict parent -> child order (groups -> enrollments)
  select g.capacity into v_capacity
    from groups g
   where g.id = v_group_id
   for update;

  perform 1 from enrollments e where e.id = p_enrollment_id for update;

  -- Re-check idempotency after acquiring locks
  if p_client_id is not null then
    select * into v_row from payments where client_id = p_client_id;
    if found then
      if v_row.enrollment_id <> p_enrollment_id then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_row;
    end if;
  end if;

  -- E02: If this student does not yet hold a confirmed seat, verify group capacity
  v_already_seated := public.student_has_paid(v_student_id);
  if not v_already_seated and v_capacity is not null then
    select go.confirmed_seats into v_confirmed
      from group_occupancy go
     where go.group_id = v_group_id;
    if coalesce(v_confirmed, 0) >= v_capacity then
      raise exception 'GROUP_FULL';
    end if;
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

-- ---------------------------------------------------------------------
-- 11. E01 — Database-Level Isolation, Least Privilege & Row-Level Security
-- ---------------------------------------------------------------------

-- Guard against students modifying sensitive access/trial/identity columns
create or replace function public.students_protect_fields() returns trigger
language plpgsql as $$
begin
  if current_user = 'aem_app_runtime' and not public.is_admin() then
    if new.trial_ends_at is distinct from old.trial_ends_at
       or new.activated_at is distinct from old.activated_at
       or new.user_id is distinct from old.user_id
       or new.licence_category_id is distinct from old.licence_category_id
       or new.created_by_admin is distinct from old.created_by_admin
       or new.phone is distinct from old.phone then
      raise exception 'FORBIDDEN_FIELD_MODIFICATION: Students cannot modify access, trial, or identity fields.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_students_protect_fields on public.students;
create trigger trg_students_protect_fields
  before update on public.students
  for each row execute function public.students_protect_fields();

-- Provision restricted runtime role without superuser or BYPASSRLS
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'aem_app_runtime') then
    create role aem_app_runtime nologin nocreatedb nocreaterole nobypassrls;
  else
    alter role aem_app_runtime nologin nocreatedb nocreaterole nobypassrls;
  end if;
  execute format('grant aem_app_runtime to %I', current_user);
end $$;

grant usage on schema public to aem_app_runtime;

-- Enable Row-Level Security across all application tables
alter table public.users              enable row level security;
alter table public.profiles           enable row level security;
alter table public.sessions           enable row level security;
alter table public.verifications      enable row level security;
alter table public.students           enable row level security;
alter table public.enrollments        enable row level security;
alter table public.invites            enable row level security;
alter table public.payments           enable row level security;
alter table public.quiz_attempts      enable row level security;
alter table public.audit_log          enable row level security;
alter table public.app_settings       enable row level security;
alter table public.licence_categories enable row level security;
alter table public.groups             enable row level security;
alter table public.installments       enable row level security;
alter table public.resources          enable row level security;
alter table public.quizzes            enable row level security;
alter table public.questions          enable row level security;

-- Drop existing policies idempotently before recreating
drop policy if exists users_select_own_or_admin on public.users;
drop policy if exists users_admin_write on public.users;
create policy users_select_own_or_admin on public.users
  for select to aem_app_runtime
  using (id = public.current_user_id() or public.is_admin());
create policy users_admin_write on public.users
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to aem_app_runtime
  using (id = public.current_user_id() or public.is_admin());
create policy profiles_admin_write on public.profiles
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists sessions_own_or_admin on public.sessions;
create policy sessions_own_or_admin on public.sessions
  for all to aem_app_runtime
  using (user_id = public.current_user_id() or public.is_admin())
  with check (user_id = public.current_user_id() or public.is_admin());

drop policy if exists verifications_admin_only on public.verifications;
create policy verifications_admin_only on public.verifications
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists students_select_own_or_admin on public.students;
drop policy if exists students_update_own_or_admin on public.students;
drop policy if exists students_admin_insert_delete on public.students;
create policy students_select_own_or_admin on public.students
  for select to aem_app_runtime
  using (user_id = public.current_user_id() or public.is_admin());
create policy students_update_own_or_admin on public.students
  for update to aem_app_runtime
  using (user_id = public.current_user_id() or public.is_admin())
  with check (user_id = public.current_user_id() or public.is_admin());
create policy students_admin_insert_delete on public.students
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists enrollments_select_own_or_admin on public.enrollments;
drop policy if exists enrollments_admin_write on public.enrollments;
create policy enrollments_select_own_or_admin on public.enrollments
  for select to aem_app_runtime
  using (student_id = public.current_student_id() or public.is_admin());
create policy enrollments_admin_write on public.enrollments
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists invites_admin_only on public.invites;
create policy invites_admin_only on public.invites
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists payments_select_own_or_admin on public.payments;
drop policy if exists payments_admin_write on public.payments;
create policy payments_select_own_or_admin on public.payments
  for select to aem_app_runtime
  using (
    public.is_admin()
    or enrollment_id in (
      select e.id from public.enrollments e where e.student_id = public.current_student_id()
    )
  );
create policy payments_admin_write on public.payments
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists quiz_attempts_select_own_or_admin on public.quiz_attempts;
drop policy if exists quiz_attempts_insert_own_or_admin on public.quiz_attempts;
create policy quiz_attempts_select_own_or_admin on public.quiz_attempts
  for select to aem_app_runtime
  using (student_id = public.current_student_id() or public.is_admin());
create policy quiz_attempts_insert_own_or_admin on public.quiz_attempts
  for insert to aem_app_runtime
  with check (student_id = public.current_student_id() or public.is_admin());

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to aem_app_runtime
  using (public.is_admin());

drop policy if exists app_settings_read_all on public.app_settings;
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_read_all on public.app_settings
  for select to aem_app_runtime using (true);
create policy app_settings_admin_write on public.app_settings
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists licence_categories_read_all on public.licence_categories;
drop policy if exists licence_categories_admin_write on public.licence_categories;
create policy licence_categories_read_all on public.licence_categories
  for select to aem_app_runtime using (true);
create policy licence_categories_admin_write on public.licence_categories
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists groups_read_all on public.groups;
drop policy if exists groups_admin_write on public.groups;
create policy groups_read_all on public.groups
  for select to aem_app_runtime using (true);
create policy groups_admin_write on public.groups
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists installments_read_all on public.installments;
drop policy if exists installments_admin_write on public.installments;
create policy installments_read_all on public.installments
  for select to aem_app_runtime using (true);
create policy installments_admin_write on public.installments
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists resources_read_authorized on public.resources;
drop policy if exists resources_admin_write on public.resources;
create policy resources_read_authorized on public.resources
  for select to aem_app_runtime
  using (
    public.is_admin()
    or (
      is_published = true
      and licence_category_id = public.current_licence_id()
      and public.student_has_access(public.current_student_id())
    )
  );
create policy resources_admin_write on public.resources
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists quizzes_read_authorized on public.quizzes;
drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_read_authorized on public.quizzes
  for select to aem_app_runtime
  using (
    public.is_admin()
    or (
      is_published = true
      and licence_category_id = public.current_licence_id()
      and public.student_has_access(public.current_student_id())
    )
  );
create policy quizzes_admin_write on public.quizzes
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_read_authorized on public.questions;
drop policy if exists questions_admin_write on public.questions;
create policy questions_read_authorized on public.questions
  for select to aem_app_runtime
  using (
    public.is_admin()
    or exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and q.is_published = true
        and q.licence_category_id = public.current_licence_id()
        and public.student_has_access(public.current_student_id())
    )
  );
create policy questions_admin_write on public.questions
  for all to aem_app_runtime using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 12. E12 — Durable Notification Outbox & Scheduled Reminder Deduplication
-- ---------------------------------------------------------------------
create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  dedup_key       text not null unique,
  event_type      text not null,
  recipient_phone text not null,
  message_text    text not null,
  wa_me_link      text not null,
  metadata        jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed_retryable', 'failed_permanent')),
  attempts        int not null default 0,
  last_error      text,
  next_retry_at   timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists notification_outbox_status_retry_idx
  on public.notification_outbox (status, next_retry_at)
  where status in ('pending', 'failed_retryable');

alter table public.notification_outbox enable row level security;
drop policy if exists notification_outbox_admin_all on public.notification_outbox;
create policy notification_outbox_admin_all on public.notification_outbox
  for all to aem_app_runtime
  using (public.is_admin())
  with check (public.is_admin());

-- Explicit table, view & function grants for aem_app_runtime
revoke all on all tables in schema public from aem_app_runtime;
grant select on
  public.app_settings,
  public.users,
  public.profiles,
  public.sessions,
  public.licence_categories,
  public.groups,
  public.installments,
  public.students,
  public.enrollments,
  public.payments,
  public.resources,
  public.quizzes,
  public.questions,
  public.quiz_attempts,
  public.audit_log,
  public.notification_outbox,
  public.enrollment_balances,
  public.installment_status,
  public.group_occupancy
to aem_app_runtime;

grant insert, update on
  public.app_settings,
  public.students,
  public.enrollments,
  public.groups,
  public.installments,
  public.licence_categories,
  public.resources,
  public.quizzes,
  public.questions,
  public.notification_outbox
to aem_app_runtime;

grant insert on public.quiz_attempts to aem_app_runtime;
grant delete on public.sessions to aem_app_runtime;

grant execute on function
  public.current_user_id(),
  public.is_admin(),
  public.current_student_id(),
  public.current_licence_id(),
  public.student_has_paid(uuid),
  public.student_has_access(uuid),
  public.register_student(text, text, text, uuid, uuid),
  public.create_invite(uuid, int),
  public.claim_invite(text),
  public.cancel_payment(uuid, text),
  public.record_payment(uuid, bigint, public.payment_method, text, uuid, timestamptz, text),
  public.admin_dashboard()
to aem_app_runtime;

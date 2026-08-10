-- =========================================================
-- SafeHer — Full database schema (3NF, per ERD)
-- Run this FIRST in the Supabase SQL editor, before
-- module1_auth.sql. Creates every table from the ERD in
-- FK-safe order. auth.users is managed by Supabase Auth —
-- not created here.
-- =========================================================

-- ---------------------------------------------------------
-- Enums
-- ---------------------------------------------------------
do $$ begin
  create type user_role as enum ('survivor', 'municipal_admin', 'provincial_admin', 'super_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender_type as enum ('Male', 'Female', 'Other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_type as enum (
    'Physical Abuse', 'Psychological Abuse', 'Sexual Abuse',
    'Economic Abuse', 'Neglect', 'Others'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority_level as enum ('Low', 'Medium', 'High', 'Critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_status as enum (
    'Pending', 'Under Review', 'Assigned', 'In Progress',
    'Referred', 'Resolved', 'Closed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type referral_status as enum ('Pending', 'Accepted', 'Declined', 'Completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sos_status as enum ('Triggered', 'Responding', 'Resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'Case Update', 'SOS', 'Assignment', 'Referral', 'Announcement'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sender_type as enum ('User', 'AI');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- 1. municipalities
-- ---------------------------------------------------------
create table if not exists public.municipalities (
  municipality_id   uuid primary key default gen_random_uuid(),
  municipality_name varchar(100) not null unique,
  province          varchar(100) not null,
  contact_number    varchar(20),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. user_profiles  (1:1 with auth.users)
-- ---------------------------------------------------------
create table if not exists public.user_profiles (
  profile_id      uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null unique references auth.users(id) on delete cascade,
  municipality_id uuid references public.municipalities(municipality_id),
  role            user_role not null default 'survivor',
  first_name      varchar(100) not null,
  middle_name     varchar(100),
  last_name       varchar(100) not null,
  phone_number    varchar(20),
  profile_picture text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 3. survivors  (1:1 with user_profiles)
-- ---------------------------------------------------------
create table if not exists public.survivors (
  survivor_id               uuid primary key default gen_random_uuid(),
  profile_id                uuid not null unique references public.user_profiles(profile_id) on delete cascade,
  municipality_id            uuid not null references public.municipalities(municipality_id),
  date_of_birth              date,
  gender                     gender_type,
  address                    text,
  emergency_contact_name     varchar(150),
  emergency_contact_number   varchar(20),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 4. shelters
-- ---------------------------------------------------------
create table if not exists public.shelters (
  shelter_id        uuid primary key default gen_random_uuid(),
  municipality_id    uuid not null references public.municipalities(municipality_id),
  shelter_name       varchar(150) not null,
  address            text,
  contact_number     varchar(20),
  capacity           integer,
  current_occupancy  integer not null default 0,
  latitude           decimal(10,8),
  longitude          decimal(11,8),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 5. case_reports
-- ---------------------------------------------------------
create table if not exists public.case_reports (
  case_id           uuid primary key default gen_random_uuid(),
  survivor_id       uuid not null references public.survivors(survivor_id),
  municipality_id   uuid not null references public.municipalities(municipality_id),
  case_number       varchar(30) not null unique,
  case_type         case_type not null,
  description       text,
  incident_date     timestamptz,
  incident_location text,
  priority_level    priority_level not null default 'Medium',
  status            case_status not null default 'Pending',
  is_anonymous      boolean not null default false,
  reported_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6. case_assignments
-- ---------------------------------------------------------
create table if not exists public.case_assignments (
  assignment_id     uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.case_reports(case_id) on delete cascade,
  assigned_by       uuid not null references public.user_profiles(profile_id),
  assigned_to       uuid not null references public.user_profiles(profile_id),
  assignment_notes  text,
  assigned_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 7. case_status_history
-- ---------------------------------------------------------
create table if not exists public.case_status_history (
  history_id       uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.case_reports(case_id) on delete cascade,
  changed_by       uuid not null references public.user_profiles(profile_id),
  previous_status  varchar(50),
  new_status       varchar(50) not null,
  remarks          text,
  changed_at       timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 8. shelter_referrals
-- ---------------------------------------------------------
create table if not exists public.shelter_referrals (
  referral_id      uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.case_reports(case_id) on delete cascade,
  shelter_id       uuid not null references public.shelters(shelter_id),
  referred_by      uuid not null references public.user_profiles(profile_id),
  referral_status  referral_status not null default 'Pending',
  notes            text,
  referred_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 9. evidence
-- ---------------------------------------------------------
create table if not exists public.evidence (
  evidence_id   uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.case_reports(case_id) on delete cascade,
  uploaded_by   uuid not null references public.user_profiles(profile_id),
  file_name     varchar(255) not null,
  storage_path  text not null,
  mime_type     varchar(100),
  file_size     bigint,
  uploaded_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 10. sos_alerts
-- ---------------------------------------------------------
create table if not exists public.sos_alerts (
  sos_id           uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.user_profiles(profile_id),
  latitude         decimal(10,8) not null,
  longitude        decimal(11,8) not null,
  location_address text,
  status           sos_status not null default 'Triggered',
  triggered_at     timestamptz not null default now(),
  resolved_at      timestamptz
);

-- ---------------------------------------------------------
-- 11. notifications
-- ---------------------------------------------------------
create table if not exists public.notifications (
  notification_id    uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.user_profiles(profile_id) on delete cascade,
  case_id            uuid references public.case_reports(case_id),
  sos_id             uuid references public.sos_alerts(sos_id),
  notification_type  notification_type not null,
  title              varchar(150) not null,
  message            text,
  is_read            boolean not null default false,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 12. chat_sessions
-- ---------------------------------------------------------
create table if not exists public.chat_sessions (
  session_id   uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.user_profiles(profile_id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  is_active    boolean not null default true
);

-- ---------------------------------------------------------
-- 13. chat_messages
-- ---------------------------------------------------------
create table if not exists public.chat_messages (
  message_id   uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.chat_sessions(session_id) on delete cascade,
  sender_type  sender_type not null,
  message      text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 14. audit_logs
-- ---------------------------------------------------------
create table if not exists public.audit_logs (
  log_id      uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.user_profiles(profile_id),
  action      varchar(100) not null,
  table_name  varchar(100) not null,
  record_id   uuid,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Helpful indexes on FK columns (not automatic in Postgres)
-- ---------------------------------------------------------
create index if not exists idx_user_profiles_municipality on public.user_profiles(municipality_id);
create index if not exists idx_survivors_profile on public.survivors(profile_id);
create index if not exists idx_case_reports_survivor on public.case_reports(survivor_id);
create index if not exists idx_case_reports_municipality on public.case_reports(municipality_id);
create index if not exists idx_case_assignments_case on public.case_assignments(case_id);
create index if not exists idx_case_status_history_case on public.case_status_history(case_id);
create index if not exists idx_shelter_referrals_case on public.shelter_referrals(case_id);
create index if not exists idx_evidence_case on public.evidence(case_id);
create index if not exists idx_sos_alerts_profile on public.sos_alerts(profile_id);
create index if not exists idx_notifications_profile on public.notifications(profile_id);
create index if not exists idx_chat_messages_session on public.chat_messages(session_id);
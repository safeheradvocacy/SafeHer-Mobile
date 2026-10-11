-- =========================================================
-- SafeSpace — Module 22: Services Provided (case_services)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module21_survivor_demographic_update_rls.sql.
--
-- Two new enum TYPES (not new values on an existing type) + one new
-- table + RLS + one audit trigger. Single-part file — no Part A/B
-- split needed (that rule only applies to adding a VALUE to an
-- EXISTING enum type, referenced later in the same script).
--
-- WHY THIS EXISTS — the WEDC/CNSP/CICL government report templates
-- have a "Services Provided" column group (CS/LS/PPO/TPO/BPO/EA/LA/
-- FA/MA/TA) that has had zero tracking anywhere in this schema until
-- now (confirmed by inspection — no table, no field, documented as a
-- reporting-data limitation in governmentReportMapping.ts). This
-- module adds the minimum real case-management capability needed to
-- honestly populate those columns, as an ADDITIVE feature — it is not
-- a reporting-layer construct; case_services is part of case
-- management, and the reporting layer (governmentReportRows.ts /
-- governmentReportDocument.ts) is updated separately to READ from it.
--
-- NOT the same concept as the three existing referral tables
-- (shelter_referrals / case_referrals / law_enforcement_referrals) —
-- a referral is "sent somewhere for possible help"; a case_services
-- row with status = 'Provided' is "this specific help actually
-- happened." Referral status is never read as a stand-in for service
-- completion anywhere in this file or in the reporting layer.
-- =========================================================

do $$ begin
  create type public.service_type as enum ('CS','LS','PPO','TPO','BPO','EA','LA','FA','MA','TA');
exception when duplicate_object then null; end $$;

-- Matches the real intervention lifecycle (Phase 7B): a service can be
-- requested, referred out, scheduled, in progress, actually provided,
-- or fall off the path (declined/cancelled/unable to provide). ONLY
-- 'Provided' is ever read as "provided" by the reporting layer — every
-- other value renders as blank on a government report, never guessed.
do $$ begin
  create type public.service_status as enum (
    'Requested', 'Referred', 'Scheduled', 'In Progress', 'Provided',
    'Declined', 'Cancelled', 'Unable to Provide'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.case_services (
  service_id       uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.case_reports(case_id) on delete cascade,
  service_type     public.service_type not null,
  status           public.service_status not null default 'Requested',
  provided_at      timestamptz,
  provider_agency  varchar(200),
  notes            text,
  created_by       uuid references public.user_profiles(profile_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_case_services_case on public.case_services(case_id);

-- RLS — mirrors `evidence`'s exact shape (module3_barangay_hierarchy.sql):
-- a survivor can see their own case's services (owns_case), case-owning
-- staff can see and manage them (admin_can_access_case_active). Staff
-- only for writes — a survivor never creates/edits a service record;
-- that is always a staff determination. No DELETE policy — cancelling
-- a service is a status transition ('Cancelled'), the same no-hard-
-- delete convention already used for every other case-adjacent,
-- audit-relevant table in this schema.
alter table public.case_services enable row level security;

drop policy if exists "Case participants can view services" on public.case_services;
create policy "Case participants can view services"
  on public.case_services for select
  using (public.owns_case(case_id) or public.admin_can_access_case_active(case_id));

drop policy if exists "Case staff can create services" on public.case_services;
create policy "Case staff can create services"
  on public.case_services for insert
  with check (public.admin_can_access_case_active(case_id));

drop policy if exists "Case staff can update services" on public.case_services;
create policy "Case staff can update services"
  on public.case_services for update
  using (public.admin_can_access_case_active(case_id))
  with check (public.admin_can_access_case_active(case_id));

grant select, insert on public.case_services to authenticated;
grant update (status, provided_at, provider_agency, notes) on public.case_services to authenticated;

-- Audit — the generic full-row audit trigger, matching the established
-- precedent on this table's closest structural siblings (case_referrals,
-- law_enforcement_referrals both already use this despite having a
-- reason/notes field). This is a different sensitivity class from
-- survivors.date_of_birth (module21's deliberate redaction there was
-- about one specifically-flagged protected attribute, not a blanket
-- rule against logging case-management notes).
drop trigger if exists trg_audit_case_services on public.case_services;
create trigger trg_audit_case_services after insert or update or delete on public.case_services
  for each row execute procedure public.audit_row_change('service_id');


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only unless noted.
-- =========================================================

-- 1. Confirm the enums/table/policies exist:
--   select enumlabel from pg_enum where enumtypid = 'service_type'::regtype order by enumsortorder;
--   select enumlabel from pg_enum where enumtypid = 'service_status'::regtype order by enumsortorder;
--   select policyname, cmd from pg_policies where tablename = 'case_services' order by cmd;
--   select relrowsecurity from pg_class where relname = 'case_services';

-- 2. As a disposable survivor with a known case, confirm they can SELECT
--    their own case's services but an INSERT/UPDATE is denied (0 rows):
--   select * from case_services where case_id = '<their case>'; -- expect their rows (possibly 0)
--   update case_services set status = 'Provided' where case_id = '<their case>'; -- expect 0 rows affected

-- 3. As a disposable municipal_admin in a DIFFERENT municipality from
--    the case's owner, confirm 0 rows on SELECT/INSERT/UPDATE.

-- 4. Confirm the audit trigger fires (expect a case_services row in
--    audit_logs after an insert/update):
--   select * from audit_logs where table_name = 'case_services' order by created_at desc limit 5;

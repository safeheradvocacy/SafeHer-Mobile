-- =========================================================
-- SafeSpace — Module 20: Government reporting data-model additions
-- (WEDC/VAW, CNSP, CICL/CAR)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module19_police_direct_sos_response.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10/11:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- WHAT THIS DOES AND WHY — the admin Reports & Analytics module
-- already exists and is already architecturally correct for government
-- reporting (read-only w.r.t. case records, SOS already kept fully
-- separate from case totals, saved report *definitions* not snapshots,
-- jurisdiction already RLS-enforced). What it couldn't do yet was
-- produce the three official WEDC/CNSP/CICL report FORMATS, because two
-- small, genuinely missing, additive fields stood between the existing
-- case_type taxonomy and the supplied templates:
--
--   1. `case_type` has no 'Stalking' value — both the WEDC and CNSP
--      templates have a dedicated Stalking column; the current 6-value
--      enum doesn't support it at all (not even as "Others").
--   2. case_reports has no way to record WHICH kind of sexual abuse —
--      both templates break "Sexual Abuse" down into Rape/AOL/Incest/
--      AR/Seduction/Others columns; today it's one undifferentiated
--      case_type value.
--
-- Everything else the reporting layer needs (Name/Address/Birthdate/
-- Sex/Age -> WEDC vs CNSP by age, Educational Attainment) is either
-- already a real column (survivors.date_of_birth/gender/
-- formatted_address) or added here as one more small, nullable,
-- additive field. CICL/CAR intentionally gets NO new fields in this
-- file — it is a structurally different case shape (a child as the
-- alleged OFFENDER, not a victim of abuse), which nothing in
-- SafeSpace's case model or mobile intake flow represents; inventing
-- offender/offense/discernment fields with no real intake path to
-- populate them would be exactly the kind of fabrication this project
-- has consistently avoided. The CICL report ships structurally correct
-- and honestly empty — see admin/src/lib/governmentReportMapping.ts.
-- "Services Provided" (CS/LS/PPO/TPO/BPO/LA/FA/MA/TA/EA) is likewise
-- NOT added here — there is no existing service-record concept
-- anywhere in this schema to extend, and building one is a real new
-- case-management capability (a new table + a staff-facing UI to log
-- services against a case), not a reporting-layer concern. Documented
-- as follow-up work, not implemented here.
--
-- Everything below is idempotent and safe to re-run. Both new columns
-- are nullable — no existing case_reports/survivors row is affected,
-- no backfill needed.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type case_type add value if not exists 'Stalking';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Sexual-abuse sub-type — only meaningful when
--    case_reports.case_type = 'Sexual Abuse'; null otherwise. Not
--    enforced by a CHECK constraint tying it to case_type (case_type
--    can't change after the fact in practice, and a hard constraint
--    here would need to account for every other case_type value too —
--    the application layer is the right place to only show/collect
--    this field when case_type is actually 'Sexual Abuse').
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sexual_abuse_subtype') then
    create type public.sexual_abuse_subtype as enum ('Rape', 'AOL', 'Incest', 'AR', 'Seduction', 'Others');
  end if;
end $$;

alter table public.case_reports add column if not exists sexual_abuse_subtype public.sexual_abuse_subtype;

-- ---------------------------------------------------------
-- 2. Educational attainment — CNSP/CICL template column. Plain text,
--    not an enum: no authoritative, exhaustive list of Philippine
--    educational-attainment categories exists anywhere in this
--    codebase to draw a constrained type from (same reasoning already
--    used for law_enforcement_referrals.action_notes — see module9).
-- ---------------------------------------------------------
alter table public.survivors add column if not exists educational_attainment varchar(100);

-- No RLS changes — both new columns live on tables whose existing RLS
-- (case_reports: module10; survivors: module1b) already scopes
-- SELECT/UPDATE correctly at the row level; only the column-scoped
-- UPDATE grants need extending so these two fields are actually
-- settable by the same callers who may already edit their siblings.
grant update (sexual_abuse_subtype) on public.case_reports to authenticated;
grant update (educational_attainment) on public.survivors to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only. Live-tested before trusting, same as every prior module.
-- =========================================================

-- 1. Confirm 'Stalking' is a real case_type label:
--   select enumlabel from pg_enum where enumtypid = 'case_type'::regtype order by enumsortorder;

-- 2. Confirm the new columns exist, nullable:
--   select table_name, column_name, is_nullable from information_schema.columns
--   where table_schema = 'public'
--     and (table_name = 'case_reports' and column_name = 'sexual_abuse_subtype')
--      or (table_name = 'survivors' and column_name = 'educational_attainment');

-- 3. Confirm zero existing rows were altered (both columns null on
--    every pre-existing row):
--   select count(*) from case_reports where sexual_abuse_subtype is not null;
--   select count(*) from survivors where educational_attainment is not null;
--   -- expect 0 for both, immediately after this migration runs.

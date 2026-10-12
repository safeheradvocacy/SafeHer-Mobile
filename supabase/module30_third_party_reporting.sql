-- =========================================================
-- SafeSpace — Module 30: Third-party incident reporting
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module29_evidence_storage_limits.sql.
--
-- WHY — the mobile Report Incident form always assumed the reporting
-- account holder IS the survivor the incident happened to. A survivor
-- reporting on behalf of someone else (a parent reporting for their
-- child, a relative or neighbor reporting for someone who can't report
-- themselves) had no way to say so.
--
-- case_reports.survivor_id stays NOT NULL and keeps pointing at the
-- REPORTING account's own survivors row — the actual third party
-- almost certainly has no SafeSpace account at all, and loosening a
-- core FK to accommodate that would be a much larger, riskier change
-- for no real benefit (the reporting account remains the accountable,
-- contactable party either way). Instead, this adds a small, nullable
-- "who is this actually about" fact pattern alongside the existing
-- survivor_id — the same shape WalkInCaseModal already uses for its
-- own "no account yet" reporter capture (reporterName/reporterContact),
-- adapted for this mobile case.
--
-- All new fields are nullable/optional and never block submission —
-- per the project's existing rule, a reporter is never required to
-- supply information they may not have. Age is collected as a coarse,
-- honest range (never a fabricated exact birthdate) for the same
-- reason incident_date is a coarse timeframe (module28/29 audit).
--
-- Single-part file — brand-new enum, not a new value on an existing
-- one, so no Part A/B split is needed.
--
-- Everything below is idempotent and additive; no existing row is
-- affected (both new columns default to the values that reproduce
-- today's only real behavior — every existing case was, in fact,
-- self-reported).
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_subject') then
    create type public.report_subject as enum ('Self', 'Other');
  end if;
end $$;

alter table public.case_reports add column if not exists reported_for public.report_subject not null default 'Self';
alter table public.case_reports add column if not exists third_party_name varchar(150);
alter table public.case_reports add column if not exists third_party_relationship varchar(100);
-- Coarse, honest bucket — not a computed exact age. Plain text, same
-- reasoning as survivors.educational_attainment (module20): no single
-- authoritative bucket list to draw a constrained enum from, and the
-- mobile form's own options may evolve independently of the database.
alter table public.case_reports add column if not exists third_party_age_range varchar(50);
alter table public.case_reports add column if not exists third_party_contact_number varchar(20);

-- No RLS changes — these columns live on case_reports, whose existing
-- RLS (module2/module3/module10) already scopes SELECT/INSERT/UPDATE
-- correctly at the row level; only the column-scoped grants need
-- extending so a survivor can actually set these on their own INSERT.
grant update (reported_for, third_party_name, third_party_relationship, third_party_age_range, third_party_contact_number)
  on public.case_reports to authenticated;


-- =========================================================
-- VERIFICATION — read-only, after running the above.
-- =========================================================

-- 1. Confirm the new type/columns exist, nullable except reported_for:
--   select column_name, is_nullable, column_default from information_schema.columns
--   where table_name = 'case_reports'
--     and column_name in ('reported_for','third_party_name','third_party_relationship','third_party_age_range','third_party_contact_number');

-- 2. Confirm every existing row defaulted to 'Self' with no third-party
--    data (expect 0 for every count below, immediately after running):
--   select count(*) from case_reports where reported_for <> 'Self';
--   select count(*) from case_reports where third_party_name is not null;

-- 3. Confirm a survivor can set these on their own new case (insert as
--    a survivor test profile, then select it back) — same RLS/grant
--    pattern as every other column added this way in this schema.

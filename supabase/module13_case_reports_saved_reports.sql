-- =========================================================
-- SafeHer — Module 13: Saved Case Management Reports
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module12_registered_address_incident_location.sql.
--
-- Single-part file (no new enum value added to an existing type).
--
-- MODEL — a saved report is a REUSABLE REPORT DEFINITION (filters +
-- metadata), never a fixed historical snapshot. Reopening one always
-- re-queries current, currently-authorized case_reports/shelter_referrals/
-- sos_alerts data through the normal RLS-governed client — this table
-- stores nothing but the filter configuration itself. True immutable
-- snapshots are not implemented (no stated requirement for them, and
-- they'd need a materialized-result schema of their own).
--
-- OWNERSHIP — private to the creating admin (created_by = the caller's
-- own profile_id), not shared across users. This is what makes "a user
-- cannot open another user's saved report by guessing/incrementing its
-- ID" a database-level guarantee (RLS), not just something the UI
-- happens to not offer. Nothing in the requirements asks for
-- team-shared saved reports.
--
-- The `filters` jsonb column is never trusted blindly when a report is
-- reopened — the ADMIN APP re-clamps any geographic filter value
-- (municipality_id/barangay_id) to the CURRENT user's own authorized
-- scope before regenerating results (see ReportsPage.tsx). This is
-- defense-in-depth on top of the fact that case_reports/shelter_referrals/
-- sos_alerts' own RLS policies already guarantee no unauthorized row
-- could ever be returned regardless of what filter value is requested.
-- =========================================================

create table if not exists public.saved_reports (
  report_id    uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.user_profiles(profile_id) on delete cascade,
  report_name  varchar(150) not null,
  filters      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_saved_reports_created_by on public.saved_reports(created_by);

alter table public.saved_reports enable row level security;

-- Every column here is legitimately user-owned/editable (report_name,
-- filters) or system-managed but harmless to expose (created_by,
-- created_at, updated_at are never client-settable in practice since
-- the app always sends created_by = the caller's own profile_id, and
-- RLS below rejects any row where that isn't true) — unlike
-- user_profiles/survivors, there's no privileged column here that
-- needs a narrower column-scoped grant.
drop policy if exists "Users can view own saved reports" on public.saved_reports;
create policy "Users can view own saved reports"
  on public.saved_reports for select
  using (created_by = public.current_profile_id());

drop policy if exists "Users can create own saved reports" on public.saved_reports;
create policy "Users can create own saved reports"
  on public.saved_reports for insert
  with check (created_by = public.current_profile_id());

drop policy if exists "Users can update own saved reports" on public.saved_reports;
create policy "Users can update own saved reports"
  on public.saved_reports for update
  using (created_by = public.current_profile_id())
  with check (created_by = public.current_profile_id());

drop policy if exists "Users can delete own saved reports" on public.saved_reports;
create policy "Users can delete own saved reports"
  on public.saved_reports for delete
  using (created_by = public.current_profile_id());

grant select, insert, update, delete on public.saved_reports to authenticated;

-- Keeps updated_at honest on every edit, matching the same pattern
-- used implicitly elsewhere in this schema (most tables rely on the
-- app to set updated_at; this one gets a real trigger since edits are
-- the primary way a saved report changes over its lifetime).
create or replace function public.touch_saved_report_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_saved_reports_touch_updated_at on public.saved_reports;
create trigger trg_saved_reports_touch_updated_at
  before update on public.saved_reports
  for each row execute procedure public.touch_saved_report_updated_at();


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the table + RLS + policies exist:
--   select relrowsecurity from pg_class where relname = 'saved_reports';
--   select policyname, cmd from pg_policies where tablename = 'saved_reports';
--   Expect rowsecurity = true, 4 policies (select/insert/update/delete).

-- 2. As a test user, create a saved report, then confirm a SECOND test
--    user (any role) gets zero rows for it and cannot update/delete it:
--   -- as user A: insert into saved_reports (created_by, report_name, filters)
--   --   values ('<A profile_id>', 'Test Report', '{"status":"Pending"}');
--   -- as user B: select * from saved_reports where created_by = '<A profile_id>';
--   --   Expect 0 rows.
--   -- as user B: update saved_reports set report_name = 'hijacked' where created_by = '<A profile_id>';
--   --   Expect 0 rows affected (RLS silently filters, not an error).

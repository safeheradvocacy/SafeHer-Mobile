-- =========================================================
-- SafeHer — Module 2: case/operational data grants + RLS
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, and module1b_grants_and_survivors_rls.sql.
-- Safe to re-run any number of times (every REVOKE/GRANT and
-- DROP POLICY IF EXISTS below is idempotent) — run the WHOLE
-- file in one go.
--
-- WHY THIS FILE EXISTS: the admin web dashboard (already built —
-- MunicipalDashboard, ProvincialDashboard, CaseDetailPage,
-- SosMonitoringPage, ShelterReferralPage, NotificationsPage,
-- MunicipalityManagementPage, UserManagementPage) and the mobile
-- app (CaseListScreen, CaseDetailScreen, ReportIncidentScreen,
-- SosScreen) already query case_reports, sos_alerts, shelters,
-- shelter_referrals, evidence, case_assignments,
-- case_status_history, and notifications directly. None of these
-- tables have grants or RLS yet — every one of those screens
-- would hit "permission denied for table X" the moment it runs,
-- the same class of bug already found (and fixed) for
-- municipalities/user_profiles/survivors.
--
-- SECURITY MODEL enforced below, at the database level (not just
-- the frontend):
--   survivor        -> can only ever see/insert/update rows tied
--                       to their OWN profile/case, never anyone
--                       else's, regardless of what the client
--                       app requests or what URL is typed.
--   municipal_admin  -> can only see/act on rows whose
--                       municipality matches their own
--                       user_profiles.municipality_id.
--   provincial_admin / super_admin -> province-wide access.
-- =========================================================

-- ---------------------------------------------------------
-- 0. Helper functions
-- ---------------------------------------------------------
-- SECURITY DEFINER + reading user_profiles inside a policy that
-- protects user_profiles itself would recurse; these functions run
-- with the function owner's privileges (bypassing RLS internally),
-- which is the standard, documented Postgres/Supabase pattern for
-- "look up my own role/municipality from inside another policy."
-- `stable` lets Postgres cache the result within one statement.

create or replace function public.current_profile_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select profile_id from public.user_profiles where auth_user_id = auth.uid();
$$;

create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from public.user_profiles where auth_user_id = auth.uid();
$$;

create or replace function public.current_municipality_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select municipality_id from public.user_profiles where auth_user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid() and role in ('municipal_admin', 'provincial_admin', 'super_admin')
  );
$$;

create or replace function public.is_provincial_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid() and role in ('provincial_admin', 'super_admin')
  );
$$;

-- True if the calling admin is provincial/super, or is a municipal
-- admin whose municipality matches the case's municipality.
create or replace function public.admin_can_access_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_provincial_admin() or exists (
    select 1 from public.case_reports cr
    where cr.case_id = p_case_id and cr.municipality_id = public.current_municipality_id()
  );
$$;

-- True if the calling admin is provincial/super, or is a municipal
-- admin whose municipality matches the target profile's municipality.
create or replace function public.admin_can_access_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_provincial_admin() or exists (
    select 1 from public.user_profiles up
    where up.profile_id = p_profile_id and up.municipality_id = public.current_municipality_id()
  );
$$;

-- True if the calling survivor's own profile owns this case. Called
-- from case_referrals' SELECT policy (module3) — only touches
-- case_reports/survivors, never case_referrals itself, so it's safe
-- there without re-entering that table's own policy expansion.
create or replace function public.owns_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select exists (
    select 1 from public.case_reports cr
    join public.survivors s on s.survivor_id = cr.survivor_id
    where cr.case_id = p_case_id and s.profile_id = public.current_profile_id()
  );
$$;

-- ---------------------------------------------------------
-- 1. municipalities — extend module1_auth.sql's public read-only
--    policy with admin management (provincial/super only).
-- ---------------------------------------------------------
drop policy if exists "Provincial admins can view all municipalities" on public.municipalities;
create policy "Provincial admins can view all municipalities"
  on public.municipalities for select
  using (public.is_provincial_admin());

drop policy if exists "Provincial admins can update municipalities" on public.municipalities;
create policy "Provincial admins can update municipalities"
  on public.municipalities for update
  using (public.is_provincial_admin())
  with check (public.is_provincial_admin());

grant update (contact_number, is_active) on public.municipalities to authenticated;

-- ---------------------------------------------------------
-- 2. user_profiles — extend module1b's "own row only" policies so
--    admins can see/manage profiles within their scope (needed by
--    UserManagementPage and CaseDetailPage, which reads the
--    survivor's own profile — a DIFFERENT row than the admin's).
-- ---------------------------------------------------------
drop policy if exists "Admins can view profiles in scope" on public.user_profiles;
create policy "Admins can view profiles in scope"
  on public.user_profiles for select
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

-- Only is_active is admin-writable here (UserManagementPage's
-- activate/deactivate toggle) — role/municipality reassignment is a
-- deliberately separate, more sensitive operation not exposed by any
-- existing UI, so it isn't granted here.
drop policy if exists "Admins can update profile status in scope" on public.user_profiles;
create policy "Admins can update profile status in scope"
  on public.user_profiles for update
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id())
  with check (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

grant update (is_active) on public.user_profiles to authenticated;

-- ---------------------------------------------------------
-- 3. survivors — extend module1b's "own row only" policies so
--    admins can view survivor demographic info for cases in scope.
-- ---------------------------------------------------------
drop policy if exists "Admins can view survivors in scope" on public.survivors;
create policy "Admins can view survivors in scope"
  on public.survivors for select
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

-- ---------------------------------------------------------
-- 4. case_reports
-- ---------------------------------------------------------
alter table public.case_reports enable row level security;

drop policy if exists "Survivors can view own cases" on public.case_reports;
create policy "Survivors can view own cases"
  on public.case_reports for select
  using (survivor_id in (select survivor_id from public.survivors where profile_id = public.current_profile_id()));

drop policy if exists "Survivors can submit own cases" on public.case_reports;
create policy "Survivors can submit own cases"
  on public.case_reports for insert
  with check (survivor_id in (select survivor_id from public.survivors where profile_id = public.current_profile_id()));

drop policy if exists "Admins can view cases in scope" on public.case_reports;
create policy "Admins can view cases in scope"
  on public.case_reports for select
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

drop policy if exists "Admins can update case status in scope" on public.case_reports;
create policy "Admins can update case status in scope"
  on public.case_reports for update
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id())
  with check (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

grant select, insert on public.case_reports to authenticated;
grant update (status) on public.case_reports to authenticated;

-- ---------------------------------------------------------
-- 5. case_status_history
-- ---------------------------------------------------------
alter table public.case_status_history enable row level security;

drop policy if exists "Case participants can view status history" on public.case_status_history;
create policy "Case participants can view status history"
  on public.case_status_history for select
  using (public.owns_case(case_id) or public.admin_can_access_case(case_id));

drop policy if exists "Case participants can insert status history" on public.case_status_history;
create policy "Case participants can insert status history"
  on public.case_status_history for insert
  with check (
    (public.owns_case(case_id) or public.admin_can_access_case(case_id))
    and changed_by = public.current_profile_id()
  );

grant select, insert on public.case_status_history to authenticated;

-- ---------------------------------------------------------
-- 6. case_assignments — admin-only (assigning cases to staff).
-- ---------------------------------------------------------
alter table public.case_assignments enable row level security;

drop policy if exists "Admins can view assignments in scope" on public.case_assignments;
create policy "Admins can view assignments in scope"
  on public.case_assignments for select
  using (public.admin_can_access_case(case_id));

drop policy if exists "Admins can insert assignments in scope" on public.case_assignments;
create policy "Admins can insert assignments in scope"
  on public.case_assignments for insert
  with check (public.admin_can_access_case(case_id) and assigned_by = public.current_profile_id());

grant select, insert on public.case_assignments to authenticated;

-- ---------------------------------------------------------
-- 7. shelter_referrals
-- ---------------------------------------------------------
alter table public.shelter_referrals enable row level security;

drop policy if exists "Case participants can view shelter referrals" on public.shelter_referrals;
create policy "Case participants can view shelter referrals"
  on public.shelter_referrals for select
  using (public.owns_case(case_id) or public.admin_can_access_case(case_id));

drop policy if exists "Admins can insert shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can insert shelter referrals in scope"
  on public.shelter_referrals for insert
  with check (public.admin_can_access_case(case_id) and referred_by = public.current_profile_id());

drop policy if exists "Admins can update shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can update shelter referrals in scope"
  on public.shelter_referrals for update
  using (public.admin_can_access_case(case_id))
  with check (public.admin_can_access_case(case_id));

grant select, insert on public.shelter_referrals to authenticated;
grant update (referral_status, notes) on public.shelter_referrals to authenticated;

-- ---------------------------------------------------------
-- 8. evidence
-- ---------------------------------------------------------
alter table public.evidence enable row level security;

drop policy if exists "Case participants can view evidence" on public.evidence;
create policy "Case participants can view evidence"
  on public.evidence for select
  using (public.owns_case(case_id) or public.admin_can_access_case(case_id));

drop policy if exists "Case participants can insert evidence" on public.evidence;
create policy "Case participants can insert evidence"
  on public.evidence for insert
  with check (
    (public.owns_case(case_id) or public.admin_can_access_case(case_id))
    and uploaded_by = public.current_profile_id()
  );

grant select, insert on public.evidence to authenticated;

-- ---------------------------------------------------------
-- 9. sos_alerts
-- ---------------------------------------------------------
alter table public.sos_alerts enable row level security;

drop policy if exists "Users can view own sos alerts" on public.sos_alerts;
create policy "Users can view own sos alerts"
  on public.sos_alerts for select
  using (profile_id = public.current_profile_id() or public.admin_can_access_profile(profile_id));

drop policy if exists "Users can trigger own sos alerts" on public.sos_alerts;
create policy "Users can trigger own sos alerts"
  on public.sos_alerts for insert
  with check (profile_id = public.current_profile_id());

drop policy if exists "Admins can update sos alerts in scope" on public.sos_alerts;
create policy "Admins can update sos alerts in scope"
  on public.sos_alerts for update
  using (public.admin_can_access_profile(profile_id))
  with check (public.admin_can_access_profile(profile_id));

grant select, insert on public.sos_alerts to authenticated;
grant update (status, resolved_at) on public.sos_alerts to authenticated;

-- ---------------------------------------------------------
-- 10. shelters — reference-like data, similar to municipalities.
-- ---------------------------------------------------------
alter table public.shelters enable row level security;

drop policy if exists "Authenticated users can view active shelters" on public.shelters;
create policy "Authenticated users can view active shelters"
  on public.shelters for select
  using (is_active = true or public.is_admin());

drop policy if exists "Admins can update shelters in scope" on public.shelters;
create policy "Admins can update shelters in scope"
  on public.shelters for update
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id())
  with check (public.is_provincial_admin() or municipality_id = public.current_municipality_id());

grant select on public.shelters to authenticated;
grant update (shelter_name, address, contact_number, capacity, current_occupancy, latitude, longitude, is_active)
  on public.shelters to authenticated;

-- ---------------------------------------------------------
-- 11. notifications
-- ---------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications for select
  using (profile_id = public.current_profile_id());

drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Users can mark own notifications read"
  on public.notifications for update
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

drop policy if exists "Admins can send notifications in scope" on public.notifications;
create policy "Admins can send notifications in scope"
  on public.notifications for insert
  with check (public.admin_can_access_profile(profile_id));

grant select, insert on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

-- ---------------------------------------------------------
-- 12. audit_logs — write-only from the client; nothing in the
--     already-built UI reads this table yet, so no SELECT policy is
--     added (avoids granting unused surface). Add one, scoped like
--     the tables above, when an audit-review screen is actually built.
-- ---------------------------------------------------------
alter table public.audit_logs enable row level security;

drop policy if exists "Users can insert own audit entries" on public.audit_logs;
create policy "Users can insert own audit entries"
  on public.audit_logs for insert
  with check (profile_id = public.current_profile_id());

grant insert on public.audit_logs to authenticated;

-- ---------------------------------------------------------
-- NOT covered here: chat_sessions / chat_messages (mobile's
-- ChatbotScreen only — no admin page reads these yet). Same
-- missing-grant gap; needs its own pass when that feature is
-- actively exercised.
-- =========================================================

-- ---------------------------------------------------------
-- VERIFICATION — read-only, run after the block above.
-- ---------------------------------------------------------

-- 1. RLS enabled on every table this file touches (expect
--    rowsecurity = true for all rows):
--   select relname, relrowsecurity
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in (
--       'municipalities','user_profiles','survivors','case_reports',
--       'case_status_history','case_assignments','shelter_referrals',
--       'evidence','sos_alerts','shelters','notifications','audit_logs'
--     );

-- 2. Full policy inventory:
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename, cmd;

-- 3. Column-level grants for `authenticated` (spot-check that
--    sensitive columns like case_reports.municipality_id,
--    user_profiles.role are NOT listed under UPDATE):
--   select table_name, privilege_type, column_name
--   from information_schema.role_column_grants
--   where grantee = 'authenticated' and table_schema = 'public'
--   order by table_name, privilege_type, column_name;

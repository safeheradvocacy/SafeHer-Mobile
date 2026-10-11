-- =========================================================
-- SafeSpace — Module 27: Police Officer access to Services Provided
-- (case_services), for a case referred to them
--
-- Run in the Supabase SQL editor AFTER module22_case_services.sql and
-- module9_law_enforcement.sql (uses is_case_referred_to_officer() from
-- the latter). Single-part file — three widened RLS policies only. No
-- new table, no new enum, no schema change. Safe to re-run (drop
-- policy if exists + create, same as every other policy file here).
--
-- WHY THIS EXISTS — audited before writing anything (per the brief's
-- explicit "do not assume frontend visibility means backend access,
-- verify both" instruction): case_services' three policies (module22)
-- only ever check owns_case() or admin_can_access_case_active() —
-- neither covers law_enforcement. module9 already extended
-- case_reports/case_status_history/sos_alerts for an assigned officer,
-- but case_services didn't exist yet when module9 was written, so it
-- was simply never added there. Confirmed live: a law_enforcement
-- account currently gets 0 rows from case_services even for a case
-- openly assigned to them via law_enforcement_referrals — a real,
-- pre-existing gap, not something this feature is "turning off."
--
-- ACCESS GRANTED —
--   SELECT: every case_services row for a case currently referred to
--     this officer (is_case_referred_to_officer, module9's existing
--     narrow row-security-off helper — same technique already used to
--     extend case_reports/case_status_history/sos_alerts, zero new
--     recursion risk since case_services' own policies never queried
--     law_enforcement_referrals before and still don't).
--   INSERT: the officer may add a NEW service record to a case
--     referred to them (e.g. a police-coordinated intervention) —
--     reuses the exact existing case_services columns/enums, no new
--     service_type value added (see CaseReferralsPage.tsx's Add
--     Service form, which reuses serviceTypes.ts unchanged).
--   UPDATE: restricted to rows the officer THEMSELVES created
--     (created_by = current_profile_id()) on a case still referred to
--     them. This is the deliberate, minimal answer to the brief's "do
--     not automatically grant unrestricted write access to every
--     service record": an officer can fully manage what they add, but
--     can never edit an MSWDO-recorded service — mirrors the
--     shelter_staff "may only touch a row already assigned to them"
--     precedent (module7) rather than inventing a new permission
--     shape. MSWDO/municipal_admin's own existing
--     admin_can_access_case_active() branch is completely untouched,
--     so every pre-existing MSWDO service stays exactly as editable
--     by MSWDO as it always was.
--
-- NOT CHANGED — the column-level UPDATE grant from module22/25
-- (status, provided_at, provider_agency, notes, scheduled_date,
-- follow_up_date, reason_not_provided) already applies to
-- `authenticated` as a whole; case_id/service_type/created_by/
-- service_id remain ungrantable for UPDATE for every role, officer
-- included — an officer can never move a service to a different case
-- or rewrite who created it.
-- =========================================================

drop policy if exists "Case participants can view services" on public.case_services;
create policy "Case participants can view services"
  on public.case_services for select
  using (
    public.owns_case(case_id)
    or public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id))
  );

drop policy if exists "Case staff can create services" on public.case_services;
create policy "Case staff can create services"
  on public.case_services for insert
  with check (
    public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id))
  );

drop policy if exists "Case staff can update services" on public.case_services;
create policy "Case staff can update services"
  on public.case_services for update
  using (
    public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id) and created_by = public.current_profile_id())
  )
  with check (
    public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id) and created_by = public.current_profile_id())
  );


-- =========================================================
-- VERIFICATION — run separately, after the above. All read-only
-- unless noted.
-- =========================================================

-- 1. Confirm the policies updated:
--   select policyname, cmd from pg_policies where tablename = 'case_services' order by cmd;

-- 2. As the assigned officer on a referred case, confirm visibility
--    into services recorded BEFORE the referral existed:
--   select * from case_services where case_id = '<a referred case with pre-existing MSWDO services>';
--   Expect the MSWDO's existing rows, original status/dates unchanged.

-- 3. As an officer NOT assigned to that case (or with no referral at
--    all), confirm 0 rows for the same query — unauthorized-case
--    isolation unchanged.

-- 4. As the assigned officer, insert a new service, then attempt to
--    update an MSWDO-created row's status:
--   update case_services set status = 'Provided' where case_id = '<referred case>' and created_by <> '<officer profile_id>';
--   Expect 0 rows affected (RLS silently filters it out, not an error).

-- 5. As the assigned officer, update the status of the row they just
--    created in #4 — expect 1 row affected, confirming they can
--    manage their own record while MSWDO's stays untouched.

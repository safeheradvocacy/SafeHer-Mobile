-- =========================================================
-- SafeSpace — Module 26: Automatic officer assignment for the
-- existing "Refer to police officer" workflow
--
-- Run in the Supabase SQL editor AFTER module9_law_enforcement.sql.
-- Single-part file — one new function + one grant. No new table, no
-- new enum, no RLS policy change. Safe to re-run (create or replace).
--
-- WHY A NEW FUNCTION, NOT A CLIENT-SIDE COUNT — the obvious approach
-- (have the referring admin's browser count each officer's open
-- law_enforcement_referrals and pick the lightest) does not work
-- under this schema's existing RLS: "Case participants can view
-- law-enforcement referrals" (module9) only lets an admin see referral
-- rows for CASES THEY CAN ACCESS, never every officer's referrals
-- system-wide. An officer receives referrals from many different
-- admins across different cases/jurisdictions, so any one admin's
-- client-side count would silently undercount real officer workload —
-- not a "reliable" metric per the brief's own standard. This mirrors
-- the exact problem module9 already solved for case/SOS visibility
-- (is_case_referred_to_officer / is_sos_referred_to_officer): a
-- narrow, single-purpose `set row_security = off` function that
-- returns the one fact actually needed (which officer should get
-- this referral) without ever exposing the underlying referral rows
-- to the caller.
--
-- THE RULE — among active law_enforcement accounts, pick the one with
-- the fewest currently-OPEN referrals (status Pending or Accepted —
-- Declined/Completed referrals are finished work, not current load,
-- so they don't count against an officer). Ties broken deterministically
-- (first_name, then profile_id) so the result is reproducible, not
-- effectively random. Returns NULL when no active law_enforcement
-- account exists at all — the caller (CaseDetailPage.tsx) must treat
-- that as "create the referral unassigned," never as a failure to
-- silently swallow or a success to falsely report.
--
-- SECURITY — returns only a single profile_id (uuid), nothing else;
-- this is the same narrow-fact principle module9's two existing
-- row-security-off helpers already use. EXECUTE is granted broadly to
-- `authenticated` because the result (which officer is least loaded)
-- reveals nothing sensitive on its own — it carries no case, survivor,
-- or referral content, and the actual referral INSERT this feeds into
-- is still fully gated by law_enforcement_referrals' own existing RLS
-- (admin_can_access_case_active) and the validate_user_profile
-- /assigned_officer_id-must-be-law_enforcement trigger check, both
-- unchanged by this file.
-- =========================================================

create or replace function public.least_loaded_law_enforcement_officer()
returns uuid
language sql stable security definer set search_path = public set row_security = off
as $$
  select up.profile_id
  from public.user_profiles up
  left join (
    select assigned_officer_id, count(*) as open_count
    from public.law_enforcement_referrals
    where assigned_officer_id is not null and status in ('Pending', 'Accepted')
    group by assigned_officer_id
  ) load on load.assigned_officer_id = up.profile_id
  where up.role = 'law_enforcement' and up.is_active = true
  order by coalesce(load.open_count, 0) asc, up.first_name asc, up.profile_id asc
  limit 1;
$$;

grant execute on function public.least_loaded_law_enforcement_officer() to authenticated;


-- =========================================================
-- VERIFICATION — run separately, after the above. All read-only
-- except where noted.
-- =========================================================

-- 1. Confirm the function exists and is callable:
--   select public.least_loaded_law_enforcement_officer();
--   Expect a profile_id (or null if no active law_enforcement account
--   exists yet — confirm which, then compare against #2 below).

-- 2. Sanity-check the rule against real data:
--   select up.profile_id, up.first_name, up.last_name,
--          (select count(*) from public.law_enforcement_referrals lr
--           where lr.assigned_officer_id = up.profile_id and lr.status in ('Pending','Accepted')) as open_referrals
--   from public.user_profiles up
--   where up.role = 'law_enforcement' and up.is_active = true
--   order by open_referrals asc, up.first_name asc;
--   Expect the function's result (#1) to match the FIRST row here.

-- 3. No-eligible-officer case — as a disposable test, temporarily set
--    every law_enforcement account's is_active to false, re-run #1,
--    expect null, then restore is_active as it was. (Read-only
--    verification stops at #1/#2 above; only do this step in a
--    non-production/test project.)

-- 4. Confirm this introduced no new access to referral CONTENT — as a
--    municipal_admin for Municipality A, with an open referral that
--    belongs to Municipality B's case, confirm the existing restriction
--    is unchanged:
--   select * from law_enforcement_referrals where case_id = '<Municipality B case>';
--   Expect 0 rows (unchanged from before this file — this migration
--   does not touch that policy).

-- =========================================================
-- SafeHer — Module 11: Provincial Admin / Provincial Staff RBAC split
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module10_identity_verification.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- MODEL — 'provincial_admin' used to be a single role covering both
-- province-wide OPERATIONS (cases, SOS, shelters, verification,
-- municipality/barangay management, expert support, FAQs, reports) and
-- top-of-hierarchy authority. This module splits that into two real,
-- distinct roles:
--   * 'provincial_staff'  — province-wide OPERATIONAL work. Gets the
--     exact same operational database access 'provincial_admin' has
--     today (see is_provincial_admin() below) — the actual "which
--     modules does each role's UI expose" split is enforced entirely
--     at the admin app's route-guard + navigation layer, not here.
--   * 'provincial_admin'  — redefined as TECHNICAL/SYSTEM
--     administration (administrator accounts, audit trail, permission
--     model). Its underlying database access is DELIBERATELY left
--     unchanged/unstripped (see is_provincial_admin() below) — a full
--     rewrite would touch dozens of policies across 9 prior modules
--     and risk breaking assumptions this pass can't fully re-verify.
--     The route/nav layer is what actually keeps it out of day-to-day
--     case work.
-- 'super_admin' continues to be treated as 100% identical to
-- 'provincial_admin' everywhere (see module2_case_data_rls.sql and
-- every subsequent module) — this file preserves that.
--
-- RLS SAFETY — is_provincial_technical_admin() below is a single-hop
-- helper (only ever queries user_profiles for the CALLER's own role,
-- exactly like is_provincial_admin() itself), so per this project's
-- established rule it needs no `row_security = off` and is safe to
-- call directly from any other table's policy.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'provincial_staff';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

-- ---------------------------------------------------------
-- 1. is_provincial_admin() — the single choke-point function for
--    "province-wide operational access" used (directly or
--    transitively, via admin_can_access_case[_active]/
--    admin_can_access_profile/admin_can_review_verification/
--    can_refer_case) across nearly every RLS policy in this schema.
--    Extending it to include 'provincial_staff' is the one surgical
--    change that grants Provincial Staff identical operational reach
--    to Provincial Admin everywhere, with zero risk of missing a call
--    site — the exact same pattern originally used to fold
--    'super_admin' into this function.
-- ---------------------------------------------------------
create or replace function public.is_provincial_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('provincial_admin', 'super_admin', 'provincial_staff')
  );
$$;

-- ---------------------------------------------------------
-- 2. is_provincial_technical_admin() — new, NARROWER function for the
--    technical-only surfaces this module introduces (audit log
--    read access today; any future technical-only RLS). Deliberately
--    excludes 'provincial_staff'.
-- ---------------------------------------------------------
create or replace function public.is_provincial_technical_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('provincial_admin', 'super_admin')
  );
$$;

-- ---------------------------------------------------------
-- 3. audit_logs — first-ever SELECT policy. Until now nothing could
--    read this table via RLS/PostgREST at all (see
--    module2_case_data_rls.sql — INSERT-only, by design, since no UI
--    read it yet). The new province-wide Audit Log page needs real
--    read access; scoped to the technical tier only, not
--    'provincial_staff', 'municipal_admin', or any other role.
-- ---------------------------------------------------------
drop policy if exists "Provincial technical admins can view audit logs" on public.audit_logs;
create policy "Provincial technical admins can view audit logs"
  on public.audit_logs for select
  using (public.is_provincial_technical_admin());

-- module2_case_data_rls.sql only ever granted INSERT on this table
-- (nothing read it yet at the time) — without this, PostgREST rejects
-- every SELECT with 42501 "permission denied for table audit_logs"
-- before RLS is even evaluated, regardless of the policy above.
grant select on public.audit_logs to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm 'provincial_staff' is a real user_role label:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;

-- 2. Confirm a provincial_staff test profile has the same operational
--    RLS reach a provincial_admin profile has (run as each, compare):
--   select count(*) from case_reports;
--   select count(*) from sos_alerts;
--   select count(*) from shelters;
--   select count(*) from user_verifications;
--   Expect identical (non-zero, unfiltered) results for both roles.

-- 3. Confirm audit_logs SELECT is now real, and correctly scoped:
--   -- as a provincial_admin test profile:
--   select count(*) from audit_logs;              -- expect > 0 (no RLS-empty result)
--   -- as a provincial_staff test profile:
--   select count(*) from audit_logs;               -- expect 0 rows (denied by RLS)
--   -- as a municipal_admin test profile:
--   select count(*) from audit_logs;               -- expect 0 rows (denied by RLS)

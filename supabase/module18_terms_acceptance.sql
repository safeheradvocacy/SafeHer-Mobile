-- =========================================================
-- SafeHer — Module 18: Terms & Conditions acceptance
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module17_law_enforcement_referral_fix.sql.
--
-- Single-part file — no enum changes, no changes to any existing
-- table/policy/trigger. Mobile-only feature for this pass; the admin
-- app is untouched.
--
-- WHAT THIS IS — a minimal, versioned, append-only record of "this
-- authenticated user explicitly agreed to Terms & Conditions version X
-- at time Y." A local checkbox in the registration UI is NOT sufficient
-- evidence of consent by itself (it proves nothing once the app is
-- closed) — this table is the actual server-side record. The Terms
-- CONTENT itself is not stored here (nor duplicated per acceptance) —
-- it lives as a versioned static resource in the mobile app
-- (mobile/src/lib/terms.ts), matching this prototype's existing
-- precedent of static/bundled content over a DB-managed document store
-- where nothing yet requires one (no admin CMS demand exists for this,
-- unlike e.g. FAQs).
--
-- WHY A NEW TABLE, NOT A REUSED ONE — no existing table represents
-- "a user consented to something" anywhere in this schema (audit_logs
-- records ADMIN actions on records, not a user's own consent; nothing
-- else is even adjacent). A new, small, append-only table is the
-- smallest correct structure, mirroring the immutable-history
-- convention already used by law_enforcement_referrals/case_referrals
-- (no update policy, no delete policy).
--
-- WHY user_id -> user_profiles.profile_id, not auth.users.id directly —
-- every other table in this schema keys user-owned rows off
-- user_profiles.profile_id (notifications.profile_id,
-- law_enforcement_referrals.referred_by, etc.), never auth.users.id
-- directly. Matching that convention here means this table can reuse
-- the existing, already-audited current_profile_id() helper
-- (module2_case_data_rls.sql) for both the column default and the RLS
-- policies below, instead of introducing a second identity convention.
--
-- VERSIONING — terms_version is free text (e.g. '1.0'), not a boolean.
-- A new version is a NEW ROW for the same user, never an overwrite of
-- the old one — old acceptance history is never destroyed. Enforced by
-- having no UPDATE/DELETE policy at all (see step 3).
--
-- RECURSION SAFETY — this table's RLS reads nothing from any other
-- RLS-protected table (only compares against current_profile_id(),
-- which itself already runs with row_security implicitly bypassed for
-- its single internal user_profiles lookup, exactly as it does for
-- every other policy in this schema that already calls it). No new
-- recursion surface is introduced.
--
-- Everything below is idempotent (create table/policy/grant if not
-- exists, or create-or-replace) and safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. terms_acceptances
-- ---------------------------------------------------------
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_profile_id() references public.user_profiles(profile_id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One row per (user, version) — re-verifying email, a retried insert,
  -- or a double-tap can never create a second acceptance row for the
  -- same version. A genuinely new version is a genuinely new row.
  constraint terms_acceptances_user_version_unique unique (user_id, terms_version)
);

create index if not exists idx_terms_acceptances_user on public.terms_acceptances(user_id);

-- ---------------------------------------------------------
-- 2. RLS — a user may create and read only their own acceptance rows.
--    No policy of any kind exists for any other user's rows, so a
--    direct API request for another user_id is denied by the absence
--    of a matching policy, not by an application-level check.
-- ---------------------------------------------------------
alter table public.terms_acceptances enable row level security;

drop policy if exists "Users can view own terms acceptance" on public.terms_acceptances;
create policy "Users can view own terms acceptance"
  on public.terms_acceptances for select
  using (user_id = public.current_profile_id());

drop policy if exists "Users can record own terms acceptance" on public.terms_acceptances;
create policy "Users can record own terms acceptance"
  on public.terms_acceptances for insert
  with check (user_id = public.current_profile_id());

-- No update policy, no delete policy — acceptance history is
-- immutable. A user can never edit or remove a past acceptance record,
-- and the Profile screen never exposes a way to do so (only a way to
-- add a NEW acceptance for a version not yet accepted).

-- ---------------------------------------------------------
-- 3. Grants.
-- ---------------------------------------------------------
grant select, insert on public.terms_acceptances to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only unless noted.
-- =========================================================

-- 1. Confirm the table exists with RLS enabled and exactly 2 policies
--    (select/insert, no update, no delete):
--   select relrowsecurity from pg_class where relname = 'terms_acceptances';
--   select policyname, cmd from pg_policies where tablename = 'terms_acceptances';

-- 2. As an authenticated user, confirm you can record and read your own
--    acceptance, and that a repeat insert for the same version is
--    rejected by the unique constraint (not silently duplicated):
--   insert into terms_acceptances (terms_version) values ('1.0');
--   insert into terms_acceptances (terms_version) values ('1.0'); -- expect unique-violation
--   select * from terms_acceptances; -- expect exactly one row, your own

-- 3. Cross-user denial — as a second authenticated user, attempt to
--    read the first user's row directly by id:
--   select * from terms_acceptances where id = '<first user''s row id>';
--   Expect 0 rows.

-- 4. Unauthenticated denial:
--   select * from terms_acceptances; -- expect permission denied, run with the anon key

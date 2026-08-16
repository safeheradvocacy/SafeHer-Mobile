-- =========================================================
-- SafeHer — Module 1b: table grants + survivors RLS
-- Run in the Supabase SQL editor AFTER 00_schema.sql and
-- module1_auth.sql. Safe to re-run any number of times (every
-- REVOKE/GRANT/DROP POLICY IF EXISTS below is idempotent) —
-- run the WHOLE file in one go, not individual lines, so
-- nothing partial gets left behind.
--
-- ROOT CAUSE of "permission denied for table user_profiles" /
-- "permission denied for table municipalities": PostgREST
-- returned 42501. In Postgres, an RLS policy only decides which
-- ROWS a role may see/touch — the role must separately be
-- GRANTed access to the TABLE itself first, or every request is
-- rejected before RLS is even evaluated. 00_schema.sql created
-- the tables but never issued GRANTs to anon/authenticated, so
-- this affects every table the app queries, not just one.
--
-- Live-verified 2026-08-12: `municipalities` now returns 200 for
-- anon (an earlier partial run of this file worked), but
-- `user_profiles` still returns 42501 for the app's authenticated
-- session — i.e. the `grant select, update on user_profiles to
-- authenticated` line below was never actually applied. This is
-- exactly what breaks registration: after auth.signUp() succeeds
-- and the on_auth_user_created trigger creates the user_profiles
-- row, AuthContext.signUp() reads it back with
-- `.from('user_profiles').select('profile_id')...` — which needs
-- this grant to succeed at all, independent of RLS.
-- =========================================================

-- municipalities: public reference data — read-only, needed both
-- signed-out (registration dropdown) and signed-in.
grant select on public.municipalities to anon, authenticated;

-- ---------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------
-- Existing RLS policies (module1_auth.sql) already restrict rows to
-- "your own row" for both SELECT and UPDATE. But a table-level
-- `GRANT UPDATE` (no column list) lets an authenticated user update
-- *every* column on their own row — including `role`,
-- `municipality_id`, and `is_active`. RLS's `auth.uid() =
-- auth_user_id` check only ever restricts WHICH ROW, never WHICH
-- COLUMNS, so a broad grant here would let a survivor promote
-- themselves to municipal_admin or reassign their own municipality
-- authorization via a plain PATCH request. Postgres column-level
-- GRANTs close that gap: only the genuinely user-editable profile
-- fields are grantable for UPDATE. `role`, `municipality_id`,
-- `is_active`, `auth_user_id`, and `profile_id` are deliberately
-- left out — those may only ever be set by the trigger (INSERT) or
-- by a privileged admin-side process outside this grant.
revoke update on public.user_profiles from authenticated;
grant select on public.user_profiles to authenticated;
grant update (first_name, middle_name, last_name, phone_number, profile_picture)
  on public.user_profiles to authenticated;
-- No INSERT grant needed — rows are created by the
-- on_auth_user_created trigger, which runs as SECURITY DEFINER and
-- bypasses grants for the trigger owner.

-- ---------------------------------------------------------
-- survivors
-- ---------------------------------------------------------
-- RLS was never enabled on this table at all. Adding a grant without
-- this would let ANY authenticated user read or write ANY survivor's
-- row (date of birth, address, emergency contact) — unacceptable for
-- this app. Enable RLS and scope every policy to the caller's own row
-- via the user_profiles link, the same pattern module1_auth.sql
-- already uses for user_profiles.
alter table public.survivors enable row level security;

drop policy if exists "Users can view own survivor row" on public.survivors;
create policy "Users can view own survivor row"
  on public.survivors for select
  using (
    profile_id in (select profile_id from public.user_profiles where auth_user_id = auth.uid())
  );

drop policy if exists "Users can insert own survivor row" on public.survivors;
create policy "Users can insert own survivor row"
  on public.survivors for insert
  with check (
    profile_id in (select profile_id from public.user_profiles where auth_user_id = auth.uid())
  );

drop policy if exists "Users can update own survivor row" on public.survivors;
create policy "Users can update own survivor row"
  on public.survivors for update
  using (
    profile_id in (select profile_id from public.user_profiles where auth_user_id = auth.uid())
  )
  with check (
    profile_id in (select profile_id from public.user_profiles where auth_user_id = auth.uid())
  );

-- Same column-level reasoning as user_profiles above: `municipality_id`
-- is excluded from UPDATE (it's set once at INSERT, alongside
-- user_profiles.municipality_id, by AuthContext.signUp) so a survivor
-- can't reassign their own municipality authorization later via a
-- plain PATCH. `survivor_id` and `profile_id` are identifiers, never
-- client-editable.
revoke update on public.survivors from authenticated;
grant select, insert on public.survivors to authenticated;
grant update (date_of_birth, gender, address, emergency_contact_name, emergency_contact_number)
  on public.survivors to authenticated;

-- ---------------------------------------------------------
-- NOT covered here (flagged, not fixed): every other ERD table
-- the app already queries client-side — shelters, case_reports,
-- case_status_history, shelter_referrals, evidence, sos_alerts,
-- notifications, chat_sessions, chat_messages, audit_logs — has
-- the exact same missing-GRANT gap, and most also have no RLS
-- policy yet. They will return the same 42501 error the moment
-- those screens are used. This file intentionally only covers
-- what registration/login/onboarding need today; the rest needs
-- its own reviewed migration (module2_*) before those features
-- are exercised.
-- =========================================================

-- ---------------------------------------------------------
-- VERIFICATION — run these separately, after the block above,
-- to confirm the fix. All are read-only.
-- ---------------------------------------------------------

-- 1. RLS is enabled on both tables (expect rowsecurity = true for both):
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('user_profiles', 'survivors') and relnamespace = 'public'::regnamespace;

-- 2. Policies that exist (expect: user_profiles has 2 — select/update
--    "own profile"; survivors has 3 — select/insert/update "own row"):
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename in ('user_profiles', 'survivors')
--   order by tablename, cmd;

-- 3. Table + column grants for `authenticated` (expect: user_profiles
--    SELECT is table-wide; UPDATE is column-scoped to the 5 safe
--    fields only — role/municipality_id/is_active must NOT appear):
--   select table_name, privilege_type, column_name
--   from information_schema.role_column_grants
--   where grantee = 'authenticated' and table_schema = 'public'
--     and table_name in ('user_profiles', 'survivors')
--   order by table_name, privilege_type, column_name;

-- 4. Confirm the trigger is installed and pointed at the right function:
--   select tgname, tgrelid::regclass, tgfoid::regproc
--   from pg_trigger
--   where tgname = 'on_auth_user_created';

-- 5. Cross-user isolation — run as two different logged-in users (via
--    the app, or the SQL editor's "Run as" with a specific JWT) and
--    confirm each only ever sees their own row:
--   select profile_id, first_name, role, municipality_id from public.user_profiles;
--   -- should return exactly 1 row: the caller's own.

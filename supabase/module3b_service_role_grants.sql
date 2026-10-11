-- =========================================================
-- SafeHer — Module 3b: restore service_role table privileges
--
-- Run in the Supabase SQL editor AFTER module3_barangay_hierarchy.sql
-- (Part A and Part B).
--
-- WHAT THIS FIXES
-- Discovered while debugging "Barangay not found" / a network-opaque
-- failure in the create-admin-user Edge Function: the `service_role`
-- Postgres role — the ONLY role the service-role key resolves to, used
-- exclusively server-side inside Edge Functions, never exposed to any
-- client in this project — had ZERO explicit SELECT/INSERT/UPDATE/DELETE
-- grants on ANY table in the public schema (confirmed via
-- information_schema.role_table_grants). RLS does not apply to
-- service_role, but RLS and table-level GRANTs are separate layers —
-- bypassing RLS does not imply having grant-level access, and this
-- project's schema files (00_schema.sql onward) only ever granted
-- privileges to `authenticated`/`anon`, never `service_role`.
--
-- This means create-admin-user (and any other service-role-driven
-- write, present or future) never actually worked end-to-end via a real
-- deployed Edge Function call — the pre-existing seed admin accounts in
-- user_profiles were created some other way (direct SQL / the Supabase
-- Dashboard's own connection), not through this function.
--
-- Standard, expected Supabase behavior is for service_role to have full
-- access to schema objects by default (that's the whole point of the
-- role — it's the trusted server-side identity, gated entirely by never
-- leaking the key, not by table grants). This file restores that.
--
-- Idempotent and safe to re-run.
-- =========================================================

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- So tables/sequences/functions created by FUTURE migrations also work
-- for service_role automatically, without needing another one-off fix
-- like this every time a new module adds a table.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- =========================================================
-- VERIFICATION — run separately, read-only.
-- =========================================================

-- Confirm service_role can now touch the tables create-admin-user needs:
--   select
--     has_table_privilege('service_role', 'public.user_profiles', 'INSERT') as user_profiles_insert,
--     has_table_privilege('service_role', 'public.audit_logs', 'INSERT') as audit_logs_insert,
--     has_table_privilege('service_role', 'public.barangays', 'SELECT') as barangays_select;
-- Expect all three = true.

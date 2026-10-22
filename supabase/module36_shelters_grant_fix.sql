-- =========================================================
-- SafeSpace — Module 36: shelters table grant fix
--
-- SYMPTOM: "permission denied for table shelters" when creating or
-- editing a shelter in the admin dashboard (ShelterManagementPage.tsx).
--
-- ROOT CAUSE: "permission denied for table X" is Postgres's base-GRANT
-- error — it fires before row-level security is even evaluated (an RLS
-- *policy* rejection instead returns zero rows silently, never this
-- message). This project has hit this exact class of gap before
-- (module1b, module3b, module33->module34): a migration adds the RLS
-- POLICY for an operation but the matching GRANT either never shipped
-- or was never actually applied to the live project.
--
-- Read-only check first (run in the SQL editor, inspect, THEN run the
-- statements below):
--   select grantee, privilege_type, string_agg(column_name, ', ' order by column_name) as columns
--   from information_schema.role_column_grants
--   where table_schema = 'public' and table_name = 'shelters' and grantee = 'authenticated'
--   group by grantee, privilege_type order by privilege_type;
-- Expect 3 rows (SELECT/INSERT/UPDATE). Missing INSERT or UPDATE
-- confirms this is the gap.
--
-- This file does not change any RLS policy, trigger, or authorization
-- rule — module2/module4's policies (province/municipal admin create;
-- province/municipal/shelter_admin update, scoped by
-- validate_shelter_update()'s existing operational-fields-only
-- restriction for shelter_admin) are already correct and untouched. It
-- only RE-ASSERTS the exact grants module2_case_data_rls.sql and
-- module4_shelter_admin.sql already describe — GRANT is additive and
-- idempotent, safe to run even if some of these already exist, and
-- changes no data.
-- =========================================================

grant select on public.shelters to authenticated;

grant insert (municipality_id, shelter_name, address, contact_number, email, capacity, current_occupancy, latitude, longitude, services_available, is_active)
  on public.shelters to authenticated;

grant update (shelter_name, address, contact_number, email, capacity, current_occupancy, latitude, longitude, services_available, is_active, photo_path)
  on public.shelters to authenticated;

-- =========================================================
-- VERIFICATION — re-run the read-only check above; all 3 rows should
-- now be present. Then, as a disposable provincial_admin or
-- municipal_admin account, retry creating a shelter from
-- ShelterManagementPage — the save should succeed instead of raising
-- "permission denied for table shelters".
-- =========================================================

-- =========================================================
-- SafeSpace — Module 21: Admin-side survivor demographic UPDATE access
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module20_government_reporting.sql.
--
-- Single-part file — no new enum value, no new type, no destructive
-- operation. One new RLS policy only. Safe to re-run (drop policy if
-- exists + create).
--
-- WHY THIS EXISTS — the WEDC/CNSP government-report classification
-- (module20 + admin/src/lib/governmentReportMapping.ts) is correct but
-- was found, via a live read-only check, to be completely inert: every
-- real case classifies as "Unclassified" because survivors.date_of_birth
-- is never populated anywhere. Inspection found:
--   * survivors.date_of_birth / .gender are ORIGINAL schema columns
--     (00_schema.sql) — not new. A survivor can already UPDATE their
--     OWN row's date_of_birth/gender/educational_attainment — that
--     grant + RLS policy ("Users can update own survivor row") has
--     existed since module1b (date_of_birth/gender) and module20
--     (educational_attainment). Zero grant changes needed here.
--   * What's missing is purely that no UI anywhere ever calls that
--     update (fixed on the frontend, not here) AND that an ADMIN
--     helping complete a case's survivor record (e.g. a Walk-In client
--     who gave their birthdate in person, or any case with a gap) has
--     NO UPDATE path at all today — only the SELECT policy below
--     exists; there has never been a matching admin UPDATE policy on
--     survivors.
--
-- SCOPE — deliberately narrow, mirroring "Admins can view survivors in
-- scope" (module3_barangay_hierarchy.sql) EXACTLY, so write access is
-- never wider than existing read access:
--   is_provincial_admin()  -- provincial_staff/provincial_admin/super_admin
--   OR (municipal_admin AND same municipality)
-- barangay_admin gets NOTHING new here — it has no SELECT access to
-- survivors today (the same module3 policy has no barangay branch, for
-- a documented RLS-recursion reason) and expanding that is a separate,
-- deliberate product decision this task does not make unilaterally.
--
-- Single-hop/inline only (is_provincial_admin()/current_role()/
-- current_municipality_id() are all direct function calls, never a
-- join back into another RLS-protected table) — matches the exact
-- shape module3 already uses to avoid "infinite recursion detected in
-- policy for relation survivors".
--
-- AUDIT NOTE — this migration does NOT attach the generic
-- audit_row_change() trigger to survivors. That trigger logs the full
-- row via to_jsonb(old/new), which would put literal date_of_birth
-- values in audit_logs.old_values/new_values — explicitly what this
-- feature must avoid. survivors has never had a trigger-based audit
-- path; every existing write (e.g. ProfileScreen.tsx's saveAddress) is
-- already logged via a manual client-side logAudit() call, and the new
-- UI code added alongside this migration continues that convention,
-- redacting the literal DOB value (logs only whether it was set/
-- changed) while logging gender/educational_attainment with real
-- values, same as address already is today.
-- =========================================================

drop policy if exists "Admins can update survivor demographics in scope" on public.survivors;
create policy "Admins can update survivor demographics in scope"
  on public.survivors for update
  using (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  )
  with check (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

-- No new grants — date_of_birth/gender (module1b) and
-- educational_attainment (module20) are already column-granted
-- UPDATE to `authenticated`; Postgres column grants accumulate across
-- statements/files, and RLS (the policy above) is what actually scopes
-- WHICH rows an admin may now reach. Confirmed before writing this file:
--   select column_name from information_schema.role_column_grants
--   where grantee = 'authenticated' and table_name = 'survivors' and privilege_type = 'UPDATE';
--   -- already includes date_of_birth, gender, educational_attainment.


-- =========================================================
-- VERIFICATION — run these separately, after the policy above, to
-- confirm it applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the policy exists with the expected command/condition:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'survivors' order by policyname;

-- 2. Confirm survivors RLS is (still) enabled:
--   select relrowsecurity from pg_class where relname = 'survivors';

-- 3. Confirm no new TABLE-WIDE grant was introduced (expect this
--    query's row count to be unchanged from before this migration):
--   select privilege_type, column_name from information_schema.role_column_grants
--   where grantee = 'authenticated' and table_name = 'survivors' and privilege_type = 'UPDATE'
--   order by column_name;

-- 4. As a disposable municipal_admin, confirm an UPDATE to a survivor
--    in their own municipality succeeds, and to a survivor in a
--    DIFFERENT municipality affects 0 rows:
--   update survivors set gender = 'Other' where survivor_id = '<same-municipality survivor>';   -- expect 1 row
--   update survivors set gender = 'Other' where survivor_id = '<different-municipality survivor>'; -- expect 0 rows

-- 5. As a disposable barangay_admin / support_expert / shelter_admin,
--    confirm the same UPDATE affects 0 rows (RLS-blocked, not merely
--    hidden by the UI):
--   update survivors set gender = 'Other' where survivor_id = '<any survivor>'; -- expect 0 rows

-- =========================================================
-- SafeSpace — Module 40: survivors registered-address UPDATE grant fix
--
-- Run in the Supabase SQL editor AFTER every prior module.
--
-- WHY THIS EXISTS — found while implementing the PSGC address
-- integration (module38) and re-reading ProfileScreen.tsx's existing
-- saveAddress() function closely: it updates
-- municipality_id/barangay_id/purok_sitio/latitude/longitude/
-- formatted_address/location_source/address_updated_at on
-- public.survivors in one statement, but an exhaustive grep of every
-- `grant update` on survivors across every migration file in this
-- project (module1b, module20) shows ONLY date_of_birth, gender,
-- address, emergency_contact_name, emergency_contact_number, and
-- educational_attainment have ever been column-granted UPDATE to
-- `authenticated`. None of the registered-address columns above were
-- ever granted — meaning this has likely been a live "permission
-- denied for column ..." failure (a Postgres column-privilege error
-- blocks the WHOLE update statement, not just the ungranted column)
-- since module12_registered_address_incident_location.sql first shipped
-- this feature, the same GRANT-gap bug class this project has hit
-- before (module34, module36).
--
-- A DELIBERATE TENSION, RESOLVED — module1b's original comment
-- explicitly excluded municipality_id from survivors' UPDATE grant "so
-- a survivor can't reassign their own municipality authorization later
-- via a plain PATCH." That was correct for the schema AS IT STOOD in
-- module1b. module12 then deliberately built a UI (ProfileScreen's
-- registered-address card) that DOES let a survivor change their own
-- registered municipality, specifically gated behind an explicit
-- confirmation dialog ("Change your registered municipality? This
-- changes which office handles any incident reports you file after
-- this change.") — i.e. the product intent changed, but the grant was
-- never updated to match, silently leaving the whole feature broken
-- rather than leaving municipality_id actually locked. Granting it here
-- does not widen WHO can be affected (RLS's existing "Users can update
-- own survivor row" policy, module1b, already restricts every one of
-- these columns to the caller's own row only) — it only completes the
-- already-shipped, already-confirmation-gated feature. If a future
-- requirement wants municipality changes locked again, that is a
-- deliberate product decision to make explicitly (e.g. a trigger or a
-- narrower policy), not a side effect of this grant fix.
--
-- Idempotent: `grant` is safe to re-run (no-op if already granted).
-- No RLS change, no data change.
-- =========================================================

grant update (municipality_id, barangay_id, purok_sitio, latitude, longitude, formatted_address, location_source, address_updated_at)
  on public.survivors to authenticated;


-- =========================================================
-- VERIFICATION — run separately, after the grant above. This migration
-- was written without live database access in this environment (same
-- caveat as every other module in this project) — confirm against the
-- live project before relying on it.
-- =========================================================

-- 1. Confirm the new columns are now listed:
--   select column_name from information_schema.role_column_grants
--   where grantee = 'authenticated' and table_name = 'survivors' and privilege_type = 'UPDATE'
--   order by column_name;
--   -- expect: address, barangay_id, date_of_birth, educational_attainment, emergency_contact_name,
--   --         emergency_contact_number, formatted_address, gender, latitude, location_source,
--   --         longitude, municipality_id, purok_sitio, address_updated_at

-- 2. As a disposable survivor account (own JWT, not service-role),
--    confirm ProfileScreen's "Save address" now succeeds end to end
--    (previously: "Unable to save" / a Postgres permission-denied error
--    in the client log).

-- 3. Confirm RLS still restricts this to the caller's own row only (a
--    survivor cannot update a DIFFERENT survivor_id's address):
--   update survivors set purok_sitio = 'test' where survivor_id = '<a different survivor's id>';
--   -- expect 0 rows affected, not an error (RLS filters silently) and
--   -- not a permission-denied error (that would indicate the grant
--   -- itself is somehow scoped wrong, which it should not be).

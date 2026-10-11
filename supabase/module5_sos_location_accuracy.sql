-- =========================================================
-- SafeHer — Module 5: SOS location accuracy + active-session
-- foreground location refresh (Foundational phase)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, module1b_grants_and_survivors_rls.sql,
-- module2_case_data_rls.sql, module3_barangay_hierarchy.sql,
-- module3b_service_role_grants.sql, and module4_shelter_admin.sql.
--
-- No enum value is being ADDED to an existing type here (that's
-- the only reason module3/module4 needed a two-part split), so
-- this file is a single script — safe to run in one go.
--
-- WHAT THIS ADDS, and why, on the EXISTING sos_alerts table (no
-- new table — the mobile SOS flow already writes here via
-- useSosTrigger.ts, and this just makes that write richer):
--   - location_accuracy (meters), location_timestamp (when the
--     fix was taken), location_source ('CURRENT' | 'LAST_KNOWN' |
--     'UNAVAILABLE') — lets responders judge how much to trust a
--     pin instead of treating every SOS location as equally exact.
--   - latitude/longitude become NULLABLE. They were NOT NULL
--     before, which made "send the alert anyway, we just
--     couldn't get a location" impossible to represent — the
--     mobile app's location-failure fallback needs this to be a
--     real, representable state, not a workaround like (0,0).
--   - a narrow UPDATE policy + column grant letting a survivor
--     refresh ONLY the location columns on their OWN still-active
--     alert (foreground polling while the SOS screen stays open —
--     see mobile/src/lib/useActiveSosLocationUpdates.ts). This is
--     new: previously only admins could UPDATE sos_alerts at all.
--
-- SECURITY NOTE — the same-role column-grant trap this project
-- has hit before: `authenticated` is one shared Postgres role, so
-- the pre-existing admin grant `update (status, resolved_at)` and
-- this file's new survivor grant `update (latitude, longitude,
-- location_accuracy, location_timestamp, location_source)` both
-- land on that same role. Postgres RLS policies for the same
-- command are OR'd together, so without more, a survivor's own
-- "update my active alert's location" policy could ALSO authorize
-- smuggling a `status`/`resolved_at` change into the same request
-- (RLS restricts which ROWS, not which COLUMNS, a policy allows).
-- validate_sos_alert_update() below closes that gap the same way
-- validate_shelter_update() already does for shelters.status.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column if not exists) and safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enum: how a location fix was obtained. Matches the
--    three states the mobile acquisition strategy can end up in —
--    never silently claim a stale fix is the user's current one.
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sos_location_source') then
    create type sos_location_source as enum ('CURRENT', 'LAST_KNOWN', 'UNAVAILABLE');
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. sos_alerts — new columns + relax latitude/longitude.
-- ---------------------------------------------------------
alter table public.sos_alerts alter column latitude drop not null;
alter table public.sos_alerts alter column longitude drop not null;

alter table public.sos_alerts add column if not exists location_accuracy numeric;
alter table public.sos_alerts add column if not exists location_timestamp timestamptz;
alter table public.sos_alerts add column if not exists location_source sos_location_source not null default 'UNAVAILABLE';

-- Backfill: every existing row was created back when lat/lng were
-- required, so they have a real fix — label it CURRENT and use
-- triggered_at as the best available approximation of when it was
-- taken (the exact fix timestamp was never captured before now).
update public.sos_alerts
set location_source = 'CURRENT', location_timestamp = triggered_at
where latitude is not null and longitude is not null and location_source = 'UNAVAILABLE' and location_timestamp is null;

-- ---------------------------------------------------------
-- 3. Column-differentiation trigger (see security note above).
--    Mirrors validate_shelter_update()'s technique exactly.
-- ---------------------------------------------------------
create or replace function public.validate_sos_alert_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.status is distinct from old.status or new.resolved_at is distinct from old.resolved_at then
      raise exception 'Only administrators can change an SOS alert''s status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_sos_alert_update on public.sos_alerts;
create trigger trg_validate_sos_alert_update
  before update on public.sos_alerts
  for each row execute procedure public.validate_sos_alert_update();

-- ---------------------------------------------------------
-- 4. RLS — new policy letting a survivor refresh their OWN
--    alert's location fields, but only while it's still active.
--    Once an admin marks it Responding->Resolved (or it was never
--    anything but Resolved/Triggered->Resolved), this policy's
--    USING clause stops matching and further refresh attempts
--    from the phone simply update 0 rows — the mobile hook treats
--    that as "stop polling", not an error.
-- ---------------------------------------------------------
drop policy if exists "Survivors can refresh own active sos location" on public.sos_alerts;
create policy "Survivors can refresh own active sos location"
  on public.sos_alerts for update
  using (profile_id = public.current_profile_id() and status in ('Triggered', 'Responding'))
  with check (profile_id = public.current_profile_id() and status in ('Triggered', 'Responding'));

grant update (latitude, longitude, location_accuracy, location_timestamp, location_source) on public.sos_alerts to authenticated;

-- =========================================================
-- VERIFICATION — run these separately, after everything above,
-- to confirm the migration applied correctly. All read-only.
-- =========================================================

-- 1. Confirm latitude/longitude are nullable now:
--   select column_name, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'sos_alerts' and column_name in ('latitude','longitude');

-- 2. Confirm the new columns exist:
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'sos_alerts'
--     and column_name in ('location_accuracy','location_timestamp','location_source');

-- 3. Confirm the new policy exists:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'sos_alerts' order by cmd;

-- 4. Confirm status/resolved_at are NOT reachable through the new
--    survivor grant (expect the survivor-scoped grant to list only
--    the location columns — status/resolved_at should only ever
--    show up in the pre-existing admin-intent grant row):
--   select column_name from information_schema.role_column_grants
--   where grantee = 'authenticated' and privilege_type = 'UPDATE'
--     and table_schema = 'public' and table_name = 'sos_alerts';

-- 5. Confirm the trigger blocks a non-admin status change — run
--    this as an authenticated survivor via the client (e.g. the
--    anon key + that user's access token), not the SQL editor,
--    since is_admin() reads auth.uid() from the request's JWT and
--    the SQL editor's session has none. Expect an exception:
--   update sos_alerts set status = 'Resolved' where sos_id = '<own alert id>';

-- =========================================================
-- SafeHer — Module 12: Registered address & incident location
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module11_provincial_staff_rbac.sql.
--
-- Single-part file (no exception to note, unlike module3/4/6/7/9/10/11):
-- this introduces a brand-new enum TYPE, not a new VALUE on an existing
-- one — Postgres's "can't reference a value added earlier in the same
-- transaction" restriction only applies to ALTER TYPE ... ADD VALUE, so
-- there is nothing here that needs a Part A/Part B split (matches the
-- documented exception already used by module5/module8).
--
-- MODEL — two genuinely separate, permanently-distinct location
-- concepts, matching the approved design:
--   * REGISTERED ADDRESS lives on `survivors` (NOT `user_profiles` —
--     that table's municipality_id/barangay_id are a completely
--     different concept, admin jurisdiction assignment, and are left
--     untouched by this file). `survivors.address` (existing column,
--     never actually used by any screen before this) is reinterpreted
--     as the street/house-number line; barangay_id/purok_sitio/
--     latitude/longitude/formatted_address/location_source/
--     address_updated_at are new.
--   * INCIDENT LOCATION lives on `case_reports`, as new
--     `incident_*`-prefixed columns, populated once at report
--     submission and never updated afterward (no UPDATE grant is ever
--     added for them — this is what makes "editing a profile address
--     later can never rewrite a past incident's recorded location" a
--     database-enforced guarantee, not just a UI convention).
--   * `case_reports.municipality_id` and `owner_barangay_id` are NOT
--     touched by this file and keep their existing meaning exactly —
--     they drive case jurisdiction/routing (which admin sees a case)
--     and are unrelated to "where the incident actually happened".
--     The new incident_* columns are purely descriptive/display
--     additions layered on top.
--
-- RLS — no new policies needed anywhere. `survivors`' existing RLS
-- (module1b_grants_and_survivors_rls.sql) already scopes SELECT/
-- INSERT/UPDATE to "your own row" at the ROW level, which automatically
-- covers any new columns — only the COLUMN-scoped UPDATE grant needs
-- extending (see below). `case_reports`' existing INSERT policy
-- (module10_identity_verification.sql) is unaffected by adding more
-- nullable columns to insert into.
--
-- Everything below is idempotent (create type if not exists via
-- exception handling, add column if not exists, create or replace) and
-- safe to re-run. All new columns are NULLABLE — no existing survivor
-- or case row is affected, no backfill needed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enum: HOW a location was captured (distinct from
--    sos_location_source, which is about GPS-fix freshness/accuracy,
--    not the capture method).
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'address_location_source') then
    create type public.address_location_source as enum ('map_pin', 'current_location', 'manually_confirmed');
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. survivors — registered address columns.
-- ---------------------------------------------------------
alter table public.survivors add column if not exists barangay_id uuid references public.barangays(barangay_id);
alter table public.survivors add column if not exists purok_sitio varchar(100);
alter table public.survivors add column if not exists latitude decimal(10,8);
alter table public.survivors add column if not exists longitude decimal(11,8);
alter table public.survivors add column if not exists formatted_address text;
alter table public.survivors add column if not exists location_source public.address_location_source;
alter table public.survivors add column if not exists address_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survivors_latitude_range') then
    alter table public.survivors add constraint survivors_latitude_range check (latitude is null or latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'survivors_longitude_range') then
    alter table public.survivors add constraint survivors_longitude_range check (longitude is null or longitude between -180 and 180);
  end if;
end $$;

-- Extends the existing column-scoped UPDATE grant (module1b) — adds the
-- new address columns PLUS municipality_id (per the confirmed decision
-- to lift its prior lock, since a survivor changing their own
-- registered municipality/barangay is not a privilege change, only
-- where their own future reports are routed). date_of_birth/gender/
-- address/emergency_contact_name/emergency_contact_number were already
-- grantable and are restated here only because Postgres's column-grant
-- statement replaces the prior list, not merges into it.
revoke update on public.survivors from authenticated;
grant update (
  date_of_birth, gender, address, emergency_contact_name, emergency_contact_number,
  municipality_id, barangay_id, purok_sitio, latitude, longitude, formatted_address,
  location_source, address_updated_at
) on public.survivors to authenticated;

-- ---------------------------------------------------------
-- 3. case_reports — incident location columns (insert-time only,
--    deliberately no UPDATE grant added for any of these — see file
--    header). incident_barangay_id is a DIFFERENT column from the
--    existing owner_barangay_id (case-routing owner, changes as a case
--    escalates) — never conflate the two.
-- ---------------------------------------------------------
alter table public.case_reports add column if not exists incident_barangay_id uuid references public.barangays(barangay_id);
alter table public.case_reports add column if not exists incident_latitude decimal(10,8);
alter table public.case_reports add column if not exists incident_longitude decimal(11,8);
alter table public.case_reports add column if not exists incident_formatted_address text;
alter table public.case_reports add column if not exists incident_location_source public.address_location_source;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'case_reports_incident_latitude_range') then
    alter table public.case_reports add constraint case_reports_incident_latitude_range check (incident_latitude is null or incident_latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'case_reports_incident_longitude_range') then
    alter table public.case_reports add constraint case_reports_incident_longitude_range check (incident_longitude is null or incident_longitude between -180 and 180);
  end if;
end $$;

-- ---------------------------------------------------------
-- 4. handle_new_user() — extend the signup trigger to also read the
--    new (all-optional) address fields out of signup metadata into the
--    newly-created survivors row. Registration stays a single
--    supabase.auth.signUp() call; no new client-side insert. Matches
--    the approved design: map-pin confirmation is optional at
--    registration, so latitude/longitude/formatted_address/
--    location_source may legitimately be absent here.
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_profile_id uuid;
  meta_municipality_id uuid;
  meta_barangay_id uuid;
  meta_latitude decimal(10,8);
  meta_longitude decimal(11,8);
begin
  meta_municipality_id := nullif(new.raw_user_meta_data->>'municipality_id', '')::uuid;
  meta_barangay_id := nullif(new.raw_user_meta_data->>'barangay_id', '')::uuid;
  meta_latitude := nullif(new.raw_user_meta_data->>'latitude', '')::decimal(10,8);
  meta_longitude := nullif(new.raw_user_meta_data->>'longitude', '')::decimal(11,8);

  insert into public.user_profiles (
    auth_user_id,
    municipality_id,
    role,
    first_name,
    last_name,
    phone_number
  )
  values (
    new.id,
    meta_municipality_id,
    'survivor',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'phone_number'
  )
  returning profile_id into new_profile_id;

  -- survivors.municipality_id is NOT NULL — only insert when the
  -- signup actually supplied one (it always should, since
  -- RegisterScreen requires picking a municipality before it will
  -- submit, but this stays defensive rather than erroring the whole
  -- signup if that's ever not the case).
  if meta_municipality_id is not null then
    insert into public.survivors (
      profile_id, municipality_id, barangay_id, address, purok_sitio,
      latitude, longitude, formatted_address, location_source,
      address_updated_at
    )
    values (
      new_profile_id, meta_municipality_id, meta_barangay_id,
      nullif(new.raw_user_meta_data->>'street_address', ''),
      nullif(new.raw_user_meta_data->>'purok_sitio', ''),
      meta_latitude, meta_longitude,
      nullif(new.raw_user_meta_data->>'formatted_address', ''),
      nullif(new.raw_user_meta_data->>'location_source', '')::public.address_location_source,
      case when meta_latitude is not null then now() else null end
    );
  end if;

  return new;
end;
$$;
-- Trigger itself (on_auth_user_created on auth.users) is unchanged —
-- create or replace function above is all that's needed.


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the new enum + all new columns/constraints exist:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'survivors' and column_name in
--     ('barangay_id','purok_sitio','latitude','longitude','formatted_address','location_source','address_updated_at');
--   select column_name, data_type from information_schema.columns
--   where table_name = 'case_reports' and column_name like 'incident_%';
--   select conname from pg_constraint where conname like '%latitude_range' or conname like '%longitude_range';

-- 2. Confirm a survivor test account can now update its own
--    municipality_id/barangay_id/latitude/longitude/etc (previously
--    municipality_id was blocked):
--   update survivors set municipality_id = '<a different municipality_id>', barangay_id = '<a barangay_id>',
--     latitude = 15.75, longitude = 121.56 where profile_id = current_profile_id();
--   Expect success.

-- 3. Confirm a DIFFERENT survivor test account still cannot touch the
--    first one's row (RLS unchanged, still self-row-only):
--   update survivors set latitude = 0 where survivor_id = '<the other survivor's id>';
--   Expect 0 rows affected (RLS silently filters, not an error).

-- 4. Confirm case_reports' new incident columns accept a value at
--    INSERT and reject a later UPDATE attempt (proving immutability —
--    no UPDATE grant was ever added for them):
--   insert into case_reports (survivor_id, municipality_id, case_number, case_type, status, incident_barangay_id, incident_latitude, incident_longitude)
--   values ('<own survivor_id>', '<own municipality_id>', 'TEST-LOC-1', 'Others', 'Pending', '<a barangay_id>', 15.75, 121.56);
--   -- Expect success (as an identity-verified survivor).
--   update case_reports set incident_latitude = 0 where case_number = 'TEST-LOC-1';
--   -- Expect a permission-denied (42501) error — incident_latitude was never granted for UPDATE.

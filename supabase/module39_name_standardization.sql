-- =========================================================
-- SafeSpace — Module 39: Personal name standardization
--
-- Run in the Supabase SQL editor AFTER every prior module.
--
-- WHY — the "Cross-Platform Validation, Name Standardization, PSGC
-- Address Integration, Pagination, and Confirmation Dialogs" master
-- prompt requires First/Middle/Last/Suffix as the standard structure
-- for every person's name, including emergency contacts.
--
-- AUDIT FIRST — confirmed before writing this file:
--   * public.user_profiles already stores first_name/middle_name/
--     last_name as separate columns (00_schema.sql) — this covers
--     EVERY person account in the system, survivor and staff/admin
--     alike: admin's UserManagementPage.tsx creates and edits
--     government-personnel and admin accounts as rows in this SAME
--     table (role in ('municipal_admin','barangay_admin',
--     'law_enforcement','provincial_admin', etc.)) — there is no
--     separate "government personnel" or "admin accounts" table.
--     Only `suffix` is missing here.
--   * public.survivors.emergency_contact_name (00_schema.sql) is the
--     ONE place in this project that still stores a person's name as a
--     single combined string. Exactly one admin screen reads it
--     directly (CaseDetailPage.tsx's read-only "Emergency contact"
--     field) — kept working unmodified by this migration, since the
--     combined column is enriched/kept in sync going forward rather
--     than removed.
--   * Per the governing spec's explicit instruction ("do not
--     automatically split every existing full name based on spaces...
--     ambiguous records should be preserved for review"), this
--     migration does NOT attempt to guess a split for every existing
--     value. It only auto-splits the unambiguous case (exactly two
--     space-separated tokens -> first + last), and otherwise leaves
--     the new structured columns null and flags the row via
--     emergency_contact_name_needs_review for an admin/provincial
--     reviewer to resolve by hand. The original combined column is
--     NEVER cleared, overwritten with a guess, or dropped.
--
-- Idempotent: every column add is `if not exists`; the one-time
-- backfill below only ever touches rows where the new first/last
-- columns are still null, so re-running this file is a no-op on
-- already-migrated rows.
-- =========================================================

-- ---------------------------------------------------------
-- 1. user_profiles.suffix — covers every person account (survivor,
--    government personnel, admin) since all are rows in this one table.
-- ---------------------------------------------------------
alter table public.user_profiles add column if not exists suffix varchar(10);

comment on column public.user_profiles.suffix is
  'Optional name suffix (e.g. Jr., Sr., II, III, IV, or a short free-text alternative when none of those fit). Never required.';

-- Extends the exact same narrow column-grant list module1b already
-- established for first_name/middle_name/last_name/phone_number/
-- profile_picture -- suffix is just one more self-editable name part.
grant update (suffix) on public.user_profiles to authenticated;

-- ---------------------------------------------------------
-- 1b. handle_new_user() -- also wire middle_name/suffix into signup.
--
-- AUDIT NOTE: user_profiles.middle_name has existed since 00_schema.sql
-- but was NEVER actually populated by this trigger (confirmed by
-- reading every version: module1_auth.sql's original insert lists only
-- first_name/last_name/phone_number; module12's redefinition, reproduced
-- verbatim below, extended the SAME insert with the address/survivors
-- side but still never added middle_name). RegisterScreen.tsx now
-- collects and sends middle_name/suffix in signUp metadata alongside
-- this migration -- without this redefinition they would be silently
-- dropped on every new signup.
--
-- Redefined in place (identical signature); every line is reproduced
-- unchanged from module12_registered_address_incident_location.sql's
-- version except the two marked additions.
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
    middle_name, -- added by module39
    last_name,
    suffix, -- added by module39
    phone_number
  )
  values (
    new.id,
    meta_municipality_id,
    'survivor',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'middle_name', ''), -- added by module39
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'suffix', ''), -- added by module39
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
-- Trigger itself (on_auth_user_created on auth.users) is unchanged.

-- ---------------------------------------------------------
-- 2. Emergency contact — new structured columns alongside (not instead
--    of) the existing combined one.
-- ---------------------------------------------------------
alter table public.survivors add column if not exists emergency_contact_first_name varchar(100);
alter table public.survivors add column if not exists emergency_contact_middle_name varchar(100);
alter table public.survivors add column if not exists emergency_contact_last_name varchar(100);
alter table public.survivors add column if not exists emergency_contact_suffix varchar(10);
alter table public.survivors add column if not exists emergency_contact_name_needs_review boolean not null default false;

comment on column public.survivors.emergency_contact_first_name is
  'Structured emergency-contact name parts, authoritative going forward (module39). May be null for a pre-existing record whose combined emergency_contact_name could not be unambiguously split -- see emergency_contact_name_needs_review.';
comment on column public.survivors.emergency_contact_name_needs_review is
  'True for a pre-existing emergency_contact_name this migration could not safely auto-split (anything other than exactly two space-separated words) -- the combined name is preserved as-is; a person should review and fill in the structured fields via the app''s own emergency-contact form. Never set true for a record created after this migration, since the app itself now collects the structured fields directly.';

-- Extends the exact same narrow grant module1b already established for
-- emergency_contact_name/emergency_contact_number -- the new parts are
-- just the structured form of the same self-editable field.
-- emergency_contact_name_needs_review is deliberately NOT granted: it
-- is a migration/review bookkeeping flag, not something the app itself
-- ever needs (or should be able) to set directly.
grant update (emergency_contact_first_name, emergency_contact_middle_name, emergency_contact_last_name, emergency_contact_suffix)
  on public.survivors to authenticated;

-- One-time, conservative backfill: only the unambiguous "First Last"
-- shape (exactly two whitespace-separated tokens, no comma) is split.
-- Everything else (one token, three or more tokens, or anything
-- containing a comma -- all real possibilities for a free-typed name:
-- a nickname-only entry, "Dela Cruz" as a multi-word surname, "Juan
-- Carlos Reyes", "Reyes, Juan") is left for manual review rather than
-- guessed.
update public.survivors
set
  emergency_contact_first_name = split_part(trim(emergency_contact_name), ' ', 1),
  emergency_contact_last_name = split_part(trim(emergency_contact_name), ' ', 2),
  emergency_contact_name_needs_review = false
where emergency_contact_name is not null
  and emergency_contact_first_name is null
  and trim(emergency_contact_name) !~ ','
  and array_length(regexp_split_to_array(trim(emergency_contact_name), '\s+'), 1) = 2;

update public.survivors
set emergency_contact_name_needs_review = true
where emergency_contact_name is not null
  and emergency_contact_first_name is null;


-- =========================================================
-- VERIFICATION — run separately, after everything above.
-- =========================================================

-- 1. How many existing emergency contacts were auto-split vs. flagged
--    for review:
--   select
--     count(*) filter (where emergency_contact_first_name is not null) as auto_split,
--     count(*) filter (where emergency_contact_name_needs_review) as needs_review,
--     count(*) filter (where emergency_contact_name is null) as none_on_file
--   from public.survivors;

-- 2. Spot-check a sample of flagged rows to confirm they are genuinely
--    ambiguous (not an auto-split bug):
--   select survivor_id, emergency_contact_name from public.survivors
--   where emergency_contact_name_needs_review limit 20;

-- 3. Confirm no existing emergency_contact_name value was cleared or
--    altered by this migration (should return zero rows -- this
--    migration only ever ADDS structured columns, never touches the
--    original):
--   -- (compare a pre-migration export of survivor_id, emergency_contact_name
--   --  against the same columns post-migration if you have one on hand)

-- 4. Confirm user_profiles accounts (any role) can still set a suffix
--    via the app and that existing accounts are unaffected (suffix is
--    null by default, not required anywhere).

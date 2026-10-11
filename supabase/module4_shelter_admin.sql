-- =========================================================
-- SafeHer — Module 4: Shelter Admin role + direct survivor
-- shelter requests (Foundational phase)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, module1b_grants_and_survivors_rls.sql,
-- module2_case_data_rls.sql, module3_barangay_hierarchy.sql,
-- and module3b_service_role_grants.sql.
--
-- IMPORTANT — this file is split into two parts that MUST be
-- run as two SEPARATE executions ("Run" clicks) in the SQL
-- editor, in order — same reason as module3: Postgres does not
-- allow a newly-added enum value to be referenced by anything
-- else in the same transaction/script that added it.
--
-- ARCHITECTURE NOTE — two shelter access paths, one shared
-- `shelters` table, deliberately SEPARATE request tables:
--   - shelter_referrals (existing, UNTOUCHED in shape) — an
--     authorized agency (municipal/provincial admin) referring
--     an existing case to a shelter. Always tied to a case_id.
--   - shelter_requests (new, this file) — a survivor requesting
--     shelter assistance directly, with no case required. Its
--     ownership semantics (profile_id, not case ownership) are
--     different enough from case-based access that bolting it
--     onto shelter_referrals would mean rewriting that table's
--     already-working RLS. Keeping them separate means
--     shelter_referrals' existing policies below are extended
--     (new shelter_admin branch added) but never restructured.
-- A Shelter Admin dashboard queries both tables and merges them
-- for display, tagged by which table each row came from — so it
-- still reads as one inbox to the user even though there are two
-- tables underneath.
--
-- Everything in this file is idempotent (create or replace,
-- drop ... if exists + create, add column if not exists) and
-- safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'shelter_admin';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enums for shelter_requests.
--    Title-Case values, matching the rest of the schema's
--    enum convention (referral_status, case_owner_level, etc).
--
--    shelter_request_status is deliberately its OWN enum, not a
--    reuse of the existing 4-state referral_status — the brief
--    is explicit that "request accepted" and "survivor
--    physically admitted" must never be conflated, and
--    referral_status's 4 states ('Pending'/'Accepted'/
--    'Declined'/'Completed') can't express that distinction.
--
--    shelter_request_urgency absorbs what the brief calls
--    "request_source: emergency_request" — since every row in
--    THIS table is already survivor-initiated (that's the whole
--    reason it's a separate table from shelter_referrals), a
--    separate request_source column would be redundant; urgency
--    captures the same real distinction (how fast this needs
--    attention) without an extra column.
-- ---------------------------------------------------------
do $$ begin
  create type shelter_request_status as enum (
    'Submitted', 'Under Review', 'Awaiting Information', 'Accepted',
    'Declined', 'Cancelled', 'Placement Confirmed', 'Completed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type shelter_request_urgency as enum ('Standard', 'Urgent', 'Emergency');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- 2. shelters — new operational columns. address/latitude/
--    longitude/shelter_name/municipality_id stay identity/
--    location fields (see the shelter_admin update-restriction
--    trigger in section 6) — email/services_available are
--    genuinely operational, alongside the existing capacity/
--    current_occupancy/is_active/contact_number.
-- ---------------------------------------------------------
alter table public.shelters
  add column if not exists email varchar(255),
  add column if not exists services_available text;

-- ---------------------------------------------------------
-- 3. user_profiles.shelter_id — set only for shelter_admin
--    profiles (enforced by the trigger in section 6), mirroring
--    barangay_id's exact treatment for barangay_admin.
-- ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists shelter_id uuid references public.shelters(shelter_id);

-- ---------------------------------------------------------
-- 4. shelter_requests — direct survivor shelter requests.
--    case_id is nullable and unused by any code in this phase —
--    reserved for a future escalation flow ("if additional
--    protection is needed, an official case workflow begins"),
--    exactly like case_referrals reserved responded_by/
--    responded_at for its own future phase.
--
--    No precise latitude/longitude column — municipality_id is
--    the survivor's general area only, matching the brief's
--    "do not automatically expose a survivor's precise live
--    device location to Shelter Administrators" requirement.
--
--    contact_name/contact_preference are survivor-controlled,
--    captured at submission time (defaulted from their own
--    profile client-side, but editable) — this is deliberate
--    data minimization BY DESIGN: the shelter_admin never gets
--    automatic read access to the survivor's registered
--    user_profiles row (see section 7's note on why that would
--    reintroduce the exact RLS recursion this project already
--    hit once); they only ever see what the survivor chose to
--    write here.
-- ---------------------------------------------------------
create table if not exists public.shelter_requests (
  request_id         uuid primary key default gen_random_uuid(),
  shelter_id         uuid not null references public.shelters(shelter_id),
  profile_id         uuid not null references public.user_profiles(profile_id),
  case_id            uuid references public.case_reports(case_id),
  status             shelter_request_status not null default 'Submitted',
  urgency            shelter_request_urgency not null default 'Standard',
  people_count       integer not null default 1,
  children_count     integer not null default 0,
  municipality_id    uuid references public.municipalities(municipality_id),
  contact_name       text not null,
  contact_preference text,
  message            text,
  reviewed_by        uuid references public.user_profiles(profile_id),
  reviewed_at        timestamptz,
  review_notes       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint shelter_requests_people_count_check check (people_count >= 1),
  constraint shelter_requests_children_count_check check (children_count >= 0 and children_count <= people_count)
);
create index if not exists idx_shelter_requests_shelter on public.shelter_requests(shelter_id);
create index if not exists idx_shelter_requests_profile on public.shelter_requests(profile_id);

-- ---------------------------------------------------------
-- 5. RLS helper functions — same SECURITY DEFINER STABLE,
--    single-other-table-only pattern as current_barangay_id()/
--    is_barangay_admin(), to avoid RLS self-recursion.
-- ---------------------------------------------------------
create or replace function public.current_shelter_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select shelter_id from public.user_profiles where auth_user_id = auth.uid();
$$;

create or replace function public.is_shelter_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where auth_user_id = auth.uid() and role = 'shelter_admin'
  );
$$;

-- Redefined (create or replace, idempotent) to recognize the new
-- role — every existing caller of is_admin() (e.g. shelters' own
-- SELECT policy: `is_active = true or is_admin()`) gets shelter
-- admins included automatically, including visibility into their
-- own shelter even if it's temporarily marked inactive.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('municipal_admin', 'provincial_admin', 'super_admin', 'barangay_admin', 'shelter_admin')
  );
$$;

-- Authorization gate for notifications' INSERT policy (section 8):
-- true only if the caller is a shelter_admin AND p_profile_id is
-- linked to a request/referral at THEIR shelter. Touches
-- shelter_requests, shelter_referrals, case_reports, survivors —
-- deliberately never notifications itself, so notifications'
-- own policy can safely call this without re-entering itself.
create or replace function public.shelter_admin_notification_allowed(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.current_role() = 'shelter_admin'
    and (
      exists (
        select 1 from public.shelter_requests sr
        where sr.profile_id = p_profile_id and sr.shelter_id = public.current_shelter_id()
      )
      or exists (
        select 1 from public.shelter_referrals sf
        join public.case_reports cr on cr.case_id = sf.case_id
        join public.survivors s on s.survivor_id = cr.survivor_id
        where s.profile_id = p_profile_id and sf.shelter_id = public.current_shelter_id()
      )
    );
$$;

-- ---------------------------------------------------------
-- 6. Integrity/authorization triggers.
-- ---------------------------------------------------------

-- Exact mirror of validate_user_profile_barangay() for shelter_id.
create or replace function public.validate_user_profile_shelter()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'shelter_admin' then
    if new.shelter_id is null then
      raise exception 'shelter_admin profiles must have shelter_id set';
    end if;
    if not exists (
      select 1 from public.shelters sh
      where sh.shelter_id = new.shelter_id and sh.municipality_id = new.municipality_id
    ) then
      raise exception 'shelter_id must belong to the profile''s own municipality_id';
    end if;
  elsif new.shelter_id is not null then
    raise exception 'shelter_id may only be set for shelter_admin profiles';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_user_profile_shelter on public.user_profiles;
create trigger trg_validate_user_profile_shelter
  before insert or update of role, municipality_id, shelter_id on public.user_profiles
  for each row execute procedure public.validate_user_profile_shelter();

-- Column-level restriction that GRANT alone can't express here,
-- since every application role shares the single Postgres
-- "authenticated" role: a shelter_admin may update operational
-- fields (capacity/occupancy/contact/email/services/is_active)
-- but never identity/location fields, which stay
-- provincial/municipal-admin-controlled.
create or replace function public.validate_shelter_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'shelter_admin' then
    if new.shelter_name is distinct from old.shelter_name
      or new.address is distinct from old.address
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.municipality_id is distinct from old.municipality_id
    then
      raise exception 'shelter_admin may only update operational fields, not the shelter''s name/address/location/municipality';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_shelter_update on public.shelters;
create trigger trg_validate_shelter_update
  before update on public.shelters
  for each row execute procedure public.validate_shelter_update();

-- Same column-differentiation technique for shelter_requests:
-- RLS (section 7) already restricts WHICH rows a survivor vs a
-- shelter_admin can reach; this trigger restricts WHICH COLUMNS
-- each of those two allowed actors may change on an update they
-- otherwise passed RLS for. A survivor may only cancel their own
-- still-pending request; a shelter_admin may perform the full
-- review update.
create or replace function public.validate_shelter_request_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'shelter_admin' then
    return new;
  elsif new.profile_id = public.current_profile_id() then
    if new.status is distinct from 'Cancelled' then
      raise exception 'You may only cancel your own shelter request';
    end if;
    if old.status not in ('Submitted', 'Under Review', 'Awaiting Information') then
      raise exception 'This request can no longer be cancelled';
    end if;
    if new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_notes is distinct from old.review_notes
    then
      raise exception 'You may only change the status of your own request';
    end if;
    return new;
  else
    raise exception 'Not authorized to update this shelter request';
  end if;
end;
$$;

drop trigger if exists trg_validate_shelter_request_update on public.shelter_requests;
create trigger trg_validate_shelter_request_update
  before update on public.shelter_requests
  for each row execute procedure public.validate_shelter_request_update();

-- ---------------------------------------------------------
-- 7. RLS — shelter_requests (new table).
--
--    No branch here ever queries user_profiles for anything
--    beyond the standard single-hop current_role()/
--    current_shelter_id()/current_municipality_id() self-reads —
--    exactly the pattern already proven safe throughout this
--    schema. It does NOT join out to survivors/case_reports the
--    way admin_can_access_profile does, so there is no path back
--    into a table that could itself read user_profiles while
--    user_profiles is being expanded — this table structurally
--    cannot recurse.
-- ---------------------------------------------------------
alter table public.shelter_requests enable row level security;

drop policy if exists "Survivors and shelter staff can view shelter requests in scope" on public.shelter_requests;
create policy "Survivors and shelter staff can view shelter requests in scope"
  on public.shelter_requests for select
  using (
    profile_id = public.current_profile_id()
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
    or public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

drop policy if exists "Survivors can submit shelter requests" on public.shelter_requests;
create policy "Survivors can submit shelter requests"
  on public.shelter_requests for insert
  with check (profile_id = public.current_profile_id());

drop policy if exists "Shelter requests updatable by survivor or shelter admin" on public.shelter_requests;
create policy "Shelter requests updatable by survivor or shelter admin"
  on public.shelter_requests for update
  using (profile_id = public.current_profile_id() or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id()))
  with check (profile_id = public.current_profile_id() or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id()));

-- No delete policy — requests are cancelled (status), never deleted.

-- ---------------------------------------------------------
-- 8. RLS — extend existing tables with a shelter_admin branch.
--    Each redefines the policy in full (drop + create); the
--    pre-existing branches are copied verbatim, unchanged.
-- ---------------------------------------------------------

-- shelters: add an INSERT policy (none existed at all before —
-- shelters could previously only be created via service_role/
-- direct SQL). Scoped like barangay creation: provincial admin
-- anywhere, municipal admin within their own municipality.
-- shelter_admin is deliberately absent — they manage their
-- existing shelter, they don't create new ones.
drop policy if exists "Admins can create shelters in scope" on public.shelters;
create policy "Admins can create shelters in scope"
  on public.shelters for insert
  with check (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

-- shelters: UPDATE gains a shelter_admin branch scoped to their
-- own shelter_id (column-level restriction enforced by the
-- trigger in section 6, not by this policy).
drop policy if exists "Admins can update shelters in scope" on public.shelters;
create policy "Admins can update shelters in scope"
  on public.shelters for update
  using (public.is_provincial_admin() or municipality_id = public.current_municipality_id() or shelter_id = public.current_shelter_id())
  with check (public.is_provincial_admin() or municipality_id = public.current_municipality_id() or shelter_id = public.current_shelter_id());

-- shelter_referrals: SELECT and UPDATE gain a shelter_admin
-- branch — closes a real, pre-existing gap where a shelter_admin
-- could not see referrals sent to their own shelter at all.
-- admin_can_access_case_active only ever touches case_reports
-- (never shelter_referrals or case_referrals), so this stays
-- exactly as safe as it already was; the new branch is a bare
-- same-table column comparison plus a single-hop function call,
-- carrying zero additional recursion risk.
drop policy if exists "Case participants can view shelter referrals" on public.shelter_referrals;
create policy "Case participants can view shelter referrals"
  on public.shelter_referrals for select
  using (
    public.owns_case(case_id)
    or public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
  );

drop policy if exists "Admins can update shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can update shelter referrals in scope"
  on public.shelter_referrals for update
  using (public.admin_can_access_case_active(case_id) or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id()))
  with check (public.admin_can_access_case_active(case_id) or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id()));

-- notifications: INSERT gains a shelter_admin branch via the
-- helper in section 5, so a shelter_admin can notify a survivor
-- on accept/decline/placement without needing any broader access.
drop policy if exists "Admins can send notifications in scope" on public.notifications;
create policy "Admins can send notifications in scope"
  on public.notifications for insert
  with check (public.admin_can_access_profile(profile_id) or public.shelter_admin_notification_allowed(profile_id));

-- ---------------------------------------------------------
-- 9. Column-scoped GRANTs. shelter_requests.reviewed_by/
--    reviewed_at/review_notes are NOT survivor-writable at the
--    grant level either way (redundant with the trigger, but
--    matches this schema's "defense in depth" discipline
--    elsewhere) — the trigger is what actually differentiates
--    survivor vs shelter_admin within this shared column list.
-- ---------------------------------------------------------
grant insert (municipality_id, shelter_name, address, contact_number, email, capacity, current_occupancy, latitude, longitude, services_available, is_active)
  on public.shelters to authenticated;
grant update (shelter_name, address, contact_number, email, capacity, current_occupancy, latitude, longitude, services_available, is_active)
  on public.shelters to authenticated;

grant select, insert on public.shelter_requests to authenticated;
grant update (status, reviewed_by, reviewed_at, review_notes) on public.shelter_requests to authenticated;

-- ---------------------------------------------------------
-- 10. Audit trigger — shelter_requests joins case_referrals'
--     treatment (an automatic trigger covers its request/
--     decision lifecycle) rather than shelter_referrals'
--     existing manual logAudit() convention, since it's a new
--     table with no existing TypeScript call sites to keep
--     consistent with.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_shelter_requests on public.shelter_requests;
create trigger trg_audit_shelter_requests after insert or update or delete on public.shelter_requests
  for each row execute procedure public.audit_row_change('request_id');

-- =========================================================
-- VERIFICATION — run these separately, after everything above,
-- to confirm the migration applied correctly. All read-only.
-- =========================================================

-- 1. Confirm 'shelter_admin' is a real enum label:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;

-- 2. Confirm every new/redefined policy exists:
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('shelters','shelter_requests','shelter_referrals','notifications')
--   order by tablename, cmd;

-- 3. Confirm service_role automatically picked up the new table
--    (module3b's `alter default privileges` should cover this —
--    verify rather than assume):
--   select has_table_privilege('service_role', 'public.shelter_requests', 'SELECT') as can_select,
--          has_table_privilege('service_role', 'public.shelter_requests', 'INSERT') as can_insert;

-- 4. Confirm the sensitive columns are never in an authenticated
--    UPDATE grant that would let a client self-escalate (expect
--    ZERO rows):
--   select table_name, column_name
--   from information_schema.role_column_grants
--   where grantee = 'authenticated' and privilege_type = 'UPDATE'
--     and table_schema = 'public'
--     and (
--       (table_name = 'user_profiles' and column_name = 'shelter_id')
--       or (table_name = 'shelters' and column_name in ('shelter_name','address','latitude','longitude','municipality_id'))
--     );

-- 5. Confirm the audit trigger fires:
--   select * from audit_logs where table_name = 'shelter_requests' order by created_at desc limit 5;

-- =========================================================
-- SafeHer — Module 7: Shelter Staff role + request/referral
-- assignment (Foundational phase)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, module1b_grants_and_survivors_rls.sql,
-- module2_case_data_rls.sql, module3_barangay_hierarchy.sql,
-- module3b_service_role_grants.sql, module4_shelter_admin.sql,
-- module5_sos_location_accuracy.sql, and module6_ai_support.sql.
--
-- IMPORTANT — two-part file, same reason as module3/module4/module6:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- SCOPE — this file adds staff-to-request/referral ASSIGNMENT within
-- a shelter that already knows which shelter owns a request. It
-- deliberately does NOT touch shelter_requests.shelter_id or
-- shelter_referrals.shelter_id (both remain NOT NULL, unchanged) —
-- inspection confirmed the current system already requires the
-- survivor (direct request) or referring agency (referral) to choose
-- a specific shelter at submission time; there is no "undesignated
-- request pool" in the existing schema or mobile flow to route from.
-- Building one (relaxing those NOT NULL constraints, reworking the
-- mobile shelter-request form, adding a province/municipal-level
-- designation queue) is a separate, substantially larger feature and
-- is deliberately deferred, not attempted here.
--
-- ROLE DECISION — `shelter_staff` is a new, standalone role (Part A),
-- deliberately NOT folded into is_admin() (mirrors the support_expert
-- precedent from module6): it's an operational role scoped to one
-- shelter's day-to-day request handling, with strictly less privilege
-- than shelter_admin (no shelter management, no capacity/services
-- edits, no staff creation — see the brief's own restriction list).
--
-- RLS RECURSION SAFETY — every new/extended policy below is
-- single-hop: direct column comparisons on the row being evaluated,
-- or a helper (current_role/current_profile_id/current_shelter_id)
-- that only ever reads user_profiles. No helper here queries
-- shelter_requests or shelter_referrals, so nothing added by this
-- file can cycle back into the table whose policy is calling it.
--
-- PRIVILEGE MODEL — assigned_staff_id is settable by a shelter_admin
-- (only to a shelter_staff member of THEIR OWN shelter, enforced by
-- trigger) and is read-only for shelter_staff themselves (they can
-- see it, including on their own assigned rows, but cannot change it
-- — no self- or re-assignment). This is the same column-
-- differentiation-via-trigger technique already used throughout this
-- schema (validate_shelter_update, validate_expert_support_request_
-- update, etc.) because the column GRANT itself is role-wide, not
-- caller-specific.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column if not exists) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'shelter_staff';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 0. FIX — validate_user_profile_shelter() (originally defined in
--    module4_shelter_admin.sql) only ever permitted shelter_id to be
--    set for role = 'shelter_admin'; any other role with a non-null
--    shelter_id hit its `elsif new.shelter_id is not null` branch and
--    was unconditionally rejected. That branch predates shelter_staff
--    existing at all (module4 ran before this file), so it was never
--    updated for the new role introduced by Part A above — meaning
--    create-admin-user's shelter_staff path (which sets shelter_id on
--    the new profile) would raise 'shelter_id may only be set for
--    shelter_admin profiles' on every attempt, blocking shelter_staff
--    account creation entirely. Fixed here via create-or-replace
--    (this function was never redefined after module4, so this is a
--    correction to a live, already-deployed function, not historical
--    module4 file's text itself — module4_shelter_admin.sql is left
--    untouched). Security purpose preserved: shelter_id remains
--    settable ONLY for the two shelter-scoped roles, still validated
--    against the profile's own municipality_id; every other role is
--    still rejected exactly as before.
-- ---------------------------------------------------------
create or replace function public.validate_user_profile_shelter()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role in ('shelter_admin', 'shelter_staff') then
    if new.shelter_id is null then
      raise exception '% profiles must have shelter_id set', new.role;
    end if;
    if not exists (
      select 1 from public.shelters sh
      where sh.shelter_id = new.shelter_id and sh.municipality_id = new.municipality_id
    ) then
      raise exception 'shelter_id must belong to the profile''s own municipality_id';
    end if;
  elsif new.shelter_id is not null then
    raise exception 'shelter_id may only be set for shelter_admin or shelter_staff profiles';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 1. shelter_requests / shelter_referrals — add the assignment
--    column. Nullable: an unassigned request/referral is a normal,
--    valid state (the shelter_admin hasn't handed it to anyone yet).
-- ---------------------------------------------------------
alter table public.shelter_requests add column if not exists assigned_staff_id uuid references public.user_profiles(profile_id);
alter table public.shelter_referrals add column if not exists assigned_staff_id uuid references public.user_profiles(profile_id);

create index if not exists idx_shelter_requests_assigned_staff on public.shelter_requests(assigned_staff_id) where assigned_staff_id is not null;
create index if not exists idx_shelter_referrals_assigned_staff on public.shelter_referrals(assigned_staff_id) where assigned_staff_id is not null;

-- ---------------------------------------------------------
-- 2. Helper function.
-- ---------------------------------------------------------
create or replace function public.is_shelter_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where auth_user_id = auth.uid() and role = 'shelter_staff'
  );
$$;

-- ---------------------------------------------------------
-- 3. Column-differentiation triggers for assigned_staff_id, and
--    extended authorization for shelter_staff's own updates.
-- ---------------------------------------------------------

-- Replaces the module4 version — adds a shelter_staff branch (may
-- update only a row currently assigned to them, and may never touch
-- assigned_staff_id itself) and validates that whenever a
-- shelter_admin sets assigned_staff_id, the target is actually a
-- shelter_staff member of that SAME shelter. The pre-existing
-- shelter_admin and survivor branches are unchanged.
create or replace function public.validate_shelter_request_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'shelter_admin' then
    if new.assigned_staff_id is distinct from old.assigned_staff_id and new.assigned_staff_id is not null then
      if not exists (
        select 1 from public.user_profiles
        where profile_id = new.assigned_staff_id and role = 'shelter_staff' and shelter_id = old.shelter_id
      ) then
        raise exception 'assigned_staff_id must be a shelter_staff member of this shelter';
      end if;
    end if;
    return new;
  elsif public.current_role() = 'shelter_staff' then
    if old.assigned_staff_id is distinct from public.current_profile_id() then
      raise exception 'Not authorized to update this shelter request';
    end if;
    if new.assigned_staff_id is distinct from old.assigned_staff_id then
      raise exception 'Shelter staff cannot reassign a request';
    end if;
    if new.shelter_id is distinct from old.shelter_id then
      raise exception 'Shelter staff cannot change the shelter association';
    end if;
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

-- shelter_referrals never had a validation trigger before this file —
-- both of its previous actors (a referring agency admin via
-- admin_can_access_case_active, and shelter_admin) were both
-- "admin-tier" callers RLS alone was trusted to gate, with no column
-- differentiation needed. Introducing shelter_staff (a genuinely
-- lower-privilege third actor) requires one now, for the same reason
-- shelter_requests already had one.
create or replace function public.validate_shelter_referral_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'shelter_staff' then
    if old.assigned_staff_id is distinct from public.current_profile_id() then
      raise exception 'Not authorized to update this shelter referral';
    end if;
    if new.assigned_staff_id is distinct from old.assigned_staff_id then
      raise exception 'Shelter staff cannot reassign a referral';
    end if;
    if new.shelter_id is distinct from old.shelter_id then
      raise exception 'Shelter staff cannot change the shelter association';
    end if;
  elsif public.current_role() = 'shelter_admin' then
    if new.assigned_staff_id is distinct from old.assigned_staff_id and new.assigned_staff_id is not null then
      if not exists (
        select 1 from public.user_profiles
        where profile_id = new.assigned_staff_id and role = 'shelter_staff' and shelter_id = old.shelter_id
      ) then
        raise exception 'assigned_staff_id must be a shelter_staff member of this shelter';
      end if;
    end if;
  end if;
  -- Referring-agency admins (admin_can_access_case_active) fall through
  -- with no extra restriction here, matching this table's existing
  -- (pre-shelter_staff) trust model for that path — unchanged.
  return new;
end;
$$;

drop trigger if exists trg_validate_shelter_request_update on public.shelter_requests;
create trigger trg_validate_shelter_request_update
  before update on public.shelter_requests
  for each row execute procedure public.validate_shelter_request_update();

drop trigger if exists trg_validate_shelter_referral_update on public.shelter_referrals;
create trigger trg_validate_shelter_referral_update
  before update on public.shelter_referrals
  for each row execute procedure public.validate_shelter_referral_update();

-- ---------------------------------------------------------
-- 4. Staff-assignment notifications — reuses the existing
--    'Assignment' notification_type (no new enum value needed).
-- ---------------------------------------------------------
create or replace function public.notify_on_shelter_request_staff_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_staff_id is not null and new.assigned_staff_id is distinct from old.assigned_staff_id then
    insert into public.notifications (profile_id, notification_type, title, message, is_read)
    values (new.assigned_staff_id, 'Assignment', 'New shelter request assigned to you', 'A shelter request has been assigned to you for review.', false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_shelter_request_staff_assignment on public.shelter_requests;
create trigger trg_notify_shelter_request_staff_assignment
  after update of assigned_staff_id on public.shelter_requests
  for each row execute procedure public.notify_on_shelter_request_staff_assignment();

create or replace function public.notify_on_shelter_referral_staff_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_staff_id is not null and new.assigned_staff_id is distinct from old.assigned_staff_id then
    insert into public.notifications (profile_id, notification_type, title, message, is_read)
    values (new.assigned_staff_id, 'Assignment', 'New agency referral assigned to you', 'An agency referral has been assigned to you for review.', false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_shelter_referral_staff_assignment on public.shelter_referrals;
create trigger trg_notify_shelter_referral_staff_assignment
  after update of assigned_staff_id on public.shelter_referrals
  for each row execute procedure public.notify_on_shelter_referral_staff_assignment();

-- ---------------------------------------------------------
-- 5. RLS — extend SELECT/UPDATE with a shelter_staff branch.
--    Read visibility is shelter-wide (situational awareness); write
--    access is restricted to rows currently assigned to them
--    (enforced redundantly by both this USING clause and the
--    trigger above — defense in depth, matching this schema's
--    established style).
-- ---------------------------------------------------------

drop policy if exists "Survivors and shelter staff can view shelter requests in scope" on public.shelter_requests;
create policy "Survivors and shelter staff can view shelter requests in scope"
  on public.shelter_requests for select
  using (
    profile_id = public.current_profile_id()
    or (public.current_role() in ('shelter_admin', 'shelter_staff') and shelter_id = public.current_shelter_id())
    or public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

drop policy if exists "Shelter requests updatable by survivor or shelter admin" on public.shelter_requests;
create policy "Shelter requests updatable by survivor or shelter admin"
  on public.shelter_requests for update
  using (
    profile_id = public.current_profile_id()
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
    or (public.current_role() = 'shelter_staff' and assigned_staff_id = public.current_profile_id())
  )
  with check (
    profile_id = public.current_profile_id()
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
    or (public.current_role() = 'shelter_staff' and assigned_staff_id = public.current_profile_id())
  );

drop policy if exists "Case participants can view shelter referrals" on public.shelter_referrals;
create policy "Case participants can view shelter referrals"
  on public.shelter_referrals for select
  using (
    public.owns_case(case_id)
    or public.admin_can_access_case_active(case_id)
    or (public.current_role() in ('shelter_admin', 'shelter_staff') and shelter_id = public.current_shelter_id())
  );

drop policy if exists "Admins can update shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can update shelter referrals in scope"
  on public.shelter_referrals for update
  using (
    public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
    or (public.current_role() = 'shelter_staff' and assigned_staff_id = public.current_profile_id())
  )
  with check (
    public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'shelter_admin' and shelter_id = public.current_shelter_id())
    or (public.current_role() = 'shelter_staff' and assigned_staff_id = public.current_profile_id())
  );

-- ---------------------------------------------------------
-- 6. Grants — assigned_staff_id added to both UPDATE grants (the
--    triggers above are what actually differentiate who may set it
--    to what, per this schema's established pattern).
-- ---------------------------------------------------------
grant update (status, reviewed_by, reviewed_at, review_notes, assigned_staff_id) on public.shelter_requests to authenticated;
grant update (referral_status, notes, assigned_staff_id) on public.shelter_referrals to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above,
-- to confirm the migration applied correctly. All read-only.
-- =========================================================

-- 0. Confirm validate_user_profile_shelter() now accepts shelter_staff:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'validate_user_profile_shelter';
--   Expect to see `if new.role in ('shelter_admin', 'shelter_staff') then`.

-- 1. Confirm 'shelter_staff' is a real enum label:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;

-- 2. Confirm the new columns exist:
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'public' and column_name = 'assigned_staff_id';

-- 3. Confirm every new/redefined policy exists:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename in ('shelter_requests', 'shelter_referrals')
--   order by tablename, cmd;

-- 4. RLS RECURSION TEST — run as an authenticated shelter_staff user
--    via the client (anon key + that user's access token):
--   select * from shelter_requests;
--   select * from shelter_referrals;
--   Expect real rows scoped to their own shelter (or empty sets) — NOT
--   "infinite recursion detected in policy" and NOT an unexpected 500.

-- 5. Cross-shelter isolation test — as Shelter Admin A, attempt:
--   select * from shelter_requests where shelter_id = '<Shelter B id>';
--   Expect zero rows.

-- 6. Staff self-assignment test — as a shelter_staff user with no
--    assignment on a given row, attempt:
--   update shelter_requests set assigned_staff_id = '<own profile_id>' where request_id = '<an unassigned request in their own shelter>';
--   Expect a permission/trigger rejection ("Shelter staff cannot
--   reassign a request" is only reachable once already assigned to
--   them, but an unassigned row's UPDATE USING clause won't even
--   match a shelter_staff caller in the first place — confirm 0 rows
--   affected / a permission error, not a silent success).

-- 7. Cross-shelter staff assignment test — as Shelter Admin A,
--    attempt to assign a Shelter B staff member to a Shelter A
--    request:
--   update shelter_requests set assigned_staff_id = '<Shelter B staff profile_id>' where request_id = '<Shelter A request>';
--   Expect trg_validate_shelter_request_update to raise "assigned_staff_id must be a shelter_staff member of this shelter".

-- =========================================================
-- SafeHer — Module 3: Barangay organizational hierarchy
-- (Phase 1 foundation: role, schema, case ownership/transfer
-- history, RLS isolation, real audit logging.)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, and module1b_grants_and_survivors_rls.sql,
-- and module2_case_data_rls.sql.
--
-- IMPORTANT — this file is split into two parts that MUST be
-- run as two SEPARATE executions ("Run" clicks) in the SQL
-- editor, in order. Postgres does not allow a newly-added enum
-- value to be referenced by anything else in the same
-- transaction/script that added it — running Part A and Part B
-- together in one script will fail with
-- "unsafe use of new value of enum type".
--
-- Everything in this file is idempotent (create or replace,
-- drop ... if exists + create, add column if not exists) and
-- safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'barangay_admin';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. barangays table (mirrors municipalities' shape)
-- ---------------------------------------------------------
create table if not exists public.barangays (
  barangay_id     uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(municipality_id),
  barangay_name   varchar(100) not null,
  contact_number  varchar(20),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (municipality_id, barangay_name)
);
create index if not exists idx_barangays_municipality on public.barangays(municipality_id);

-- ---------------------------------------------------------
-- 2. case_owner_level enum — which tier currently owns/is
--    actively handling a case. Deliberately separate from
--    case_reports.status: 'Referred' status already means
--    "referred to a shelter" in the existing UI
--    (CaseDetailPage.submitReferral) — reusing it here would
--    collide with that meaning. Title-Case values, matching
--    the rest of the schema's enum convention; the admin UI
--    displays 'Municipality' as "MSWDO" and 'Province' as
--    "PSWDO" (there's no separate provinces table — Province
--    here just means "escalated to the provincial tier").
-- ---------------------------------------------------------
do $$ begin
  create type case_owner_level as enum ('Barangay', 'Municipality', 'Province');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- 3. case_reports ownership columns.
--    municipality_id (existing, NOT NULL) stays the permanent
--    geographic anchor and never changes as a case escalates —
--    only owner_level/owner_barangay_id do. Every existing case
--    backfills to 'Municipality', which is exactly the tier
--    that already effectively owns it today (via
--    municipal_admin/provincial_admin RLS scoping) — zero
--    behavior change for the two existing admin roles.
-- ---------------------------------------------------------
alter table public.case_reports
  add column if not exists owner_level case_owner_level not null default 'Municipality',
  add column if not exists owner_barangay_id uuid references public.barangays(barangay_id);

-- ---------------------------------------------------------
-- 4. user_profiles.barangay_id — set only for barangay_admin
--    profiles (enforced by the trigger in section 6).
-- ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists barangay_id uuid references public.barangays(barangay_id);

-- ---------------------------------------------------------
-- 5. case_referrals — the single mechanism for BOTH "formal
--    referral/escalation between org tiers" and "case
--    ownership transfer history". Deliberately one table, not
--    two overlapping ones: every escalation IS an ownership
--    transfer, and every ownership transfer happens via a
--    referral action.
--
--    status reuses the EXISTING referral_status enum
--    ('Pending'/'Accepted'/'Declined'/'Completed') rather than
--    inventing a new one. Phase 1's UI always inserts
--    status = 'Completed' — an immediate, admin-authoritative
--    transfer with no accept/reject step (that's part of the
--    referral-UI-polish explicitly deferred to Phase 2).
--    responded_by/responded_at stay null in Phase 1; they exist
--    now so Phase 2's accept/reject workflow needs zero further
--    schema migration.
-- ---------------------------------------------------------
create table if not exists public.case_referrals (
  referral_id       uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.case_reports(case_id) on delete cascade,
  from_level        case_owner_level not null,
  from_barangay_id  uuid references public.barangays(barangay_id),
  to_level          case_owner_level not null,
  to_barangay_id    uuid references public.barangays(barangay_id),
  referred_by       uuid not null references public.user_profiles(profile_id),
  reason            text,
  status            referral_status not null default 'Completed',
  responded_by      uuid references public.user_profiles(profile_id),
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint case_referrals_from_barangay_consistency
    check ((from_level = 'Barangay' and from_barangay_id is not null)
        or (from_level <> 'Barangay' and from_barangay_id is null)),
  constraint case_referrals_to_barangay_consistency
    check ((to_level = 'Barangay' and to_barangay_id is not null)
        or (to_level <> 'Barangay' and to_barangay_id is null)),
  constraint case_referrals_distinct_transfer
    check ((to_level, to_barangay_id) is distinct from (from_level, from_barangay_id))
);
create index if not exists idx_case_referrals_case on public.case_referrals(case_id);

-- ---------------------------------------------------------
-- 6. Integrity triggers — keep barangay/municipality
--    relationships consistent regardless of what inserts them.
-- ---------------------------------------------------------
create or replace function public.validate_user_profile_barangay()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'barangay_admin' then
    if new.barangay_id is null then
      raise exception 'barangay_admin profiles must have barangay_id set';
    end if;
    if not exists (
      select 1 from public.barangays b
      where b.barangay_id = new.barangay_id and b.municipality_id = new.municipality_id
    ) then
      raise exception 'barangay_id must belong to the profile''s own municipality_id';
    end if;
  elsif new.barangay_id is not null then
    raise exception 'barangay_id may only be set for barangay_admin profiles';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_user_profile_barangay on public.user_profiles;
create trigger trg_validate_user_profile_barangay
  before insert or update of role, municipality_id, barangay_id on public.user_profiles
  for each row execute procedure public.validate_user_profile_barangay();

create or replace function public.validate_case_owner_barangay()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.owner_barangay_id is not null and not exists (
    select 1 from public.barangays b
    where b.barangay_id = new.owner_barangay_id and b.municipality_id = new.municipality_id
  ) then
    raise exception 'owner_barangay_id must belong to the case''s municipality';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_case_owner_barangay on public.case_reports;
create trigger trg_validate_case_owner_barangay
  before insert or update of owner_level, owner_barangay_id on public.case_reports
  for each row execute procedure public.validate_case_owner_barangay();

create or replace function public.validate_case_referral()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_muni uuid;
begin
  select municipality_id into v_muni from public.case_reports where case_id = new.case_id;

  if new.to_barangay_id is not null and not exists (
    select 1 from public.barangays b where b.barangay_id = new.to_barangay_id and b.municipality_id = v_muni
  ) then
    raise exception 'to_barangay_id must belong to the case''s municipality';
  end if;

  if new.from_barangay_id is not null and not exists (
    select 1 from public.barangays b where b.barangay_id = new.from_barangay_id and b.municipality_id = v_muni
  ) then
    raise exception 'from_barangay_id must belong to the case''s municipality';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_case_referral on public.case_referrals;
create trigger trg_validate_case_referral
  before insert on public.case_referrals
  for each row execute procedure public.validate_case_referral();

-- ---------------------------------------------------------
-- 7. Ownership-apply trigger — the ONLY code path that ever
--    changes case_reports.owner_level/owner_barangay_id.
--    Never a direct client UPDATE (see the grants in section
--    10 — those columns are never client-writable).
-- ---------------------------------------------------------
create or replace function public.apply_case_referral()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'Completed' then
    update public.case_reports
    set owner_level = new.to_level,
        owner_barangay_id = new.to_barangay_id,
        updated_at = now()
    where case_id = new.case_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_case_referral_insert on public.case_referrals;
create trigger trg_apply_case_referral_insert
  after insert on public.case_referrals
  for each row execute procedure public.apply_case_referral();

-- Forward-compatible for Phase 2's accept/reject flow; Phase 1's
-- UI always inserts status='Completed' directly, so this never
-- fires yet — kept here so Phase 2 needs no further migration.
drop trigger if exists trg_apply_case_referral_update on public.case_referrals;
create trigger trg_apply_case_referral_update
  after update of status on public.case_referrals
  for each row
  when (new.status = 'Completed' and old.status is distinct from 'Completed')
  execute procedure public.apply_case_referral();

-- ---------------------------------------------------------
-- 8. RLS helper functions — same SECURITY DEFINER STABLE
--    pattern as module2_case_data_rls.sql, to avoid RLS
--    self-recursion on user_profiles.
-- ---------------------------------------------------------
create or replace function public.current_barangay_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select barangay_id from public.user_profiles where auth_user_id = auth.uid();
$$;

create or replace function public.is_barangay_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where auth_user_id = auth.uid() and role = 'barangay_admin'
  );
$$;

-- Redefined (create or replace, idempotent) to recognize the
-- new tier — every existing caller of is_admin() gets barangay
-- admins included automatically.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('municipal_admin', 'provincial_admin', 'super_admin', 'barangay_admin')
  );
$$;

-- BROAD — true for the case's CURRENT owner tier, OR any org
-- (municipality/barangay) that has ever appeared in the case's
-- referral chain. Used by case_status_history's SELECT policy.
-- Redefines module2's original admin_can_access_case — for
-- municipal_admin/provincial_admin this is IDENTICAL to before
-- (zero behavior change); only barangay_admin's branch is new.
--
-- Do NOT call this from case_referrals', survivors', or
-- user_profiles' OWN policies — it queries case_referrals
-- internally, and SECURITY DEFINER does not bypass RLS in this
-- project (the function-owning role has no BYPASSRLS/superuser,
-- verified empirically — `set row_security = off` below has no
-- effect for a non-owner, non-superuser role, it only changes
-- error-vs-silent-bypass behavior for roles that already bypass).
-- Calling it from one of those policies re-enters a relation
-- that's still being expanded, which Postgres reports as "infinite
-- recursion detected in policy for relation ...". See the
-- case_referrals/survivors/user_profiles policy definitions below
-- for the actual (structural) fix.
create or replace function public.admin_can_access_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select
    public.is_provincial_admin()
    or exists (
      select 1 from public.case_reports cr
      where cr.case_id = p_case_id
        and public.current_role() = 'municipal_admin'
        and cr.municipality_id = public.current_municipality_id()
    )
    or (
      public.current_role() = 'barangay_admin'
      and exists (
        select 1 from public.case_reports cr
        where cr.case_id = p_case_id
          and (
            (cr.owner_level = 'Barangay' and cr.owner_barangay_id = public.current_barangay_id())
            or exists (
              select 1 from public.case_referrals cref
              where cref.case_id = cr.case_id
                and (cref.from_barangay_id = public.current_barangay_id()
                  or cref.to_barangay_id = public.current_barangay_id())
            )
          )
      )
    );
$$;

-- NARROW — true only for the case's CURRENT active owner tier,
-- no past-owner clause. Used everywhere a WRITE, or an
-- operationally-sensitive read (assignments/evidence/shelter
-- referrals), is gated: case_reports UPDATE, case_status_history
-- INSERT, case_assignments SELECT/INSERT, evidence SELECT/
-- INSERT, shelter_referrals SELECT/INSERT/UPDATE. For
-- municipal_admin/provincial_admin this is IDENTICAL to
-- admin_can_access_case — zero behavior change for those roles.
-- Unlike admin_can_access_case (broad), this one never touches
-- case_referrals, so it's the one safe to call from case_referrals'
-- own SELECT policy (see below) without re-entering that table.
create or replace function public.admin_can_access_case_active(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select
    public.is_provincial_admin()
    or exists (
      select 1 from public.case_reports cr
      where cr.case_id = p_case_id
        and public.current_role() = 'municipal_admin'
        and cr.municipality_id = public.current_municipality_id()
    )
    or exists (
      select 1 from public.case_reports cr
      where cr.case_id = p_case_id
        and public.current_role() = 'barangay_admin'
        and cr.owner_level = 'Barangay'
        and cr.owner_barangay_id = public.current_barangay_id()
    );
$$;

-- Redefined: the municipal branch now explicitly requires
-- role = 'municipal_admin' (closing a latent gap where a
-- barangay_admin's populated municipality_id would otherwise
-- silently match the old unconditional check), plus a new
-- barangay branch scoped to survivors tied to an accessible case.
-- Used by sos_alerts' SELECT/UPDATE policies only — deliberately
-- NOT called from user_profiles' own SELECT policy (it queries
-- user_profiles internally, which would re-enter that table while
-- it's still being expanded; see the note on that policy below).
create or replace function public.admin_can_access_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select
    public.is_provincial_admin()
    or exists (
      select 1 from public.user_profiles up
      where up.profile_id = p_profile_id
        and public.current_role() = 'municipal_admin'
        and up.municipality_id = public.current_municipality_id()
    )
    or (
      public.current_role() = 'barangay_admin'
      and exists (
        select 1 from public.survivors s
        join public.case_reports cr on cr.survivor_id = s.survivor_id
        where s.profile_id = p_profile_id and public.admin_can_access_case(cr.case_id)
      )
    );
$$;

-- Authorization gate for INSERT into case_referrals: the
-- from_* pair in the new row must match the case's CURRENT
-- owner (no fabricated history), and the caller must currently
-- hold that owner tier. Only touches case_reports (via
-- admin_can_access_case_active-equivalent inline checks), never
-- case_referrals itself, so it's safe to call from case_referrals'
-- own INSERT policy.
create or replace function public.can_refer_case(
  p_case_id uuid, p_from_level case_owner_level, p_from_barangay_id uuid
) returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select
    exists (
      select 1 from public.case_reports cr
      where cr.case_id = p_case_id
        and cr.owner_level = p_from_level
        and cr.owner_barangay_id is not distinct from p_from_barangay_id
    )
    and (
      public.is_provincial_admin()
      or (
        public.current_role() = 'municipal_admin' and p_from_level = 'Municipality'
        and exists (select 1 from public.case_reports cr where cr.case_id = p_case_id and cr.municipality_id = public.current_municipality_id())
      )
      or (
        public.current_role() = 'barangay_admin' and p_from_level = 'Barangay'
        and p_from_barangay_id = public.current_barangay_id()
      )
    );
$$;

-- ---------------------------------------------------------
-- 9. RLS — barangays table.
-- ---------------------------------------------------------
alter table public.barangays enable row level security;

drop policy if exists "Authenticated users can view active barangays" on public.barangays;
create policy "Authenticated users can view active barangays"
  on public.barangays for select
  using (is_active = true or public.is_admin());

drop policy if exists "Municipal and provincial admins can create barangays in scope" on public.barangays;
create policy "Municipal and provincial admins can create barangays in scope"
  on public.barangays for insert
  with check (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

drop policy if exists "Municipal and provincial admins can update barangays in scope" on public.barangays;
create policy "Municipal and provincial admins can update barangays in scope"
  on public.barangays for update
  using (public.is_provincial_admin() or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id()))
  with check (public.is_provincial_admin() or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id()));

-- ---------------------------------------------------------
-- 10. RLS — case_referrals table.
-- ---------------------------------------------------------
alter table public.case_referrals enable row level security;

-- IMPORTANT: this policy must NOT call admin_can_access_case()
-- (broad) — that function queries case_referrals internally (for
-- its own past-owner check), and SECURITY DEFINER does NOT bypass
-- RLS in this project (the function-owning role has no BYPASSRLS/
-- superuser — verified empirically; `set row_security = off` on
-- the function has no effect for a non-owner, non-superuser role,
-- it only changes error-vs-silent-bypass behavior for roles that
-- already bypass). Calling admin_can_access_case() here creates a
-- direct self-cycle (case_referrals -> admin_can_access_case ->
-- case_referrals) that Postgres reports as "infinite recursion
-- detected in policy for relation case_reports/case_referrals".
-- Use the case_referrals-free admin_can_access_case_active for
-- current ownership, plus a direct (subquery-free) check against
-- THIS row's own from/to_barangay_id for past-party visibility.
drop policy if exists "Case participants can view referral history" on public.case_referrals;
create policy "Case participants can view referral history"
  on public.case_referrals for select
  using (
    public.owns_case(case_id)
    or public.admin_can_access_case_active(case_id)
    or (public.current_role() = 'barangay_admin'
        and (from_barangay_id = public.current_barangay_id() or to_barangay_id = public.current_barangay_id()))
  );

drop policy if exists "Authorized org can create case referrals" on public.case_referrals;
create policy "Authorized org can create case referrals"
  on public.case_referrals for insert
  with check (referred_by = public.current_profile_id() and public.can_refer_case(case_id, from_level, from_barangay_id));

-- No update/delete policy — immutable history, same discipline
-- as case_status_history.

-- ---------------------------------------------------------
-- 11. RLS — extend existing tables with a barangay_admin
--     branch. Redefines each policy in full (drop + create);
--     the municipal_admin/provincial_admin branches are copied
--     verbatim from module2_case_data_rls.sql — unchanged.
-- ---------------------------------------------------------

-- user_profiles
--
-- NO barangay_admin branch here — deliberately. Any branch that
-- queries survivors/case_reports (even via admin_can_access_profile)
-- creates a multi-hop cycle back to user_profiles, because those
-- tables' own policies read user_profiles again (for
-- is_provincial_admin()/current_role()/current_municipality_id()
-- checks) while user_profiles is still being expanded as the outer
-- relation — Postgres reports this as "infinite recursion detected
-- in policy for relation survivors" (verified empirically: a
-- single-hop self-read, e.g. is_provincial_admin() called directly
-- inline here, is fine; a path that leaves user_profiles for
-- another table and comes back is not). Known Phase 1 limitation:
-- a barangay_admin cannot view other profiles' rows (including a
-- survivor's own profile) through this policy — CaseDetailPage
-- shows "Survivor details unavailable" for barangay-owned cases
-- until a dedicated, parameter-only RPC is built for this in a
-- later phase.
drop policy if exists "Admins can view profiles in scope" on public.user_profiles;
create policy "Admins can view profiles in scope"
  on public.user_profiles for select
  using (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );
-- "Admins can update profile status in scope" (UPDATE) is left
-- exactly as module2 defined it — no barangay_admin branch,
-- there is nobody for them to manage in Phase 1.

-- survivors
--
-- NO barangay_admin branch here either — same reasoning as
-- user_profiles above, but the concrete cycle is more direct: the
-- old barangay branch called admin_can_access_case(), which queries
-- case_reports, and case_reports has a pre-existing, unrelated
-- "Survivors can view own cases" SELECT policy that queries
-- survivors back (survivor_id IN (select ... from survivors where
-- profile_id = current_profile_id())) — a direct 2-hop cycle
-- (survivors -> case_reports -> survivors), verified empirically as
-- "infinite recursion detected in policy for relation survivors".
drop policy if exists "Admins can view survivors in scope" on public.survivors;
create policy "Admins can view survivors in scope"
  on public.survivors for select
  using (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
  );

-- case_reports
--
-- The barangay branch here is intentionally CURRENT-OWNERSHIP ONLY
-- (no case_referrals lookup) — a past-referral-history subquery into
-- case_referrals would require expanding case_referrals' own SELECT
-- policy, which (even in its fixed form above) queries case_reports
-- again via admin_can_access_case_active(), re-entering case_reports
-- while it's still being expanded here. Known Phase 1 limitation: a
-- barangay that refers a case away can still see the case_referrals
-- history ROW (via that table's own from/to_barangay_id check) but
-- no longer the full case_reports record once ownership has moved on
-- — CaseListPage/CaseDetailPage simply stop listing/opening it,
-- which is safe (no dead links), just narrower than originally
-- planned.
drop policy if exists "Admins can view cases in scope" on public.case_reports;
create policy "Admins can view cases in scope"
  on public.case_reports for select
  using (
    public.is_provincial_admin()
    or (public.current_role() = 'municipal_admin' and municipality_id = public.current_municipality_id())
    or (public.current_role() = 'barangay_admin' and owner_level = 'Barangay' and owner_barangay_id = public.current_barangay_id())
  );

drop policy if exists "Admins can update case status in scope" on public.case_reports;
create policy "Admins can update case status in scope"
  on public.case_reports for update
  using (public.admin_can_access_case_active(case_id))
  with check (public.admin_can_access_case_active(case_id));

-- case_status_history
drop policy if exists "Case participants can view status history" on public.case_status_history;
create policy "Case participants can view status history"
  on public.case_status_history for select
  using (public.owns_case(case_id) or public.admin_can_access_case(case_id));

drop policy if exists "Case participants can insert status history" on public.case_status_history;
create policy "Case participants can insert status history"
  on public.case_status_history for insert
  with check ((public.owns_case(case_id) or public.admin_can_access_case_active(case_id)) and changed_by = public.current_profile_id());

-- case_assignments
drop policy if exists "Admins can view assignments in scope" on public.case_assignments;
create policy "Admins can view assignments in scope"
  on public.case_assignments for select using (public.admin_can_access_case_active(case_id));

drop policy if exists "Admins can insert assignments in scope" on public.case_assignments;
create policy "Admins can insert assignments in scope"
  on public.case_assignments for insert
  with check (public.admin_can_access_case_active(case_id) and assigned_by = public.current_profile_id());

-- shelter_referrals
drop policy if exists "Case participants can view shelter referrals" on public.shelter_referrals;
create policy "Case participants can view shelter referrals"
  on public.shelter_referrals for select using (public.owns_case(case_id) or public.admin_can_access_case_active(case_id));

drop policy if exists "Admins can insert shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can insert shelter referrals in scope"
  on public.shelter_referrals for insert
  with check (public.admin_can_access_case_active(case_id) and referred_by = public.current_profile_id());

drop policy if exists "Admins can update shelter referrals in scope" on public.shelter_referrals;
create policy "Admins can update shelter referrals in scope"
  on public.shelter_referrals for update using (public.admin_can_access_case_active(case_id)) with check (public.admin_can_access_case_active(case_id));

-- evidence
drop policy if exists "Case participants can view evidence" on public.evidence;
create policy "Case participants can view evidence"
  on public.evidence for select using (public.owns_case(case_id) or public.admin_can_access_case_active(case_id));

drop policy if exists "Case participants can insert evidence" on public.evidence;
create policy "Case participants can insert evidence"
  on public.evidence for insert
  with check ((public.owns_case(case_id) or public.admin_can_access_case_active(case_id)) and uploaded_by = public.current_profile_id());

-- ---------------------------------------------------------
-- 12. Column-scoped GRANTs — same discipline as module1b/
--     module2: sensitive columns are never blanket-grantable.
--     case_reports.owner_level/owner_barangay_id and
--     user_profiles.barangay_id are DELIBERATELY absent from
--     every grant below (and from case_reports'/user_profiles'
--     EXISTING grants, which are untouched) — they're settable
--     only by the apply_case_referral trigger, the
--     create-admin-user Edge Function (service role), or
--     manual SQL.
-- ---------------------------------------------------------
grant select on public.barangays to authenticated;
grant insert (municipality_id, barangay_name, contact_number, is_active) on public.barangays to authenticated;
grant update (barangay_name, contact_number, is_active) on public.barangays to authenticated;

grant select, insert on public.case_referrals to authenticated;
-- No update/delete grant: immutable history, like case_status_history.

-- service_role (used only by the create-admin-user Edge Function's admin
-- client) does NOT automatically inherit table privileges just from
-- bypassing RLS — GRANT and RLS are separate layers, and unlike the
-- original module1/module2 tables, these two brand-new tables never picked
-- up service_role's usual default privileges. Confirmed by a live 42501
-- "permission denied for table barangays" error from the deployed
-- function: barangay_admin account creation looks up the barangay row via
-- the service-role client, and update/insert are included so the
-- Edge Function (or any future service-role caller) isn't blocked there
-- either.
grant select, insert, update on public.barangays to service_role;
grant select, insert on public.case_referrals to service_role;

-- ---------------------------------------------------------
-- 13. Generic audit trigger — closes the gap where nothing
--     auto-populates audit_logs today (the only prior writer
--     is the create-admin-user Edge Function, one manual
--     insert, old_values never populated). Attached only to
--     tables where privilege, geographic scope, or case
--     ownership actually change — NOT evidence/shelter_
--     referrals/notifications/sos_alerts, which keep their
--     existing manual logAudit() calls unchanged.
--
--     profile_id is current_profile_id(), which is null for
--     service-role-executed writes (no auth.uid() on that
--     connection) — audit_logs.profile_id is nullable, so this
--     is expected, not an error. create-admin-user's own manual
--     audit_logs insert (which DOES know the calling admin) is
--     kept as-is; accept one intentional extra trigger-fired row
--     there rather than losing that attribution.
-- ---------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_record_id uuid;
begin
  if tg_op = 'DELETE' then
    v_record_id := (to_jsonb(old) ->> tg_argv[0])::uuid;
  else
    v_record_id := (to_jsonb(new) ->> tg_argv[0])::uuid;
  end if;

  insert into public.audit_logs (profile_id, action, table_name, record_id, old_values, new_values)
  values (
    public.current_profile_id(),
    tg_op,
    tg_table_name,
    v_record_id,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_user_profiles on public.user_profiles;
create trigger trg_audit_user_profiles after insert or update or delete on public.user_profiles
  for each row execute procedure public.audit_row_change('profile_id');

drop trigger if exists trg_audit_barangays on public.barangays;
create trigger trg_audit_barangays after insert or update or delete on public.barangays
  for each row execute procedure public.audit_row_change('barangay_id');

drop trigger if exists trg_audit_municipalities on public.municipalities;
create trigger trg_audit_municipalities after insert or update or delete on public.municipalities
  for each row execute procedure public.audit_row_change('municipality_id');

drop trigger if exists trg_audit_case_reports on public.case_reports;
create trigger trg_audit_case_reports after insert or update or delete on public.case_reports
  for each row execute procedure public.audit_row_change('case_id');

drop trigger if exists trg_audit_case_assignments on public.case_assignments;
create trigger trg_audit_case_assignments after insert or update or delete on public.case_assignments
  for each row execute procedure public.audit_row_change('assignment_id');

drop trigger if exists trg_audit_case_referrals on public.case_referrals;
create trigger trg_audit_case_referrals after insert or update or delete on public.case_referrals
  for each row execute procedure public.audit_row_change('referral_id');

-- =========================================================
-- VERIFICATION — run these separately, after everything above,
-- to confirm the migration applied correctly. All read-only.
-- =========================================================

-- 1. Confirm 'barangay_admin' is a real enum label:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;

-- 2. Confirm every new/redefined policy exists:
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('barangays','case_referrals','user_profiles','survivors',
--                        'case_reports','case_status_history','case_assignments',
--                        'shelter_referrals','evidence')
--   order by tablename, cmd;

-- 3. Confirm the sensitive columns are NEVER in an authenticated
--    UPDATE grant (expect ZERO rows):
--   select table_name, column_name
--   from information_schema.role_column_grants
--   where grantee = 'authenticated' and privilege_type = 'UPDATE'
--     and table_schema = 'public'
--     and (
--       (table_name = 'case_reports' and column_name in ('owner_level','owner_barangay_id'))
--       or (table_name = 'user_profiles' and column_name = 'barangay_id')
--     );

-- 4. Confirm the audit trigger fires (expect a fresh row after
--    inserting/updating a test municipality or barangay):
--   select * from audit_logs order by created_at desc limit 5;

-- 5. Confirm every trigger from this file is installed:
--   select tgname, tgrelid::regclass from pg_trigger
--   where tgname like 'trg_%barangay%' or tgname like 'trg_audit_%' or tgname like 'trg_apply_case_referral%'
--   order by tgname;

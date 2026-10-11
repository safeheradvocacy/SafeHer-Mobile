-- =========================================================
-- SafeHer — Module 9: law_enforcement role + referral workflow
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module8_notifications_push.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- ROLE DECISION — law_enforcement is a new, standalone role,
-- deliberately assignment/referral-scoped rather than given any
-- municipality/province/"unit" jurisdiction column. A live, repo-wide
-- search for any existing law-enforcement/PNP organizational concept
-- (precinct, unit, station) found none — the only prior evidence is a
-- README note that the original ERD deliberately excluded a police
-- role, and an AI safety-message regex that *detects* the word
-- "police" in a survivor's text (not a role). Inventing a jurisdiction
-- hierarchy with no evidence behind it would be fabrication, and the
-- explicit design preference for this phase is narrower anyway:
-- access is granted per-referral, not by geography. A law_enforcement
-- profile's municipality_id/barangay_id/shelter_id all stay null,
-- mirroring the existing support_expert precedent ("carries no
-- jurisdiction at all").
--
-- ACCESS MODEL — a case or SOS alert becomes visible to a SPECIFIC
-- law_enforcement officer only once an authorized case-management
-- actor (whoever currently owns the case — municipal/provincial/
-- barangay admin) creates a law_enforcement_referrals row AND sets
-- assigned_officer_id to that officer. There is no shared "queue" a
-- law_enforcement account can browse — this is a deliberate, narrower
-- choice than the shelter_staff model (which does get shelter-wide
-- read visibility), because shelter_staff's wide-read boundary is a
-- real jurisdiction unit (their shelter); law_enforcement has no such
-- unit, so the only safe, non-fabricated boundary is "assigned to me,
-- specifically." A law_enforcement account can never set its own
-- assigned_officer_id (mirrors shelter_staff's self-assignment
-- prohibition exactly).
--
-- WHY A NEW TABLE, NOT A REUSED ONE — shelter_referrals was
-- considered and rejected: its shelter_id is NOT NULL and its
-- application logic bumps shelters.current_occupancy on acceptance —
-- reusing it for a conceptually different domain (an officer, not a
-- shelter, receiving a case) would either require weakening a live
-- NOT NULL constraint or misusing shelter-occupancy side effects for
-- something that has nothing to do with shelter capacity. case_referrals
-- was also rejected: it's an ownership-TRANSFER mechanism between
-- Barangay/Municipality/Province tiers (case_owner_level has exactly
-- those 3 values) — referring a case to law enforcement does not
-- transfer case ownership, it grants a parallel, narrower view to a
-- new kind of actor while the existing case-management tier keeps
-- full ownership and remains the only one who can change
-- case_reports.status. A new, small table — mirroring shelter_referrals'
-- shape closely for architectural consistency — is the smallest
-- correct structure.
--
-- RLS RECURSION SAFETY (read this before touching any policy below) —
-- case_reports/case_status_history/sos_alerts each need a new branch
-- granting the assigned officer visibility, but law_enforcement_referrals'
-- OWN policies call admin_can_access_case_active()/owns_case(), which
-- query case_reports. If case_reports' new branch queried
-- law_enforcement_referrals through its normal RLS-protected path, that
-- would close a real cycle (case_reports policy -> law_enforcement_referrals
-- policy -> case_reports policy again) and Postgres would reject it
-- with 42P17, exactly the failure mode module3 already documented and
-- avoided elsewhere in this schema. The fix is the same technique
-- already used by can_refer_case() in module3: two narrow helper
-- functions below (is_case_referred_to_officer, is_sos_referred_to_officer)
-- are declared `set row_security = off`, so their internal read of
-- law_enforcement_referrals bypasses that table's RLS entirely — they
-- only ever check one narrow condition (does a row exist assigning
-- THIS officer to THIS case/SOS), so bypassing RLS here cannot leak
-- anything beyond that yes/no fact.
--
-- SCOPE — law_enforcement never gains any access to `survivors` or
-- `user_profiles` beyond its own profile (deliberate data
-- minimization — the referring case-admin remains the point of
-- contact for identity/contact details), never gains access to
-- `evidence`, and is never added to is_admin() (mirrors the
-- support_expert precedent: an operational, narrowly-scoped role, not
-- a general administrator). law_enforcement never updates
-- case_reports.status directly — only their own referral row's status/
-- action fields; the referring tier keeps sole authority over the
-- case's overall status, exactly like every other referral in this
-- schema. SMS/automated calls are explicitly out of scope, unchanged.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/table if not exists) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'law_enforcement';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. law_enforcement_referrals — the smallest structure that
--    represents "this case/SOS has been made available to a specific,
--    assigned law-enforcement officer, who can record their own
--    action/status against it." Reuses the existing referral_status
--    enum (Pending/Accepted/Declined/Completed) rather than inventing
--    a new one. action_notes is deliberately plain free text, not a
--    constrained "action type" enum — no authoritative VAWC/PNP action
--    taxonomy exists anywhere in this codebase to draw one from, and
--    inventing one would be fabrication.
-- ---------------------------------------------------------
create table if not exists public.law_enforcement_referrals (
  referral_id uuid primary key default gen_random_uuid(),
  case_id uuid references public.case_reports(case_id) on delete cascade,
  sos_id uuid references public.sos_alerts(sos_id) on delete cascade,
  referred_by uuid not null references public.user_profiles(profile_id),
  assigned_officer_id uuid references public.user_profiles(profile_id),
  status referral_status not null default 'Pending',
  reason text,
  action_notes text,
  action_taken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint law_enforcement_referrals_target_check check (case_id is not null or sos_id is not null)
);

create index if not exists idx_law_enforcement_referrals_case on public.law_enforcement_referrals(case_id) where case_id is not null;
create index if not exists idx_law_enforcement_referrals_sos on public.law_enforcement_referrals(sos_id) where sos_id is not null;
create index if not exists idx_law_enforcement_referrals_officer on public.law_enforcement_referrals(assigned_officer_id) where assigned_officer_id is not null;

-- ---------------------------------------------------------
-- 2. Helper functions.
-- ---------------------------------------------------------
create or replace function public.is_law_enforcement()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where auth_user_id = auth.uid() and role = 'law_enforcement'
  );
$$;

-- Narrow, RLS-bypassing lookups — see the "RLS RECURSION SAFETY" note
-- at the top of this file for why `set row_security = off` is required
-- here specifically (same technique as can_refer_case() in module3).
create or replace function public.is_case_referred_to_officer(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select exists (
    select 1 from public.law_enforcement_referrals
    where case_id = p_case_id and assigned_officer_id = public.current_profile_id()
  );
$$;

create or replace function public.is_sos_referred_to_officer(p_sos_id uuid)
returns boolean
language sql stable security definer set search_path = public set row_security = off
as $$
  select exists (
    select 1 from public.law_enforcement_referrals
    where sos_id = p_sos_id and assigned_officer_id = public.current_profile_id()
  );
$$;

-- ---------------------------------------------------------
-- 3. Column-differentiation trigger for law_enforcement_referrals —
--    same established pattern as validate_shelter_request_update():
--    the referring case-admin chain may change anything (status,
--    assigned_officer_id, reason); the assigned officer may only
--    touch status/action_notes/action_taken_at, and only on a row
--    already assigned to them. Neither side can ever move a referral
--    between cases/SOS alerts after creation.
-- ---------------------------------------------------------
create or replace function public.validate_law_enforcement_referral_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'law_enforcement' then
    if old.assigned_officer_id is distinct from public.current_profile_id() then
      raise exception 'Not authorized to update this law-enforcement referral';
    end if;
    if new.assigned_officer_id is distinct from old.assigned_officer_id then
      raise exception 'Law enforcement cannot reassign this referral';
    end if;
    if new.case_id is distinct from old.case_id or new.sos_id is distinct from old.sos_id then
      raise exception 'Law enforcement cannot change what this referral targets';
    end if;
    if new.reason is distinct from old.reason then
      raise exception 'Law enforcement cannot edit the referral reason';
    end if;
    return new;
  elsif (new.case_id is not null and public.admin_can_access_case_active(new.case_id))
     or (new.sos_id is not null and public.admin_can_access_profile((select profile_id from public.sos_alerts where sos_id = new.sos_id)))
  then
    if new.assigned_officer_id is distinct from old.assigned_officer_id and new.assigned_officer_id is not null then
      if not exists (select 1 from public.user_profiles where profile_id = new.assigned_officer_id and role = 'law_enforcement') then
        raise exception 'assigned_officer_id must reference a law_enforcement profile';
      end if;
    end if;
    return new;
  else
    raise exception 'Not authorized to update this law-enforcement referral';
  end if;
end;
$$;

drop trigger if exists trg_validate_law_enforcement_referral_update on public.law_enforcement_referrals;
create trigger trg_validate_law_enforcement_referral_update
  before update on public.law_enforcement_referrals
  for each row execute procedure public.validate_law_enforcement_referral_update();

create or replace function public.touch_law_enforcement_referral_updated_at()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_law_enforcement_referrals_updated_at on public.law_enforcement_referrals;
create trigger trg_law_enforcement_referrals_updated_at
  before update on public.law_enforcement_referrals
  for each row execute procedure public.touch_law_enforcement_referral_updated_at();

-- ---------------------------------------------------------
-- 4. Notifications — reuses the existing 'Assignment' and 'Referral'
--    notification_type values (no new enum value needed). Push
--    dispatch for both is already covered by the generic
--    dispatch_push_for_notification trigger from module8 — no changes
--    needed there.
-- ---------------------------------------------------------
create or replace function public.notify_on_law_enforcement_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_officer_id is not null and new.assigned_officer_id is distinct from old.assigned_officer_id then
    insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
    values (
      new.assigned_officer_id, new.case_id, new.sos_id, 'Assignment',
      'New law-enforcement referral assigned to you',
      coalesce(new.reason, 'A case has been referred to you for authorized law-enforcement review.'),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_law_enforcement_assignment on public.law_enforcement_referrals;
create trigger trg_notify_law_enforcement_assignment
  after update of assigned_officer_id on public.law_enforcement_referrals
  for each row execute procedure public.notify_on_law_enforcement_assignment();

-- Also fires on INSERT, since a referring admin may set
-- assigned_officer_id at creation time rather than in a follow-up
-- update (AFTER UPDATE OF above only fires on updates).
create or replace function public.notify_on_law_enforcement_referral_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_officer_id is not null then
    insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
    values (
      new.assigned_officer_id, new.case_id, new.sos_id, 'Assignment',
      'New law-enforcement referral assigned to you',
      coalesce(new.reason, 'A case has been referred to you for authorized law-enforcement review.'),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_law_enforcement_referral_created on public.law_enforcement_referrals;
create trigger trg_notify_law_enforcement_referral_created
  after insert on public.law_enforcement_referrals
  for each row execute procedure public.notify_on_law_enforcement_referral_created();

-- Coordination: tell the referring admin when the assigned officer
-- records a status/action update — the one existing referral table
-- (shelter_referrals) was flagged in the system audit as UNABLE to do
-- this (it has no identifiable single admin recipient); here
-- referred_by is always a specific profile, so this gap doesn't repeat.
create or replace function public.notify_referrer_on_law_enforcement_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'law_enforcement' and (new.status is distinct from old.status or new.action_notes is distinct from old.action_notes) then
    insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
    values (
      new.referred_by, new.case_id, new.sos_id, 'Referral',
      'Law-enforcement update on your referral',
      'The assigned officer updated the status of a law-enforcement referral you made.',
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_referrer_on_law_enforcement_update on public.law_enforcement_referrals;
create trigger trg_notify_referrer_on_law_enforcement_update
  after update on public.law_enforcement_referrals
  for each row execute procedure public.notify_referrer_on_law_enforcement_update();

-- ---------------------------------------------------------
-- 5. Audit logging — matches the module3 generic-trigger pattern used
--    for every other privilege/ownership-relevant table.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_law_enforcement_referrals on public.law_enforcement_referrals;
create trigger trg_audit_law_enforcement_referrals
  after insert or update or delete on public.law_enforcement_referrals
  for each row execute procedure public.audit_row_change('referral_id');

-- ---------------------------------------------------------
-- 6. RLS.
-- ---------------------------------------------------------
alter table public.law_enforcement_referrals enable row level security;

drop policy if exists "Case participants can view law-enforcement referrals" on public.law_enforcement_referrals;
create policy "Case participants can view law-enforcement referrals"
  on public.law_enforcement_referrals for select
  using (
    (case_id is not null and (public.owns_case(case_id) or public.admin_can_access_case_active(case_id)))
    or (sos_id is not null and public.admin_can_access_profile((select profile_id from public.sos_alerts where sos_id = law_enforcement_referrals.sos_id)))
    or (public.current_role() = 'law_enforcement' and assigned_officer_id = public.current_profile_id())
  );

drop policy if exists "Authorized case admins can create law-enforcement referrals" on public.law_enforcement_referrals;
create policy "Authorized case admins can create law-enforcement referrals"
  on public.law_enforcement_referrals for insert
  with check (
    referred_by = public.current_profile_id()
    and (
      (case_id is not null and public.admin_can_access_case_active(case_id))
      or (sos_id is not null and public.admin_can_access_profile((select profile_id from public.sos_alerts where sos_id = law_enforcement_referrals.sos_id)))
    )
  );

drop policy if exists "Case admins and assigned officers can update law-enforcement referrals" on public.law_enforcement_referrals;
create policy "Case admins and assigned officers can update law-enforcement referrals"
  on public.law_enforcement_referrals for update
  using (
    (case_id is not null and public.admin_can_access_case_active(case_id))
    or (sos_id is not null and public.admin_can_access_profile((select profile_id from public.sos_alerts where sos_id = law_enforcement_referrals.sos_id)))
    or (public.current_role() = 'law_enforcement' and assigned_officer_id = public.current_profile_id())
  )
  with check (
    (case_id is not null and public.admin_can_access_case_active(case_id))
    or (sos_id is not null and public.admin_can_access_profile((select profile_id from public.sos_alerts where sos_id = law_enforcement_referrals.sos_id)))
    or (public.current_role() = 'law_enforcement' and assigned_officer_id = public.current_profile_id())
  );
-- No delete policy — immutable history, matches case_referrals/shelter_referrals.

-- Extend case_reports / case_status_history / sos_alerts SELECT so the
-- assigned officer can see the referred record itself, not just the
-- referral stub. Uses the row-security-off helpers from step 2 —
-- see "RLS RECURSION SAFETY" at the top of this file.
drop policy if exists "Law enforcement can view assigned cases" on public.case_reports;
create policy "Law enforcement can view assigned cases"
  on public.case_reports for select
  using (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id));

drop policy if exists "Law enforcement can view assigned case history" on public.case_status_history;
create policy "Law enforcement can view assigned case history"
  on public.case_status_history for select
  using (public.current_role() = 'law_enforcement' and public.is_case_referred_to_officer(case_id));

drop policy if exists "Law enforcement can view assigned sos alerts" on public.sos_alerts;
create policy "Law enforcement can view assigned sos alerts"
  on public.sos_alerts for select
  using (public.current_role() = 'law_enforcement' and public.is_sos_referred_to_officer(sos_id));

-- ---------------------------------------------------------
-- 7. Grants — column-scoped per this schema's established discipline.
--    The trigger above is what actually differentiates who may set
--    which column to what; the grant only bounds the outer surface.
-- ---------------------------------------------------------
grant select, insert on public.law_enforcement_referrals to authenticated;
grant update (status, assigned_officer_id, reason, action_notes, action_taken_at) on public.law_enforcement_referrals to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only.
-- =========================================================

-- 1. Confirm 'law_enforcement' is a real enum label:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;

-- 2. Confirm law_enforcement_referrals exists with RLS enabled and
--    exactly 3 policies (select/insert/update, no delete):
--   select relrowsecurity from pg_class where relname = 'law_enforcement_referrals';
--   select policyname, cmd from pg_policies where tablename = 'law_enforcement_referrals';

-- 3. RECURSION TEST — as an admin who can access a case, select from
--    case_reports where a law_enforcement_referrals row exists for it:
--   select * from case_reports where case_id = '<a case with a referral>';
--   Expect real rows — NOT "infinite recursion detected in policy".

-- 4. Unassigned-officer denial — as a law_enforcement user with no
--    assignment, attempt:
--   select * from law_enforcement_referrals;
--   select * from case_reports where case_id = '<a referred-but-unassigned case>';
--   Expect 0 rows for both.

-- 5. Self-assignment denial — as an assigned law_enforcement user,
--    attempt to reassign the referral:
--   update law_enforcement_referrals set assigned_officer_id = null where referral_id = '<own referral>';
--   Expect a permission/trigger rejection ("Law enforcement cannot reassign this referral").

-- 6. Cross-officer denial — as law_enforcement officer A, attempt to
--    read a referral assigned to officer B:
--   select * from law_enforcement_referrals where referral_id = '<officer B's referral>';
--   Expect 0 rows.

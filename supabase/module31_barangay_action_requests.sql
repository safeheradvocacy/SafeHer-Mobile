-- =========================================================
-- SafeSpace — Module 31: Barangay Action Requests
-- (MSWDO/PSWDO/Police -> Barangay Admin inter-agency requests)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module30_third_party_reporting.sql.
--
-- WHY / AUDIT SUMMARY — before writing this file, the existing schema
-- was inspected directly:
--   * barangay_admin's actual permission set (admin/src/lib/
--     permissions.ts) was ['cases.view','sos.monitor','identity.verify',
--     'shelters.refer','reports.view'] — it never had shelters.manage,
--     support.manage, or faqs.manage, so there is no standalone
--     "Services Management"/"Shelter Management" page to remove for
--     this role; only sos.monitor and shelters.refer are being removed
--     (see the admin-side change in this pass's report).
--   * admin_can_access_case_active() (module3) ALREADY scopes
--     barangay_admin to cases they currently own at the Barangay tier
--     (owner_level='Barangay' and owner_barangay_id = their own) — this
--     is the real reason Reports/Analytics/Case Management for
--     barangay_admin already only ever show their own barangay's data.
--     This module does not touch that function or weaken it in any way.
--   * current_barangay_id() and is_barangay_admin() already exist
--     (module3) as single-hop, security-definer helpers — reused here
--     unchanged, exactly like is_provincial_staff() was reused for
--     module28's announcements.
--   * case_services (module22) already has a real 'BPO' service_type —
--     Barangay Protection Order was never a gap in the service catalog
--     itself, only in ROUTING a BPO service entry to the actual
--     barangay that needs to act on it. This module adds that routing,
--     linked to the existing case_services row, never duplicating it.
--   * survivors.barangay_id (module12) and case_reports.incident_
--     barangay_id/owner_barangay_id (module3/module12) are the existing
--     columns a target barangay is derived from — no new "where does
--     this case belong" concept is invented here.
--
-- SCOPE DECISION — request_type is plain text (varchar), not a new
-- enum, by the same reasoning already used for educational_attainment
-- (module20) and action_notes (module9): the full future catalog of
-- "things a barangay can be asked to do" isn't closed yet (Phase 5 of
-- the brief explicitly asks this to be evaluated service-by-service,
-- ongoing), and a plain, app-validated string (see
-- admin/src/lib/barangayRouting.ts) avoids a migration every time that
-- catalog is revisited. For this pass, the only real, wired-up value is
-- 'BPO' — every other case_services type was evaluated and intentionally
-- excluded; see barangayRouting.ts's own header for the documented
-- reasoning on each one.
--
-- Single-part file — one brand-new enum, not a new value on an
-- existing one, so no Part A/B split is needed.
--
-- Everything below is idempotent and additive; no existing table,
-- policy, or row is touched.
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'barangay_request_status') then
    create type public.barangay_request_status as enum (
      'Pending', 'Acknowledged', 'In Progress', 'Completed', 'Declined', 'Cancelled', 'Returned'
    );
  end if;
end $$;


-- ---------------------------------------------------------
-- 1. barangay_action_requests
-- ---------------------------------------------------------
create table if not exists public.barangay_action_requests (
  request_id          uuid primary key default gen_random_uuid(),
  case_id              uuid not null references public.case_reports(case_id) on delete cascade,
  -- Nullable: for this pass every real request IS linked to the
  -- case_services row that triggered it (BPO), but the column stays
  -- optional so a future, non-service-catalog request type (e.g. a
  -- plain barangay verification ask) never needs a schema change to
  -- fit this table — see request_type below.
  service_id           uuid references public.case_services(service_id) on delete set null,
  -- Plain, app-validated vocabulary (barangayRouting.ts) — see file
  -- header for why this is not a new enum.
  request_type         varchar(50) not null,
  requesting_role       public.user_role not null,
  requested_by         uuid not null references public.user_profiles(profile_id),
  target_barangay_id   uuid not null references public.barangays(barangay_id),
  status               public.barangay_request_status not null default 'Pending',
  priority             public.priority_level not null default 'Medium',
  notes                text,
  decline_reason       text,
  response_notes       text,
  assigned_handler_id  uuid references public.user_profiles(profile_id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_bar_requests_target_barangay on public.barangay_action_requests(target_barangay_id);
create index if not exists idx_bar_requests_case on public.barangay_action_requests(case_id);
create index if not exists idx_bar_requests_requested_by on public.barangay_action_requests(requested_by);
create index if not exists idx_bar_requests_status on public.barangay_action_requests(status);

-- Idempotency / duplicate-prevention — at most one ACTIVE (non-terminal)
-- request per (case, linked service). A retry or repeated submission
-- while one is still open hits this constraint instead of creating a
-- second active request; once a request reaches a terminal status, a
-- genuinely new request for the same case/service can be created
-- (e.g. a follow-up BPO after the first was Completed).
create unique index if not exists idx_bar_requests_one_active_per_service
  on public.barangay_action_requests(case_id, service_id)
  where status not in ('Completed', 'Declined', 'Cancelled', 'Returned');

alter table public.barangay_action_requests enable row level security;


-- ---------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------

-- Read: the target barangay's own admin(s), the original requester, and
-- province-wide technical/operational oversight (is_provincial_admin()
-- already means provincial_admin/super_admin/provincial_staff
-- identically everywhere else in this schema — unchanged here).
-- Provincial Admin gets this ONLY as the same read-level oversight it
-- already has on every other operational table via is_provincial_admin()
-- — never special-cased higher, and never granted INSERT below.
drop policy if exists "Barangay requests are visible to their target barangay, requester, or province" on public.barangay_action_requests;
create policy "Barangay requests are visible to their target barangay, requester, or province"
  on public.barangay_action_requests for select
  using (
    public.is_provincial_admin()
    or (public.is_barangay_admin() and target_barangay_id = public.current_barangay_id())
    or requested_by = public.current_profile_id()
  );

-- Create: only the roles the brief actually authorizes to originate a
-- barangay request (MSWDO = municipal_admin, PSWDO = provincial_staff,
-- Police = law_enforcement) — NOT barangay_admin (a barangay doesn't
-- request itself) and NOT provincial_admin (explicitly excluded by the
-- brief: "Provincial Admin's technical-administration role must not
-- automatically grant operational authority"). admin_can_access_case_
-- active() re-confirms the requester's own existing case-access rights
-- — this policy grants no new case access, only the ability to attach
-- a barangay request to a case already reachable through it.
drop policy if exists "Authorized agencies can create barangay requests for their own cases" on public.barangay_action_requests;
create policy "Authorized agencies can create barangay requests for their own cases"
  on public.barangay_action_requests for insert
  with check (
    public.current_role() in ('municipal_admin', 'provincial_staff', 'law_enforcement')
    and requested_by = public.current_profile_id()
    and requesting_role = public.current_role()
    and public.admin_can_access_case_active(case_id)
  );

-- Update: the target barangay admin (status/response workflow) or the
-- original requester (cancellation only) — which exact transitions
-- either may make is enforced by the trigger below, not by this
-- policy; this policy only gates WHO may attempt an update at all.
drop policy if exists "Target barangay or original requester can update a barangay request" on public.barangay_action_requests;
create policy "Target barangay or original requester can update a barangay request"
  on public.barangay_action_requests for update
  using (
    (public.is_barangay_admin() and target_barangay_id = public.current_barangay_id())
    or requested_by = public.current_profile_id()
  )
  with check (
    (public.is_barangay_admin() and target_barangay_id = public.current_barangay_id())
    or requested_by = public.current_profile_id()
  );

-- No DELETE policy/grant — a request is retired via status
-- ('Completed'/'Declined'/'Cancelled'/'Returned'), never removed; this
-- preserves the audit/history trail the brief requires.

grant select, insert on public.barangay_action_requests to authenticated;
-- Column-scoped UPDATE — case_id/service_id/request_type/requesting_role/
-- requested_by/target_barangay_id/priority/notes are NEVER authenticated-
-- writable after creation (immutable facts: a barangay admin cannot
-- retarget a request to a different barangay to gain access, and
-- neither side can rewrite who requested what, from where, or why).
grant update (status, decline_reason, response_notes, assigned_handler_id)
  on public.barangay_action_requests to authenticated;


-- ---------------------------------------------------------
-- 3. set_barangay_request_updated_at() — same minimal timestamp
--    trigger shape as every other table in this schema that needs one.
-- ---------------------------------------------------------
create or replace function public.set_barangay_request_updated_at()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_barangay_request_updated_at on public.barangay_action_requests;
create trigger trg_set_barangay_request_updated_at
  before update on public.barangay_action_requests
  for each row execute procedure public.set_barangay_request_updated_at();


-- ---------------------------------------------------------
-- 4. validate_barangay_request_transition() — the actual "define
--    permitted transitions by role" enforcement (Phase 4.3/Phase 7 of
--    the brief). The two RLS policies above gate WHO may attempt an
--    update; this gates WHICH status change that caller may actually
--    make, server-side, regardless of what a client sends.
-- ---------------------------------------------------------
create or replace function public.validate_barangay_request_transition()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = old.status then
    return new; -- editing response_notes/assigned_handler_id without a status change
  end if;

  if public.is_barangay_admin() and old.target_barangay_id = public.current_barangay_id() then
    if old.status = 'Pending' and new.status in ('Acknowledged', 'Declined') then
      -- ok
    elsif old.status = 'Acknowledged' and new.status in ('In Progress', 'Declined', 'Returned') then
      -- ok
    elsif old.status = 'In Progress' and new.status in ('Completed', 'Declined', 'Returned') then
      -- ok
    else
      raise exception 'Not a permitted status transition for a Barangay Admin: % -> %', old.status, new.status;
    end if;
    if new.status = 'Declined' and (new.decline_reason is null or btrim(new.decline_reason) = '') then
      raise exception 'A reason is required when declining a barangay request';
    end if;
    return new;
  end if;

  if old.requested_by = public.current_profile_id() then
    if new.status = 'Cancelled' and old.status in ('Pending', 'Acknowledged') then
      return new;
    end if;
    raise exception 'The requester may only cancel a request that has not yet moved past Acknowledged';
  end if;

  raise exception 'Not authorized to change this barangay request''s status';
end;
$$;

drop trigger if exists trg_validate_barangay_request_transition on public.barangay_action_requests;
create trigger trg_validate_barangay_request_transition
  before update on public.barangay_action_requests
  for each row execute procedure public.validate_barangay_request_transition();


-- ---------------------------------------------------------
-- 5. notifications — additive FK, same pattern as announcement_id
--    (module28) and case_id/sos_id before it.
-- ---------------------------------------------------------
alter table public.notifications add column if not exists barangay_request_id uuid references public.barangay_action_requests(request_id);
create index if not exists idx_notifications_barangay_request_id on public.notifications(barangay_request_id) where barangay_request_id is not null;


-- ---------------------------------------------------------
-- 6. notify_on_barangay_request_created() — fan-out to every active
--    barangay_admin whose barangay_id matches the request's target
--    (there can legitimately be more than one account per barangay).
--    No survivor name, narrative, or contact info in the payload — the
--    case reference number is the safe pointer an authorized recipient
--    uses to open the real record through the Barangay Requests page.
-- ---------------------------------------------------------
create or replace function public.notify_on_barangay_request_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  recipient record;
  v_case_number text;
begin
  select case_number into v_case_number from public.case_reports where case_id = new.case_id;

  for recipient in
    select profile_id from public.user_profiles
    where role = 'barangay_admin' and is_active = true and barangay_id = new.target_barangay_id
  loop
    insert into public.notifications (profile_id, case_id, barangay_request_id, notification_type, title, message, is_read)
    values (
      recipient.profile_id, new.case_id, new.request_id, 'Referral',
      'New Barangay Assistance Request',
      format('%s request for case %s requires your action.', new.request_type, coalesce(v_case_number, '—')),
      false
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_barangay_request_created on public.barangay_action_requests;
create trigger trg_notify_on_barangay_request_created
  after insert on public.barangay_action_requests
  for each row execute procedure public.notify_on_barangay_request_created();


-- ---------------------------------------------------------
-- 7. notify_on_barangay_request_status_change() — tells the ORIGINAL
--    REQUESTER when something meaningful happens, exactly once per
--    real transition (old.status is distinct from new.status), never
--    per Realtime event and never on an unrelated field edit — same
--    idempotency shape as module28's announcement-publish notifier.
-- ---------------------------------------------------------
create or replace function public.notify_on_barangay_request_status_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_title text;
begin
  if new.status = old.status then
    return new;
  end if;

  v_title := case new.status
    when 'Acknowledged' then 'Barangay Request Acknowledged'
    when 'In Progress' then 'Barangay Request In Progress'
    when 'Completed' then 'Barangay Request Completed'
    when 'Declined' then 'Barangay Request Declined'
    when 'Returned' then 'Barangay Request Returned for Clarification'
    else null
  end;

  if v_title is null then
    return new; -- 'Cancelled' is the requester's own action; they don't need to be told about it
  end if;

  insert into public.notifications (profile_id, case_id, barangay_request_id, notification_type, title, message, is_read)
  values (
    new.requested_by, new.case_id, new.request_id, 'Referral', v_title,
    coalesce(new.response_notes, new.decline_reason, 'See the request for details.'),
    false
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_on_barangay_request_status_change on public.barangay_action_requests;
create trigger trg_notify_on_barangay_request_status_change
  after update on public.barangay_action_requests
  for each row execute procedure public.notify_on_barangay_request_status_change();


-- ---------------------------------------------------------
-- 8. Audit trail — reuses the existing generic audit_row_change
--    trigger (module3), same convention as every other tracked table.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_barangay_action_requests on public.barangay_action_requests;
create trigger trg_audit_barangay_action_requests after insert or update or delete on public.barangay_action_requests
  for each row execute procedure public.audit_row_change('request_id');


-- ---------------------------------------------------------
-- 9. Realtime publication — REQUIRED, not optional (see module17's own
--    discovery and module28's note: a postgres_changes subscription on
--    a table never added to supabase_realtime silently never fires).
--    Added here even though this pass's admin UI polls on
--    focus/refresh by default, so a future live-update subscription on
--    this table (matching the mobile announcement feed's pattern)
--    doesn't silently inherit the same bug.
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'barangay_action_requests'
  ) then
    alter publication supabase_realtime add table public.barangay_action_requests;
  end if;
end $$;


-- ---------------------------------------------------------
-- 10. notify_on_sos_created() (module8) — redefined in place (same
--     trigger wiring, no new trigger). barangay_admin is removed from
--     the SOS fan-out: this role no longer has an SOS Monitoring page
--     to act on (Phase 2 of this module's brief), so continuing to
--     notify them would be a dead-end alert pointing at a page they
--     can no longer reach. municipal_admin (which still has full SOS
--     access) continues to receive it unchanged — a barangay-owned
--     case's SOS response still has a real recipient. provincial_
--     admin/super_admin are untouched.
-- ---------------------------------------------------------
create or replace function public.notify_on_sos_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  survivor_municipality uuid;
  recipient record;
begin
  select municipality_id into survivor_municipality
  from public.user_profiles where profile_id = new.profile_id;

  for recipient in
    select profile_id from public.user_profiles
    where is_active = true
      and (
        role in ('provincial_admin', 'super_admin')
        or (role = 'municipal_admin' and municipality_id = survivor_municipality)
      )
  loop
    insert into public.notifications (profile_id, sos_id, notification_type, title, message, is_read)
    values (recipient.profile_id, new.sos_id, 'SOS', 'SafeHer Emergency Alert', 'An emergency alert requires your attention.', false);
  end loop;

  return new;
end;
$$;
-- trg_notify_on_sos_created (module8) already points at this function
-- by name — no trigger change needed, the redefinition takes effect
-- immediately.


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only unless noted.
-- =========================================================

-- 1. Confirm the table, RLS, and policies exist:
--   select relrowsecurity from pg_class where relname = 'barangay_action_requests';
--   select policyname, cmd from pg_policies where tablename = 'barangay_action_requests';

-- 2. Confirm column grants exclude the immutable facts:
--   select column_name from information_schema.role_column_grants
--   where table_name = 'barangay_action_requests' and grantee = 'authenticated' and privilege_type = 'UPDATE';
--   -- Expect exactly: status, decline_reason, response_notes, assigned_handler_id.

-- 3. Role scoping (run as each test profile):
--   -- as municipal_admin/provincial_staff/law_enforcement, on a case they can access: expect success
--   -- as barangay_admin, provincial_admin, survivor: expect denied (not an error — RLS-empty/blocked)

-- 4. Cross-barangay isolation (as a Barangay A admin, then Barangay B admin):
--   select count(*) from barangay_action_requests; -- each must see only requests targeting their own barangay (plus any they personally requested)

-- 5. Transition enforcement (as the target barangay_admin):
--   update barangay_action_requests set status = 'Completed' where request_id = '<a Pending one>';
--   -- expect the trigger's exception (Pending -> Completed is not permitted; must go through Acknowledged/In Progress first)

-- 6. Idempotency (as the original requester, same case + same service twice while the first is still open):
--   -- second insert attempt must fail the unique index, not create a second active row.

-- 7. Realtime publication:
--   select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'barangay_action_requests';
--   -- Expect exactly one row.

-- 8. SOS fan-out no longer includes barangay_admin (trigger a test SOS
--    alert for a survivor in a municipality/barangay with both a
--    municipal_admin and a barangay_admin test account):
--   select p.role, n.title from notifications n join user_profiles p on p.profile_id = n.profile_id
--   where n.sos_id = '<the new sos_id>';
--   -- Expect municipal_admin (and provincial_admin/super_admin) rows; expect NO barangay_admin row.

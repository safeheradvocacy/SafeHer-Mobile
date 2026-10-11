-- =========================================================
-- SafeHer — Module 8: Hybrid notification architecture
-- (database-backed in-app notifications + push for high-priority events)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module7_shelter_staff.sql (module7 must already be fully applied —
-- this file's SOS fan-out trigger relies on user_profiles.role values
-- that exist from module3/module4, and its push dispatch trigger sits
-- on top of the existing `notifications` table untouched by this file).
--
-- This file is a single script — no `ALTER TYPE ... ADD VALUE` is used
-- anywhere in it, so unlike module3/4/6/7 there is no Part A/Part B
-- split required. Safe to run top to bottom in one execution.
--
-- ARCHITECTURE (matches the approved design exactly):
--   EVENT -> DATABASE NOTIFICATION (authoritative, persistent)
--         -> PRIORITY CHECK (by notification_type)
--         -> if high priority -> PUSH NOTIFICATION (best-effort alert)
--
-- The database notification row is written FIRST and is never rolled
-- back or deleted because a push attempt fails or because no push
-- infrastructure is configured — see dispatch_push_for_notification()
-- below, which is wrapped in its own exception handler for exactly
-- this reason.
--
-- SCOPE — this file does NOT add SMS or automated phone calls. Those
-- remain explicitly out of scope for this phase (see the accompanying
-- report). It also does not touch shelter_requests.shelter_id /
-- shelter_referrals.shelter_id ("pending shelter designation" is a
-- separate, still-deferred feature — unrelated to this file).
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/table if not exists) and safe to re-run.
-- =========================================================


-- ---------------------------------------------------------
-- 1. push_tokens — one row per (profile, device). A user may have
--    multiple active devices; each gets its own row rather than a
--    single column on user_profiles, specifically so logging out on
--    one device never disturbs another device's registration.
-- ---------------------------------------------------------
create table if not exists public.push_tokens (
  token_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.user_profiles(profile_id) on delete cascade,
  expo_push_token text not null,
  platform text not null default 'unknown',
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (profile_id, expo_push_token)
);

create index if not exists idx_push_tokens_profile_active
  on public.push_tokens(profile_id) where is_active = true;

alter table public.push_tokens enable row level security;

-- A user may only ever see/manage their OWN device tokens. No admin,
-- including provincial_admin/super_admin, is granted read access to
-- another profile's tokens through RLS — the only code path that ever
-- reads across profiles is the send-push-notification Edge Function,
-- which uses the service role key (bypasses RLS) and only does so in
-- response to a database notification row that was already authorized
-- by that table's own INSERT policy. This is the concrete mechanism
-- behind "the client must not determine arbitrary recipients."
drop policy if exists "Users can view own push tokens" on public.push_tokens;
create policy "Users can view own push tokens"
  on public.push_tokens for select
  using (profile_id = public.current_profile_id());

drop policy if exists "Users can register own push tokens" on public.push_tokens;
create policy "Users can register own push tokens"
  on public.push_tokens for insert
  with check (profile_id = public.current_profile_id());

drop policy if exists "Users can update own push tokens" on public.push_tokens;
create policy "Users can update own push tokens"
  on public.push_tokens for update
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

drop policy if exists "Users can delete own push tokens" on public.push_tokens;
create policy "Users can delete own push tokens"
  on public.push_tokens for delete
  using (profile_id = public.current_profile_id());

grant select, insert, delete on public.push_tokens to authenticated;
-- profile_id is deliberately NOT in this grant — a token can never be
-- re-pointed at a different profile via UPDATE, only replaced (delete
-- + insert), matching this schema's established column-scoped-grant
-- discipline for identity-bearing columns.
grant update (expo_push_token, platform, is_active, last_seen_at) on public.push_tokens to authenticated;


-- ---------------------------------------------------------
-- 2. notifications — add push-delivery bookkeeping columns. These are
--    NEVER added to any authenticated grant: only the
--    send-push-notification Edge Function's service-role client ever
--    writes them, exactly like case_reports.owner_level and the other
--    trigger/service-role-only columns already in this schema.
--    Notification CREATION (the authoritative record) and PUSH
--    DELIVERY (a best-effort side effect) are intentionally tracked
--    as two separate states on the same row.
-- ---------------------------------------------------------
alter table public.notifications add column if not exists push_dispatched_at timestamptz;
alter table public.notifications add column if not exists push_delivery_status text;
comment on column public.notifications.push_delivery_status is
  'One of: sent, no_recipients, error, or null if never attempted (either not a high-priority type, or push dispatch is not yet configured on this database). Set only by the send-push-notification Edge Function''s service-role client.';


-- ---------------------------------------------------------
-- 3. SOS creation currently has no fan-out to admins at all in the
--    notifications table (confirmed by inspection — SosMonitoringPage
--    relies solely on a Realtime subscription to sos_alerts). This
--    adds the missing "Create an in-app notification for authorized
--    recipients" step from the approved SOS architecture. Recipient
--    set mirrors the existing SosMonitoringPage scoping exactly
--    (province-wide for provincial_admin/super_admin; municipality-
--    scoped for municipal_admin/barangay_admin) — no new authorization
--    model invented. shelter_admin/shelter_staff/support_expert are
--    deliberately excluded, matching their existing exclusion from
--    is_admin() and from any SOS-monitoring UI.
--
--    Payload is deliberately generic — no survivor name, narrative,
--    address, or phone number — per the approved architecture's
--    "do not expose unnecessary sensitive information" rule. The
--    sos_id foreign key is the safe reference an authorized recipient
--    uses to open the protected record through SosMonitoringPage.
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
        or (role in ('municipal_admin', 'barangay_admin') and municipality_id = survivor_municipality)
      )
  loop
    insert into public.notifications (profile_id, sos_id, notification_type, title, message, is_read)
    values (recipient.profile_id, new.sos_id, 'SOS', 'SafeHer Emergency Alert', 'An emergency alert requires your attention.', false);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_sos_created on public.sos_alerts;
create trigger trg_notify_on_sos_created
  after insert on public.sos_alerts
  for each row execute procedure public.notify_on_sos_created();


-- ---------------------------------------------------------
-- 4. Generic push dispatch — fires on every notifications INSERT,
--    regardless of whether that row came from a trigger (expert
--    assignment, shelter-staff assignment, this file's new SOS
--    fan-out) or from existing application-level inserts (case status
--    change, case assignment, shelter referral creation, SOS status
--    update). By the time a row exists here, its own INSERT policy
--    (admin_can_access_profile / shelter_admin_notification_allowed /
--    self-insert) has already authorized profile_id as a legitimate
--    recipient — this function does not re-derive authorization, it
--    only decides push-worthiness and looks up that profile's tokens.
--
--    PRIORITY CHECK — matches the approved hybrid architecture:
--    'Announcement' is the one existing type with no individual
--    time-sensitivity (a broadcast), so it stays in-app-only. Every
--    other existing type (SOS, Case Update, Referral, Assignment,
--    Support) corresponds to a concrete, individually-addressed event
--    the recipient would reasonably want to know about promptly, per
--    the master prompt's own examples ("important report status
--    update, case status update, referral status update, response
--    recorded, important shelter/referral action").
--
--    pg_net is used so this works uniformly no matter which code path
--    created the notification, without editing every existing insert
--    call site across both apps. If the operator has not yet run the
--    one-time `alter database ... set app.settings...` configuration
--    below, this silently no-ops — the notification row itself is
--    unaffected either way.
-- ---------------------------------------------------------
create extension if not exists pg_net;

-- Config storage for the push-dispatch URL/secret. NOT a Postgres GUC:
-- `alter database postgres set app.settings.xxx = ...` requires a
-- privilege level (ALTER DATABASE) that Supabase's hosted SQL-execution
-- role does not grant, even to the project owner, so that approach is
-- not viable on this platform. A plain table in a schema PostgREST
-- never exposes achieves the same goal — it is not reachable from
-- `public` schema, no policy or grant is ever given to
-- `anon`/`authenticated` on it, and it is only ever read from inside a
-- SECURITY DEFINER trigger function, never queried directly by a
-- client.
create schema if not exists private;

create table if not exists private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
-- Deliberately no RLS policy and no grant to anon/authenticated here —
-- absence of any grant is what keeps this table unreachable from
-- PostgREST, on top of it living outside the exposed `public` schema.

create or replace function public.dispatch_push_for_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  edge_url text;
  dispatch_secret text;
begin
  if new.notification_type not in ('SOS', 'Case Update', 'Referral', 'Assignment', 'Support') then
    return new;
  end if;

  select value into edge_url from private.app_config where key = 'push_dispatch_url';
  select value into dispatch_secret from private.app_config where key = 'push_dispatch_secret';

  if edge_url is null or dispatch_secret is null or edge_url = '' or dispatch_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := edge_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', dispatch_secret),
    body := jsonb_build_object('notification_id', new.notification_id)
  );

  return new;
exception when others then
  -- A push-dispatch failure (bad URL, pg_net not reachable, etc.) must
  -- never roll back or block the notification insert itself — the
  -- database record is the authoritative one per the approved
  -- architecture. Surfaced as a Postgres WARNING (visible in Supabase
  -- log explorer) rather than swallowed silently.
  raise warning 'dispatch_push_for_notification failed for notification_id=%: %', new.notification_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_dispatch_push_for_notification on public.notifications;
create trigger trg_dispatch_push_for_notification
  after insert on public.notifications
  for each row execute procedure public.dispatch_push_for_notification();


-- =========================================================
-- ONE-TIME OPERATOR SETUP (not part of the idempotent script above —
-- run these two statements yourself, once, with real values, AFTER
-- deploying the send-push-notification Edge Function and setting its
-- PUSH_DISPATCH_SECRET via `supabase secrets set`):
--
--   insert into private.app_config (key, value) values
--     ('push_dispatch_url', 'https://<project-ref>.supabase.co/functions/v1/send-push-notification')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
--   insert into private.app_config (key, value) values
--     ('push_dispatch_secret', '<same random value passed to `supabase secrets set PUSH_DISPATCH_SECRET=...`>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- These are deliberately NOT baked into this file as literals — this
-- file is committed to the repository, and the dispatch secret must
-- never appear in source control (same handling as any other secret
-- in this project).
-- =========================================================


-- =========================================================
-- VERIFICATION — run these separately, after everything above and
-- after the one-time operator setup, to confirm the migration applied
-- correctly. All read-only except where noted.
-- =========================================================

-- 1. Confirm push_tokens exists with RLS enabled and 4 policies:
--   select relrowsecurity from pg_class where relname = 'push_tokens';
--   select policyname, cmd from pg_policies where tablename = 'push_tokens';

-- 2. Confirm the new notifications columns exist and are NOT
--    authenticated-writable:
--   select column_name from information_schema.columns
--   where table_name = 'notifications' and column_name like 'push_%';
--   select column_name from information_schema.role_column_grants
--   where table_name = 'notifications' and privilege_type = 'UPDATE'
--   and grantee = 'authenticated';
--   -- Expect push_dispatched_at / push_delivery_status absent from
--   -- the second query's result set.

-- 3. Confirm pg_net is installed and config is present (values redacted
--    intentionally — do not paste real output containing them anywhere):
--   select installed_version from pg_available_extensions where name = 'pg_net';
--   select key, (value is not null and value <> '') as configured from private.app_config;
--   select has_table_privilege('anon', 'private.app_config', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'private.app_config', 'SELECT'); -- expect false

-- 4. SOS fan-out test — as a survivor, insert a row into sos_alerts (or
--    trigger one from the app), then as that survivor's municipal_admin:
--   select * from notifications where notification_type = 'SOS' and sos_id = '<the new sos_id>';
--   -- Expect one row, title 'SafeHer Emergency Alert', no survivor
--   -- name/address/phone in the message.

-- 5. Push dispatch bookkeeping test — after the operator setup above
--    and after (4), re-select the same notification row:
--   select push_dispatched_at, push_delivery_status from notifications where sos_id = '<the same sos_id>';
--   -- Expect push_dispatched_at to be non-null shortly after insert
--   -- (set by the Edge Function), regardless of whether an actual
--   -- device was registered to receive it.

-- 6. Idempotency check — dispatch_push_for_notification only ever
--    fires once per row (AFTER INSERT, not AFTER UPDATE), so a single
--    notification can never be double-dispatched by this trigger
--    itself; duplicate NOTIFICATION rows from a retried client action
--    are an application-layer concern outside this file's scope.

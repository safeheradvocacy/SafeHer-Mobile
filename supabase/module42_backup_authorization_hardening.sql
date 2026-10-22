-- =========================================================
-- SafeSpace — Module 42: Backup & Restore hardening
--   1. A dedicated Super Admin backup authorization password
--      (separate second factor from the normal login password),
--      with operation-scoped, single-use, short-lived grants.
--   2. Dynamic data-source discovery, so a newly added table is
--      DETECTED and reported rather than silently missed by a
--      hardcoded export list.
--   3. Schema/policy/function/trigger export for comparison and
--      operator-reviewed reconstruction.
--   4. The additional catalog columns a versioned ZIP archive needs
--      (format version, coverage report, encryption markers).
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module41_support_queue_notifications.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10/11/16/23:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- WHAT THIS DOES NOT CHANGE:
--   * is_provincial_technical_admin() (module11) is reused UNCHANGED.
--     This module does not define a competing authorization function
--     and does not grant backup access to provincial_staff or any
--     other role. The new password is an ADDITIONAL factor layered on
--     top of that existing role check — never a replacement for it,
--     and never a way for a non-technical-admin to reach backups.
--   * backup_schedule's existing columns, set_backup_schedule(), the
--     pg_cron job, system_backups'/system_restores' existing columns
--     and policies, begin_restore_operation(), and the existing
--     Storage policies are all left in place. Everything here is
--     additive.
--
-- DELIBERATE SECURITY NOTES
--
-- a. The password is NEVER stored in plaintext. Only a bcrypt verifier
--    (pgcrypto crypt()/gen_salt('bf',12)) is stored — the identical
--    scheme module33_security_passcode.sql already uses, chosen for the
--    same reason stated there: a human-chosen secret needs a slow,
--    salted KDF, not the fast digest() used for high-entropy machine
--    tokens in module14. These helpers are deliberately SEPARATE from
--    module33's (different table, different trust domain, different
--    owner) rather than reusing a mobile-survivor passcode function for
--    a province-tier technical operation.
--
-- b. The verifier is never readable by any client. backup_authorization
--    is RLS-enabled with ZERO grants to authenticated/anon, and the
--    verification function is NOT granted to authenticated either — it
--    is reachable only by the Edge Functions' service-role client,
--    exactly like module33's verify_security_passcode(). The browser
--    posts the password to the Edge Function over HTTPS; the Edge
--    Function calls the RPC. The hash never leaves the database.
--
-- c. A password is NOT automatically equivalent to MFA. This is a
--    second *knowledge* factor controlled by one role — it proves the
--    operator knows a separately-held secret, NOT that they possess a
--    second device. It raises the bar against a hijacked admin session
--    and against an ordinary admin escalating into backups; it does not
--    provide device-possession assurance. Do not describe it in the UI
--    as two-factor authentication.
--
-- d. Grants are bound to profile_id + operation + optional target_id,
--    are single-use (consumed_at) and short-lived. True *session*
--    binding is not implemented because this project's JWT claims do
--    not expose a stable session identifier to SQL — so the actual
--    guarantees are: correct role, correct profile, correct operation,
--    correct target, one use, short expiry. Documented rather than
--    overstated.
--
-- e. The scheduled backup path does NOT use this password at all and
--    cannot. pg_cron presents module16's x-internal-secret instead and
--    is authorized ONLY for the 'create' action (see backup-create's
--    own dispatcher). Nothing here stores the password anywhere a
--    scheduler could read it.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

-- 'monthly' scheduling (the admin UI offers daily/weekly today).
alter type backup_frequency add value if not exists 'monthly';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------
-- 1. The protected-operation vocabulary.
--
-- Deliberately a CHECK constraint over text rather than a new enum
-- type: every enum value added later would force another Part A/Part B
-- split on this file's successors (the exact pain documented in
-- module3/4/6/7/9/10/11/16/23). A check constraint can be widened in a
-- single ordinary migration.
--
-- These are the operations §5 of the brief requires to be gated.
-- 'schedule_trigger' is the manual "run the schedule now" button — a
-- human action, and therefore gated, even though the unattended cron
-- path that runs the same export is not (see note (e) above).
-- ---------------------------------------------------------
create or replace function public.is_backup_protected_operation(p_operation text)
returns boolean
language sql
immutable
as $$
  select p_operation in (
    'create',
    'schedule_create',
    'schedule_modify',
    'schedule_trigger',
    'download',
    'validate',
    'restore_begin',
    'restore_execute',
    'delete',
    'security_settings'
  );
$$;

comment on function public.is_backup_protected_operation(text) is
  'The closed vocabulary of Backup & Restore operations that require the dedicated authorization password. Used by the grant table''s CHECK constraint and by verify_backup_password_and_grant(). Widening this list is an ordinary migration; it is deliberately not an enum type so no future Part A/Part B split is needed.';

-- ---------------------------------------------------------
-- 2. backup_authorization — the single-row verifier + lockout state.
--
-- Single row by construction (the CHECK pins the primary key), so
-- there is exactly one dedicated backup password for the technical
-- Super Admin tier — not one per administrator. That is intentional:
-- the brief specifies a password "controlled exclusively by the
-- authorized technical Super Admin" protecting an operation class, not
-- a per-user credential (each admin already has their own login
-- password, which this is deliberately separate from).
-- ---------------------------------------------------------
create table if not exists public.backup_authorization (
  id              int primary key default 1 check (id = 1),
  password_hash   text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  set_by          uuid references public.user_profiles(profile_id),
  set_at          timestamptz not null default now(),
  rotated_at      timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.backup_authorization is
  'Single-row bcrypt verifier for the dedicated Backup & Restore authorization password, plus its failed-attempt/lockout state. RLS-enabled with ZERO grants to authenticated/anon — reachable only through the SECURITY DEFINER functions below (which run with the owner''s rights, not the caller''s) and the backup Edge Functions'' service-role client. The hash is never selected by any client query and never returned to the browser.';

alter table public.backup_authorization enable row level security;
revoke all on public.backup_authorization from authenticated, anon;

-- NO grant to service_role either — deliberately, and unlike
-- system_backups/system_restores (module16/23) which the Edge Functions
-- read and write directly as rows.
--
-- Nothing ever needs row access to this table: the only readers/writers
-- are set_backup_password() and verify_backup_password_and_grant(),
-- both SECURITY DEFINER, which execute with the table OWNER's rights
-- rather than the caller's and therefore need no grant at all. Granting
-- service_role SELECT here would let anything holding the service-role
-- key fetch the bcrypt verifier over PostgREST — an offline cracking
-- target, handed out for no functional benefit. Keeping it ungranted is
-- what makes "the hash never leaves the database" literally true rather
-- than merely intended.
revoke all on public.backup_authorization from service_role;

-- ---------------------------------------------------------
-- 3. backup_auth_grants — short-lived, operation-scoped, single-use
--    proof that the dedicated password was just entered correctly.
-- ---------------------------------------------------------
create table if not exists public.backup_auth_grants (
  grant_id    uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.user_profiles(profile_id) on delete cascade,
  operation   text not null check (public.is_backup_protected_operation(operation)),
  target_id   uuid,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  revoked_at  timestamptz
);

comment on table public.backup_auth_grants is
  'Single-use, short-lived authorization grants issued after a successful dedicated-password check. Bound to profile_id + operation (+ target_id where the operation names a specific backup), consumed exactly once by consume_backup_grant(), and revoked wholesale when the password is rotated. Never an unrestricted "backup admin" token: a grant for ''download'' cannot authorize ''restore_execute'', and a grant for one backup_id cannot authorize another. RLS-enabled, zero client grants — same shape as backup_authorization above.';

alter table public.backup_auth_grants enable row level security;
revoke all on public.backup_auth_grants from authenticated, anon;

-- Same reasoning as backup_authorization above: every reader/writer is
-- a SECURITY DEFINER function (verify_backup_password_and_grant,
-- consume_backup_grant, set_backup_password's revoke-on-rotation),
-- so no role needs row access. Grants here would let a service-role
-- caller mint or un-consume a grant directly, bypassing the operation/
-- target/expiry checks that are the entire point of the table.
revoke all on public.backup_auth_grants from service_role;

create index if not exists idx_backup_auth_grants_active
  on public.backup_auth_grants (profile_id, operation, expires_at)
  where consumed_at is null and revoked_at is null;

-- ---------------------------------------------------------
-- 4. Hashing helpers — intentionally mirror module33's proven shape.
-- ---------------------------------------------------------
create or replace function public.hash_backup_password(p_password text)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf', 12));
$$;

revoke all on function public.hash_backup_password(text) from public, authenticated, anon;

create or replace function public.verify_backup_password_hash(p_password text, p_hash text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  -- bcrypt embeds its scheme/cost/salt in p_hash itself, so crypt()
  -- recomputes with the SAME salt and this equality is a real
  -- verification, not a string compare of two independent hashes.
  select p_hash = extensions.crypt(p_password, p_hash);
$$;

revoke all on function public.verify_backup_password_hash(text, text) from public, authenticated, anon;

-- ---------------------------------------------------------
-- 5. is_active-checked technical admin gate.
--
-- is_provincial_technical_admin() (module11) deliberately checks only
-- the ROLE, and is reused unchanged everywhere it is already used.
-- For issuing a NEW privileged authorization grant, a deactivated
-- account should not qualify — so this module adds its own stricter
-- gate rather than altering the shared helper (which other modules'
-- policies depend on, and whose behaviour is not this module's to
-- change).
-- ---------------------------------------------------------
create or replace function public.is_active_technical_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('provincial_admin', 'super_admin')
      and is_active = true
  );
$$;

comment on function public.is_active_technical_admin() is
  'Stricter companion to module11''s is_provincial_technical_admin(): same two roles, but additionally requires is_active. Used only for issuing/validating dedicated backup authorization, where a deactivated administrator must not be able to obtain a new privileged grant. Deliberately a separate function — module11''s helper is relied on by existing policies and is left untouched.';

-- ---------------------------------------------------------
-- 6. has_backup_password() — lets the UI tell "not provisioned yet"
--    apart from "provisioned", without ever exposing the verifier.
-- ---------------------------------------------------------
create or replace function public.has_backup_password()
returns table (configured boolean, locked boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.backup_authorization%rowtype;
  v_now timestamptz := now();
begin
  if not public.is_provincial_technical_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_row from public.backup_authorization where id = 1;
  if not found then
    return query select false, false, null::integer;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select true, true, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer;
    return;
  end if;

  return query select true, false, null::integer;
end;
$$;

comment on function public.has_backup_password() is
  'Reports whether the dedicated backup password has been provisioned and whether it is currently locked out. Returns booleans and a retry delay only — never the hash. Safe to grant to authenticated because it is itself gated on is_provincial_technical_admin().';

revoke all on function public.has_backup_password() from public, anon;
grant execute on function public.has_backup_password() to authenticated;

-- ---------------------------------------------------------
-- 7. set_backup_password() — provisioning AND rotation.
--
-- First-time provisioning (no row yet) requires only an active
-- technical admin. Rotation requires the CURRENT password as well, so
-- a hijacked session cannot silently replace the second factor it
-- does not know. Rotating revokes every outstanding grant.
--
-- NOT granted to authenticated: called only by the backup-auth Edge
-- Function's service-role client, which is where the HTTPS request
-- body carrying the password terminates. Same containment as
-- module33's verify_security_passcode().
-- ---------------------------------------------------------
create or replace function public.set_backup_password(
  p_profile_id uuid,
  p_new_password text,
  p_current_password text default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.backup_authorization%rowtype;
  v_now timestamptz := now();
  v_is_active_admin boolean;
begin
  -- Called by the service-role Edge Function, so auth.uid() is NOT the
  -- operator here — the caller's identity arrives as p_profile_id and
  -- is re-verified against user_profiles directly.
  select exists (
    select 1 from public.user_profiles
    where profile_id = p_profile_id
      and role in ('provincial_admin', 'super_admin')
      and is_active = true
  ) into v_is_active_admin;

  if not v_is_active_admin then
    return query select false, 'not_authorized'::text;
    return;
  end if;

  if p_new_password is null or length(p_new_password) < 12 then
    return query select false, 'too_short'::text;
    return;
  end if;

  select * into v_row from public.backup_authorization where id = 1 for update;

  if found then
    if v_row.locked_until is not null and v_row.locked_until > v_now then
      return query select false, 'locked'::text;
      return;
    end if;
    if p_current_password is null
       or not public.verify_backup_password_hash(p_current_password, v_row.password_hash) then
      update public.backup_authorization
        set failed_attempts = failed_attempts + 1, updated_at = v_now
        where id = 1;
      return query select false, 'current_password_incorrect'::text;
      return;
    end if;

    update public.backup_authorization
      set password_hash = public.hash_backup_password(p_new_password),
          failed_attempts = 0,
          locked_until = null,
          set_by = p_profile_id,
          rotated_at = v_now,
          updated_at = v_now
      where id = 1;

    -- Rotation invalidates everything previously authorized.
    update public.backup_auth_grants
      set revoked_at = v_now
      where consumed_at is null and revoked_at is null;

    return query select true, 'rotated'::text;
    return;
  end if;

  insert into public.backup_authorization (id, password_hash, set_by, set_at, updated_at)
  values (1, public.hash_backup_password(p_new_password), p_profile_id, v_now, v_now);

  return query select true, 'provisioned'::text;
end;
$$;

comment on function public.set_backup_password(uuid, text, text) is
  'Provisions (first time) or rotates the dedicated backup authorization password. Rotation requires the current password, so a hijacked session cannot replace a factor it does not know, and revokes all outstanding grants. Minimum length 12. NOT granted to authenticated — reachable only from the backup-auth Edge Function''s service-role client, which never logs or echoes the submitted password.';

revoke all on function public.set_backup_password(uuid, text, text) from public, authenticated, anon;

-- ---------------------------------------------------------
-- 8. verify_backup_password_and_grant() — the one place a grant is
--    minted. Escalating lockout, deliberately stricter than module33's
--    mobile passcode ladder: this protects province-wide data export
--    and restoration, not a personal case list.
-- ---------------------------------------------------------
create or replace function public.verify_backup_password_and_grant(
  p_profile_id uuid,
  p_password text,
  p_operation text,
  p_target_id uuid default null,
  p_ttl_seconds integer default 300
)
returns table (ok boolean, grant_id uuid, expires_at timestamptz, locked boolean, retry_after_seconds integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.backup_authorization%rowtype;
  v_now timestamptz := now();
  v_lock_seconds integer;
  v_grant_id uuid;
  v_expires timestamptz;
  v_is_active_admin boolean;
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 300), 60), 900);
begin
  if not public.is_backup_protected_operation(p_operation) then
    return query select false, null::uuid, null::timestamptz, false, null::integer, 'unknown_operation'::text;
    return;
  end if;

  select exists (
    select 1 from public.user_profiles
    where profile_id = p_profile_id
      and role in ('provincial_admin', 'super_admin')
      and is_active = true
  ) into v_is_active_admin;

  if not v_is_active_admin then
    return query select false, null::uuid, null::timestamptz, false, null::integer, 'not_authorized'::text;
    return;
  end if;

  select * into v_row from public.backup_authorization where id = 1 for update;
  if not found then
    return query select false, null::uuid, null::timestamptz, false, null::integer, 'not_configured'::text;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select false, null::uuid, null::timestamptz, true,
      ceil(extract(epoch from (v_row.locked_until - v_now)))::integer, 'locked'::text;
    return;
  end if;

  if public.verify_backup_password_hash(p_password, v_row.password_hash) then
    update public.backup_authorization
      set failed_attempts = 0, locked_until = null, updated_at = v_now
      where id = 1;

    v_expires := v_now + make_interval(secs => v_ttl);
    insert into public.backup_auth_grants (profile_id, operation, target_id, expires_at)
    values (p_profile_id, p_operation, p_target_id, v_expires)
    returning backup_auth_grants.grant_id into v_grant_id;

    return query select true, v_grant_id, v_expires, false, null::integer, 'granted'::text;
    return;
  end if;

  -- Wrong password: 3 misses -> 1 min, 5 -> 5 min, 8+ -> 30 min.
  v_lock_seconds := null;
  if v_row.failed_attempts + 1 >= 8 then
    v_lock_seconds := 1800;
  elsif v_row.failed_attempts + 1 >= 5 then
    v_lock_seconds := 300;
  elsif v_row.failed_attempts + 1 >= 3 then
    v_lock_seconds := 60;
  end if;

  update public.backup_authorization
    set failed_attempts = failed_attempts + 1,
        locked_until = case when v_lock_seconds is not null then v_now + make_interval(secs => v_lock_seconds) else locked_until end,
        updated_at = v_now
    where id = 1;

  return query select false, null::uuid, null::timestamptz, (v_lock_seconds is not null), v_lock_seconds, 'incorrect'::text;
end;
$$;

comment on function public.verify_backup_password_and_grant(uuid, text, text, uuid, integer) is
  'Verifies a dedicated-password attempt and, on success, mints ONE single-use grant scoped to (profile_id, operation, target_id) with a 60-900s TTL. Applies escalating server-side lockout (3/5/8 misses -> 1/5/30 min), stricter than module33''s mobile ladder because this gates province-wide export and restoration. NOT granted to authenticated — the backup Edge Functions'' service-role client is the only caller, and it logs outcomes to audit_logs with no password content.';

revoke all on function public.verify_backup_password_and_grant(uuid, text, text, uuid, integer) from public, authenticated, anon;

-- ---------------------------------------------------------
-- 9. consume_backup_grant() — the enforcement point. Single-use, and
--    re-checks the operation, target, expiry AND that the operator is
--    still an active technical admin at the moment of execution (an
--    account deactivated between authorization and execution must not
--    still be able to spend its grant).
-- ---------------------------------------------------------
create or replace function public.consume_backup_grant(
  p_grant_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_target_id uuid default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.backup_auth_grants%rowtype;
  v_now timestamptz := now();
begin
  select * into v_row from public.backup_auth_grants where grant_id = p_grant_id for update;
  if not found then
    return query select false, 'not_found'::text;
    return;
  end if;
  if v_row.revoked_at is not null then
    return query select false, 'revoked'::text;
    return;
  end if;
  if v_row.consumed_at is not null then
    return query select false, 'already_used'::text;
    return;
  end if;
  if v_row.expires_at <= v_now then
    return query select false, 'expired'::text;
    return;
  end if;
  if v_row.profile_id is distinct from p_profile_id then
    return query select false, 'wrong_user'::text;
    return;
  end if;
  if v_row.operation is distinct from p_operation then
    return query select false, 'wrong_operation'::text;
    return;
  end if;
  -- A grant minted for a specific backup must not authorize another.
  -- A grant minted without a target (e.g. 'create') is only valid for
  -- a call that likewise names no target.
  if v_row.target_id is distinct from p_target_id then
    return query select false, 'wrong_target'::text;
    return;
  end if;
  if not exists (
    select 1 from public.user_profiles
    where profile_id = p_profile_id
      and role in ('provincial_admin', 'super_admin')
      and is_active = true
  ) then
    return query select false, 'not_authorized'::text;
    return;
  end if;

  update public.backup_auth_grants set consumed_at = v_now where grant_id = p_grant_id;
  return query select true, 'consumed'::text;
end;
$$;

comment on function public.consume_backup_grant(uuid, uuid, text, uuid) is
  'Spends a backup authorization grant exactly once, re-checking operation, target, expiry, owner, and that the operator is STILL an active technical admin at execution time. Returns a reason code on refusal so the Edge Function can respond precisely without leaking state. service_role only.';

revoke all on function public.consume_backup_grant(uuid, uuid, text, uuid) from public, authenticated, anon;

-- ---------------------------------------------------------
-- 10. Catalog columns a versioned ZIP archive needs. Additive; older
--     rows read as NULL and the UI must show them as "legacy format",
--     never as if they were ZIP archives with coverage reports.
-- ---------------------------------------------------------
alter table public.system_backups
  add column if not exists archive_format text,
  add column if not exists format_version text,
  add column if not exists coverage jsonb,
  add column if not exists excluded jsonb,
  add column if not exists manifest_sha256 text,
  add column if not exists table_count int,
  add column if not exists storage_object_count int,
  add column if not exists is_encrypted boolean not null default false,
  add column if not exists encryption_algorithm text,
  add column if not exists is_complete boolean;

comment on column public.system_backups.archive_format is
  'Physical format actually written: ''json_gz'' (module16 legacy) or ''zip'' (module42+). NULL on rows predating this column — render those as legacy, never as ZIP.';
comment on column public.system_backups.coverage is
  'Per-data-source outcome actually observed during the run: included / partial / excluded, with row or object counts. Written from real results, never from the intended source list.';
comment on column public.system_backups.excluded is
  'Data sources deliberately or unavoidably left out, each with a machine-readable reason (secret_bearing, size_budget_exceeded, unsupported_by_platform, inaccessible). This is what keeps "not in the archive" from being indistinguishable from "silently missed".';
comment on column public.system_backups.is_complete is
  'TRUE only when every in-scope source was fully captured. A run that hit the size budget or skipped an unreadable object is complete=false even though status=''completed'' — "the job finished" and "the archive holds everything" are different claims.';

-- ---------------------------------------------------------
-- 11. backup_schedule — the fields §7 asks for that don't exist yet.
-- ---------------------------------------------------------
alter table public.backup_schedule
  add column if not exists name text,
  add column if not exists day_of_month int check (day_of_month is null or day_of_month between 1 and 28),
  add column if not exists notify_on_failure boolean not null default true,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_run_status text,
  add column if not exists last_run_backup_id uuid references public.system_backups(backup_id),
  add column if not exists next_run_at timestamptz;

comment on column public.backup_schedule.day_of_month is
  'Day-of-month for a monthly schedule, capped at 28 so a monthly backup cannot silently skip February or land on a non-existent 31st.';
comment on column public.backup_schedule.next_run_at is
  'Informational mirror of the pg_cron job''s next due time, for display. cron.job remains the single source of truth for when a run actually fires — this column never drives execution.';

-- ---------------------------------------------------------
-- 12. Storage bucket — module16 capped this at 50MB and allowed only
--     JSON/gzip, so a ZIP archive literally cannot be uploaded today.
--     Raised to 512MB and ZIP permitted. The bucket stays PRIVATE
--     (public flag untouched) and existing policies are unchanged.
-- ---------------------------------------------------------
update storage.buckets
set file_size_limit = 536870912,
    allowed_mime_types = array['application/json', 'application/gzip', 'application/zip', 'application/octet-stream']
where id = 'system-backups';

-- ---------------------------------------------------------
-- 13. list_backup_tables() — dynamic discovery.
--
-- §4A of the brief: "Do not hardcode a short list of known tables and
-- assume it represents the entire database." This reads pg_catalog at
-- run time, so a table added by a future module shows up as either
-- in-scope or explicitly excluded — it can never be silently absent.
--
-- The exclusion list is the security-critical part and is deliberately
-- enumerated here (not in TypeScript) so it lives in the same place as
-- the discovery itself:
--   * backup_authorization / backup_auth_grants / security_passcodes /
--     protected_access_grants — credential verifiers and auth grants.
--     Exporting a password verifier into a downloadable archive would
--     hand an offline bcrypt-cracking target to anyone holding the ZIP.
--   * case_access_tokens / case_client_links — hashed walk-in case
--     access tokens; same reasoning.
--   * push_tokens — live device push addresses.
--   * system_backups / backup_schedule / system_restores — the backup
--     catalog itself. Restoring it would overwrite the true history of
--     backups and restores with a stale snapshot, including marking
--     already-pruned archives as present.
-- ---------------------------------------------------------
create or replace function public.list_backup_tables()
returns table (table_name text, in_scope boolean, exclusion_reason text, estimated_rows bigint)
language sql
stable
security definer
set search_path = public
as $$
  with excluded(name, reason) as (
    values
      ('backup_authorization',    'secret_bearing'),
      ('backup_auth_grants',      'secret_bearing'),
      ('security_passcodes',      'secret_bearing'),
      ('protected_access_grants', 'secret_bearing'),
      ('case_access_tokens',      'secret_bearing'),
      ('case_client_links',       'secret_bearing'),
      ('push_tokens',             'secret_bearing'),
      ('system_backups',          'backup_catalog'),
      ('backup_schedule',         'backup_catalog'),
      ('system_restores',         'backup_catalog')
  )
  select
    c.relname::text,
    (e.name is null) as in_scope,
    e.reason::text,
    greatest(c.reltuples::bigint, 0) as estimated_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join excluded e on e.name = c.relname
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

comment on function public.list_backup_tables() is
  'Run-time discovery of every public table, each marked in-scope or excluded-with-reason. Replaces a hardcoded export list so a table added by a future migration is reported rather than silently missed. estimated_rows is pg_class.reltuples (planner estimate, cheap) and is for budgeting/preview only — never reported as an exact backed-up count.';

revoke all on function public.list_backup_tables() from public, anon;
grant execute on function public.list_backup_tables() to authenticated;

-- ---------------------------------------------------------
-- 14. export_schema_ddl() — real, executable definitions pulled from
--     the catalog (pg_get_functiondef / pg_get_triggerdef /
--     pg_get_viewdef / pg_get_constraintdef / pg_indexes.indexdef),
--     plus a column inventory for table comparison.
--
-- SCOPE HONESTY: this is a schema EXPORT for comparison and
-- operator-reviewed reconstruction. It is NOT a pg_dump replacement and
-- the restore path deliberately never executes it automatically —
-- recreating 40+ interdependent modules' objects in the correct
-- dependency order, with the right extensions and ownership, is an
-- operator-reviewed procedure, not a button. See the Edge Function's
-- own notes.
-- ---------------------------------------------------------
create or replace function public.export_schema_ddl()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name, 'column', column_name, 'type', data_type,
        'nullable', is_nullable, 'default', column_default, 'position', ordinal_position
      ) order by table_name, ordinal_position), '[]'::jsonb)
      from information_schema.columns where table_schema = 'public'
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', cl.relname, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid)
      ) order by cl.relname, con.conname), '[]'::jsonb)
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public'
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', indexname, 'definition', indexdef
      ) order by tablename, indexname), '[]'::jsonb)
      from pg_indexes where schemaname = 'public'
    ),
    'functions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.proname, 'definition', pg_get_functiondef(p.oid)
      ) order by p.proname), '[]'::jsonb)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
    ),
    'triggers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', cl.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid)
      ) order by cl.relname, t.tgname), '[]'::jsonb)
      from pg_trigger t
      join pg_class cl on cl.oid = t.tgrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', policyname, 'command', cmd,
        'roles', roles, 'using', qual, 'check', with_check
      ) order by tablename, policyname), '[]'::jsonb)
      from pg_policies where schemaname = 'public'
    ),
    'rls_enabled', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname, 'enabled', c.relrowsecurity
      ) order by c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ),
    'enums', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', t.typname, 'values', (
          select jsonb_agg(e.enumlabel order by e.enumsortorder)
          from pg_enum e where e.enumtypid = t.oid
        )
      ) order by t.typname), '[]'::jsonb)
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e'
    ),
    'views', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', c.relname, 'materialized', (c.relkind = 'm'),
        'definition', pg_get_viewdef(c.oid, true)
      ) order by c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
    ),
    'extensions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', extname, 'version', extversion
      ) order by extname), '[]'::jsonb)
      from pg_extension
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.export_schema_ddl() is
  'Catalog-sourced schema export: column inventory plus REAL executable definitions for constraints, indexes, functions, triggers, views, and the policy/RLS/enum/extension inventory. For archive inclusion, schema comparison, and operator-reviewed reconstruction — deliberately NOT auto-executed by restore, because ordering 40+ interdependent modules'' objects correctly is an operator procedure, not a button. service_role only (it returns every policy predicate in the database).';

revoke all on function public.export_schema_ddl() from public, authenticated, anon;

-- ---------------------------------------------------------
-- 15. list_backup_cron_jobs() — scheduled-job inventory for the
--     archive's configuration/ folder.
--
-- *** THE COMMAND TEXT IS REDACTED ON PURPOSE. ***
-- module16's set_backup_schedule() builds its cron command with
-- format(..., %L, v_secret) — i.e. the backup dispatch secret is
-- INTERPOLATED INTO cron.job.command as a literal. module8's push
-- dispatch job does the same with its own secret. Exporting command
-- text verbatim would therefore copy live shared secrets into a
-- downloadable backup archive — exactly what §4D forbids. Only the
-- schedule shape (name, cron expression, active flag) is returned,
-- plus a boolean saying whether a secret was detected and withheld, so
-- the omission is visible rather than silent.
-- ---------------------------------------------------------
create or replace function public.list_backup_cron_jobs()
returns table (jobname text, schedule text, active boolean, command_redacted boolean)
language sql
stable
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    (j.command ilike '%secret%' or j.command ilike '%x-internal%') as command_redacted
  from cron.job j
  order by j.jobname;
$$;

comment on function public.list_backup_cron_jobs() is
  'Scheduled-job inventory (name, cron expression, active flag) for the backup archive''s configuration/scheduled-jobs.json. Deliberately NEVER returns cron.job.command: module16/module8 interpolate their dispatch SECRETS directly into that command text, so exporting it would place live shared secrets inside a downloadable archive. command_redacted flags that a secret was detected and withheld, so the omission is visible rather than silent. service_role only.';

revoke all on function public.list_backup_cron_jobs() from public, authenticated, anon;

-- ---------------------------------------------------------
-- 16. list_table_dependencies() — real primary keys and real foreign-key
--     edges, read from the catalog.
--
-- §13 requires "dependency-aware schema restoration". A hand-maintained
-- ordering list for 30+ tables would be wrong the first time a module
-- adds a foreign key and nobody remembers to update it. This returns the
-- actual constraint graph so the restore function can topologically sort
-- it at run time, and returns the actual primary-key columns so no
-- caller has to guess a column name for an upsert's ON CONFLICT.
--
-- Self-references are reported but must be ignored when ordering (a
-- table that references itself cannot be ordered before itself; such
-- rows are handled by the upsert itself, which is why restore upserts
-- rather than inserts).
-- ---------------------------------------------------------
create or replace function public.list_table_dependencies()
returns table (table_name text, pk_columns text[], depends_on text[])
language sql
stable
security definer
set search_path = public
as $$
  with pk as (
    select cl.relname::text as tbl,
           array_agg(a.attname::text order by k.ord) as cols
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = cl.oid and a.attnum = k.attnum
    where con.contype = 'p' and n.nspname = 'public'
    group by cl.relname
  ),
  fk as (
    select child.relname::text as tbl,
           array_agg(distinct parent.relname::text) as parents
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_class parent on parent.oid = con.confrelid
    join pg_namespace n on n.oid = child.relnamespace
    where con.contype = 'f'
      and n.nspname = 'public'
      and child.relname <> parent.relname  -- self-reference: see comment
    group by child.relname
  )
  select c.relname::text,
         coalesce(pk.cols, array[]::text[]),
         coalesce(fk.parents, array[]::text[])
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pk on pk.tbl = c.relname
  left join fk on fk.tbl = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname;
$$;

comment on function public.list_table_dependencies() is
  'Catalog-sourced primary-key columns and foreign-key parent tables for every public table, so backup-restore can topologically order its upserts and use real PK columns in ON CONFLICT instead of a hand-maintained list that would silently rot as modules add constraints. Self-referencing FKs are excluded from depends_on (a table cannot precede itself); the upsert handles those rows. service_role only.';

revoke all on function public.list_table_dependencies() from public, authenticated, anon;

-- ---------------------------------------------------------
-- 17. Audit triggers on the new tables, same generic trigger every
--     other tracked table in this schema uses.
--
--     NOTE: audit_row_change writes old/new row images into
--     audit_logs.new_values. backup_authorization's row contains the
--     bcrypt verifier, so it is deliberately NOT given this trigger —
--     that would copy the hash into a table many more roles can read.
--     Password set/rotate/verify events are audited explicitly by the
--     Edge Function with metadata only (never the hash, never the
--     submitted password).
-- ---------------------------------------------------------
drop trigger if exists trg_audit_backup_auth_grants on public.backup_auth_grants;
create trigger trg_audit_backup_auth_grants after insert or update or delete on public.backup_auth_grants
  for each row execute procedure public.audit_row_change('grant_id');


-- =========================================================
-- ONE-TIME OPERATOR SETUP — run these yourself, once, with real
-- values. NOT part of the idempotent script above.
--
-- 1. Archive encryption key (AES-256-GCM). Generate 32 random bytes
--    and set it as an Edge Function secret:
--
--      openssl rand -base64 32
--      supabase secrets set BACKUP_ENCRYPTION_KEY=<that base64 value>
--
--    *** ESCROW A COPY OUTSIDE SUPABASE. ***
--    This key is NOT stored in the database and is NOT inside any
--    archive (that would defeat the purpose). If the Supabase project
--    is lost and this key was only ever held there, every encrypted
--    archive becomes permanently unreadable — the backups would be
--    lost along with the thing they exist to recover. Store it in the
--    organisation's password manager / sealed offline copy, with at
--    least two authorized holders.
--
-- 2. Provision the dedicated backup password — do this through the
--    admin UI's "Backup Security" panel (which posts to the
--    backup-auth Edge Function), NOT with SQL. There is deliberately
--    no SQL path that takes a plaintext password here, because SQL
--    editor history would retain it.
--
-- 3. Deploy the new function:
--      supabase functions deploy backup-auth
-- =========================================================


-- =========================================================
-- VERIFICATION — run separately, after everything above.
-- =========================================================

-- 1. New objects exist:
--   select enumlabel from pg_enum where enumtypid = 'backup_frequency'::regtype order by enumsortorder; -- expect daily, weekly, monthly
--   select relrowsecurity from pg_class where relname in ('backup_authorization','backup_auth_grants'); -- expect t, t
--   select proname from pg_proc where proname in ('set_backup_password','verify_backup_password_and_grant','consume_backup_grant','list_backup_tables','export_schema_ddl','is_active_technical_admin','has_backup_password');

-- 2. The verifier is unreachable from the client (expect false for all):
--   select has_table_privilege('authenticated', 'public.backup_authorization', 'SELECT');
--   select has_table_privilege('anon', 'public.backup_authorization', 'SELECT');
--   select has_function_privilege('authenticated', 'public.verify_backup_password_and_grant(uuid,text,text,uuid,integer)', 'EXECUTE');
--   select has_function_privilege('authenticated', 'public.set_backup_password(uuid,text,text)', 'EXECUTE');
--   select has_function_privilege('authenticated', 'public.export_schema_ddl()', 'EXECUTE');

-- 3. Discovery actually sees every table and flags the secret-bearing
--    ones (expect in_scope=false with a reason for all 10 excluded):
--   select table_name, in_scope, exclusion_reason from public.list_backup_tables() where not in_scope;
--   select count(*) from public.list_backup_tables(); -- compare against: select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';

-- 4. The ZIP upload path is actually open now (expect 536870912 and a
--    list containing application/zip, public = false):
--   select file_size_limit, allowed_mime_types, public from storage.buckets where id = 'system-backups';

-- 5. Role scoping — as provincial_admin/super_admin expect a row; as
--    provincial_staff/municipal_admin/barangay_admin expect 42501:
--   select * from public.has_backup_password();

-- 6. Grant scope is really enforced. Mint a 'download' grant for backup
--    A (via the Edge Function), then confirm each of these is refused:
--   select * from public.consume_backup_grant('<grant>', '<profile>', 'restore_execute', '<A>'); -- wrong_operation
--   select * from public.consume_backup_grant('<grant>', '<profile>', 'download', '<B>');        -- wrong_target
--   select * from public.consume_backup_grant('<grant>', '<other-profile>', 'download', '<A>');  -- wrong_user
--   select * from public.consume_backup_grant('<grant>', '<profile>', 'download', '<A>');        -- ok (first use)
--   select * from public.consume_backup_grant('<grant>', '<profile>', 'download', '<A>');        -- already_used

-- 7. Lockout really escalates (expect locked=true, retry_after=60 on
--    the 3rd consecutive wrong password):
--   select * from public.verify_backup_password_and_grant('<profile>', 'wrong', 'download', '<A>');


-- =========================================================
-- 18. EXPLICIT service_role EXECUTE GRANTS — do not remove.
--
-- This section exists because of a real, previously-shipped bug class in
-- this project: module33 revoked EXECUTE from `authenticated` on
-- functions its Edge Function then called AS `authenticated`, so every
-- call failed 42501 and module34 had to be written to repair it.
--
-- The same trap applies here in the opposite direction. Every `revoke
-- all on function ... from public` above ALSO strips `service_role`,
-- because a non-superuser role's EXECUTE on a function comes from the
-- PUBLIC default unless it is granted explicitly, and Supabase's
-- `service_role` is a normal (nologin, bypassrls) role — NOT a
-- superuser. RLS bypass is not privilege bypass: GRANT and RLS are
-- separate layers, the same lesson module3_barangay_hierarchy.sql and
-- module16 both record for TABLE privileges.
--
-- Every function listed below is invoked by an Edge Function using the
-- SERVICE-ROLE client (deliberately — the privileged ones must not be
-- reachable from a browser holding only an admin JWT, which is why they
-- stay revoked from `authenticated`). Without these grants the entire
-- Backup & Restore module fails closed with 42501 at run time.
-- =========================================================

-- Dedicated-password lifecycle — called by backup-auth with service role.
grant execute on function public.set_backup_password(uuid, text, text) to service_role;
grant execute on function public.verify_backup_password_and_grant(uuid, text, text, uuid, integer) to service_role;

-- Grant enforcement — called by backup-create and backup-restore.
grant execute on function public.consume_backup_grant(uuid, uuid, text, uuid) to service_role;

-- Archive content sources — called by backup-create/backup-restore.
grant execute on function public.list_backup_tables() to service_role;
grant execute on function public.export_schema_ddl() to service_role;
grant execute on function public.list_backup_cron_jobs() to service_role;
grant execute on function public.list_table_dependencies() to service_role;

-- has_backup_password() is called AS THE CALLER (it gates itself on
-- is_provincial_technical_admin(), which needs auth.uid() to resolve to
-- the operator), so it keeps its `authenticated` grant from section 6
-- and does not need a service_role grant. Listed here explicitly so the
-- asymmetry reads as deliberate rather than forgotten.

-- The two bcrypt helpers are intentionally granted to NOBODY. They are
-- called only from the SECURITY DEFINER functions above, which execute
-- with the function owner's rights rather than the caller's — so they
-- need no grant at all, and giving them one would create a way to
-- hash/verify arbitrary strings directly.


-- =========================================================
-- VERIFICATION for section 18 — run after applying.
-- Expect TRUE for every row:
--   select
--     has_function_privilege('service_role', 'public.set_backup_password(uuid,text,text)', 'EXECUTE')                                  as set_pw,
--     has_function_privilege('service_role', 'public.verify_backup_password_and_grant(uuid,text,text,uuid,integer)', 'EXECUTE')        as verify_pw,
--     has_function_privilege('service_role', 'public.consume_backup_grant(uuid,uuid,text,uuid)', 'EXECUTE')                            as consume,
--     has_function_privilege('service_role', 'public.list_backup_tables()', 'EXECUTE')                                                 as list_tables,
--     has_function_privilege('service_role', 'public.export_schema_ddl()', 'EXECUTE')                                                  as schema_ddl,
--     has_function_privilege('service_role', 'public.list_backup_cron_jobs()', 'EXECUTE')                                              as cron_jobs,
--     has_function_privilege('service_role', 'public.list_table_dependencies()', 'EXECUTE')                                            as deps;
--
-- And expect FALSE for every row (the browser must not reach these):
--   select
--     has_function_privilege('authenticated', 'public.set_backup_password(uuid,text,text)', 'EXECUTE')                                 as set_pw,
--     has_function_privilege('authenticated', 'public.verify_backup_password_and_grant(uuid,text,text,uuid,integer)', 'EXECUTE')       as verify_pw,
--     has_function_privilege('authenticated', 'public.consume_backup_grant(uuid,uuid,text,uuid)', 'EXECUTE')                           as consume,
--     has_function_privilege('authenticated', 'public.export_schema_ddl()', 'EXECUTE')                                                 as schema_ddl,
--     has_function_privilege('anon', 'public.list_backup_tables()', 'EXECUTE')                                                         as anon_tables;


-- =========================================================
-- 19. set_backup_schedule_authorized() — the dedicated-password gate
--     in front of module16's existing set_backup_schedule().
--
-- WHY A WRAPPER instead of editing set_backup_schedule(): that function
-- is module16's, is already correct, and is what keeps the
-- backup_schedule row and the real cron.job entry atomically in sync.
-- Changing its signature would be a breaking change to a working
-- component this module was told not to rebuild. The wrapper adds the
-- new factor and delegates.
--
-- The schedule is changed from the BROWSER via PostgREST (unlike the
-- backup/restore operations, which go through Edge Functions), so the
-- grant has to be consumable by an `authenticated` caller. That is safe
-- here because:
--   * this function is SECURITY DEFINER, so it calls
--     consume_backup_grant() with the OWNER's rights — the caller still
--     cannot reach consume_backup_grant() directly (it stays revoked
--     from authenticated), and therefore cannot spend a grant for any
--     operation other than the two schedule ones checked below;
--   * the profile is taken from current_profile_id() (i.e. from the
--     JWT), NOT from a parameter, so a caller cannot spend someone
--     else's grant;
--   * set_backup_schedule()'s own is_provincial_technical_admin() check
--     still runs, so the role boundary is enforced twice.
-- =========================================================

create or replace function public.set_backup_schedule_authorized(
  p_grant_id uuid,
  p_operation text,
  p_enabled boolean,
  p_frequency backup_frequency,
  p_hour_utc int,
  p_day_of_week int default null,
  p_retention_days int default 30
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_consumed record;
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Only the two schedule operations may be spent here. This is what
  -- stops a 'download' or 'restore_execute' grant from being redirected
  -- into a schedule change.
  if p_operation not in ('schedule_create', 'schedule_modify') then
    raise exception 'A schedule change requires a schedule_create or schedule_modify authorization, not %', p_operation
      using errcode = '42501';
  end if;

  select * into v_consumed
  from public.consume_backup_grant(p_grant_id, v_profile_id, p_operation, null);

  if not v_consumed.ok then
    raise exception 'BACKUP_AUTH_REQUIRED: %', v_consumed.reason using errcode = '42501';
  end if;

  -- Delegates to module16's unchanged function, which re-checks
  -- is_provincial_technical_admin() and keeps the cron job in sync.
  perform public.set_backup_schedule(p_enabled, p_frequency, p_hour_utc, p_day_of_week, p_retention_days);

  insert into public.audit_logs (profile_id, action, table_name, new_values)
  values (
    v_profile_id,
    'BACKUP_SCHEDULE_CHANGED',
    'backup_schedule',
    jsonb_build_object(
      'enabled', p_enabled,
      'frequency', p_frequency,
      'hour_utc', p_hour_utc,
      'day_of_week', p_day_of_week,
      'retention_days', p_retention_days,
      'authorized_via', p_operation
    )
  );
end;
$$;

comment on function public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int) is
  'Dedicated-password-gated wrapper around module16''s set_backup_schedule(). Spends a schedule_create/schedule_modify grant (bound to the JWT''s own profile, never a parameter), refuses grants minted for any other operation, then delegates to the unchanged module16 function. Granted to authenticated because the schedule is changed from the browser over PostgREST; consume_backup_grant() itself stays revoked from authenticated and is reached only through this SECURITY DEFINER wrapper.';

revoke all on function public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int) from public, anon;
grant execute on function public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int) to authenticated;

-- VERIFICATION
-- 1. Expect TRUE then FALSE:
--   select has_function_privilege('authenticated', 'public.set_backup_schedule_authorized(uuid,text,boolean,backup_frequency,int,int,int)', 'EXECUTE');
--   select has_function_privilege('anon', 'public.set_backup_schedule_authorized(uuid,text,boolean,backup_frequency,int,int,int)', 'EXECUTE');
-- 2. A 'download' grant must be refused by the wrapper (expect 42501
--    "requires a schedule_create or schedule_modify authorization"):
--   select public.set_backup_schedule_authorized('<download grant>', 'download', true, 'daily', 2, null, 30);
-- 3. A valid schedule grant must work once and then be spent (second
--    call expects BACKUP_AUTH_REQUIRED: already_used):
--   select public.set_backup_schedule_authorized('<schedule grant>', 'schedule_modify', true, 'daily', 2, null, 30);
--   select public.set_backup_schedule_authorized('<same grant>', 'schedule_modify', true, 'daily', 2, null, 30);

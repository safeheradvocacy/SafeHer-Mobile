-- Module 33: Mobile Security Passcode
--
-- A second, confidentiality-scoped credential for the SafeSpace MOBILE app
-- only (never the admin web portal, never any admin role) — separate from
-- the user's Supabase Auth login password. Required before a survivor can
-- (a) submit a formal incident report, and (b) view their own case
-- tracking / incident narrative / status history. Does NOT gate Emergency
-- SOS, shelter requests, login, or any admin workflow.
--
-- Three pieces:
--   1. public.security_passcodes       -- the verifier (hash + lockout
--      state). Locked down with RLS + no grants at all to
--      authenticated/anon -- reachable ONLY via the SECURITY DEFINER
--      functions below and the service-role Edge Function. This is the
--      "never a client-readable profile field, never a plain client
--      query" requirement from the governing spec.
--   2. public.protected_access_grants  -- short-lived, server-timestamped
--      proof that THIS profile recently passed passcode verification.
--      Bound to profile_id (hence to the authenticated session), checked
--      fresh on every read via has_active_protected_access() -- never
--      trusted from client-held state or the device clock.
--   3. user_profiles.passcode_enrolled -- a lightweight, client-readable
--      BOOLEAN status flag (not the verifier) so the app can cheaply ask
--      "do I need to show enrollment" without a round trip to a locked
--      table. Deliberately given NO update grant to authenticated/anon,
--      matching this project's existing column-grant convention (see
--      module2's `is_active` and module10's `phone_verified`, both of
--      which are equally narrow, intentionally-omit-blanket-grants
--      precedents) -- the only way to flip this column is through the
--      SECURITY DEFINER functions below, which run with the function
--      owner's privileges regardless of the caller's own grants.
--
-- Hashing: pgcrypto's crypt()/gen_salt('bf', <rounds>) -- i.e. bcrypt,
-- salted and deliberately slow -- NOT the plain digest(...,'sha256') this
-- project already uses for hash_access_token() in module14. That's a
-- correct, different choice for a DIFFERENT problem: hash_access_token()
-- hashes a 32-random-byte, high-entropy, machine-generated token, where a
-- fast salted-by-construction hash is fine. A security passcode is
-- human-chosen and comparatively low-entropy, so it specifically needs a
-- slow, salted, purpose-built password KDF -- bcrypt is pgcrypto's
-- built-in one. This avoids pulling in any new Deno/npm dependency for an
-- Edge Function (this repo's Edge Functions use zero npm: imports today,
-- confirmed across all six existing functions) and keeps the one existing
-- precedent for "a secret never leaves SQL" fully intact.

create extension if not exists pgcrypto with schema extensions;

-- New notification_type value for Phase 9's in-app enrollment reminder --
-- in-app only (deliberately not added to the push-dispatch allow-list in
-- module8_notifications_push.sql, which already enumerates every type
-- that triggers a push send; this project only ever claims push for the
-- types explicitly listed there, and this feature does not add remote
-- push for the passcode reminder).
alter type notification_type add value if not exists 'Security';

-- ===========================================================================
-- 1. Enrollment status flag on user_profiles
-- ===========================================================================

alter table public.user_profiles
  add column if not exists passcode_enrolled boolean not null default false;

comment on column public.user_profiles.passcode_enrolled is
  'Mobile-only security passcode enrollment status. Client-readable (so the app can check cheaply) but NOT client-writable -- deliberately has no update grant to authenticated/anon. Only ever set true by enroll_security_passcode()/by the security-passcode Edge Function, and reset to false by reset_security_passcode(). The actual verifier is never stored here -- see security_passcodes.';

-- ===========================================================================
-- 2. The verifier table -- fully locked down
-- ===========================================================================

create table if not exists public.security_passcodes (
  profile_id      uuid primary key references public.user_profiles(profile_id) on delete cascade,
  passcode_hash   text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.security_passcodes is
  'The mobile security passcode verifier (bcrypt hash) and its failed-attempt/lockout state. RLS-enabled with zero grants to authenticated/anon -- reachable only through the SECURITY DEFINER functions below (invoker rights come from the function owner, not the caller) and the security-passcode Edge Function''s service-role client. Never selected, inserted, or updated directly by any client query.';

alter table public.security_passcodes enable row level security;
-- Deliberately no `create policy` + no `grant ... to authenticated/anon`
-- at all -- default-deny. Compare to protected_access_grants below, same
-- pattern.
revoke all on public.security_passcodes from authenticated, anon;

-- ===========================================================================
-- 3. Short-lived protected-access grants
-- ===========================================================================

create table if not exists public.protected_access_grants (
  grant_id    uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.user_profiles(profile_id) on delete cascade,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

comment on table public.protected_access_grants is
  'Server-timestamped proof that profile_id recently passed passcode verification. Checked fresh (real server now()) by has_active_protected_access() on every protected read -- a client never holds or presents a token for this; the grant is bound purely to the authenticated profile_id, exactly like every other RLS check in this project. Revoked (revoked_at set) on passcode change/reset, logout-adjacent security events, and explicit lock. RLS-enabled, zero client grants, same as security_passcodes.';

alter table public.protected_access_grants enable row level security;
revoke all on public.protected_access_grants from authenticated, anon;

create index if not exists idx_protected_access_grants_active
  on public.protected_access_grants (profile_id, expires_at)
  where revoked_at is null;

-- ===========================================================================
-- 4. Hashing helpers (SQL-only, mirrors hash_access_token()'s shape)
-- ===========================================================================

create or replace function public.hash_security_passcode(p_passcode text)
returns text
language sql
stable
set search_path = public
as $$
  select extensions.crypt(p_passcode, extensions.gen_salt('bf', 12));
$$;

comment on function public.hash_security_passcode(text) is
  'bcrypt-hashes a passcode with a fresh random salt (cost factor 12). Only ever called from the other SECURITY DEFINER functions below / the Edge Function -- never exposed to PostgREST directly (no grant to authenticated/anon).';

revoke all on function public.hash_security_passcode(text) from public, authenticated, anon;

create or replace function public.verify_security_passcode_hash(p_passcode text, p_hash text)
returns boolean
language sql
stable
set search_path = public
as $$
  -- bcrypt's own scheme identifier/salt/cost are embedded in p_hash
  -- itself (the standard $2a$/$2b$ format) -- crypt() reads them back out
  -- of p_hash to recompute with the SAME salt, so equality here is a
  -- correct constant-shape comparison, not a timing-unsafe shortcut.
  select p_hash = extensions.crypt(p_passcode, p_hash);
$$;

comment on function public.verify_security_passcode_hash(text, text) is
  'Checks a plaintext passcode against a previously-computed bcrypt hash. Only ever called from verify_security_passcode() below -- never exposed to PostgREST directly.';

revoke all on function public.verify_security_passcode_hash(text, text) from public, authenticated, anon;

-- ===========================================================================
-- 5. SECURITY DEFINER functions -- the only way in or out of the tables above
-- ===========================================================================

-- Enrollment status -- safe to expose directly to the client as an RPC,
-- since it returns only a boolean, never touches security_passcodes'
-- contents.
create or replace function public.has_security_passcode()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select passcode_enrolled from public.user_profiles where profile_id = public.current_profile_id()),
    false
  );
$$;

comment on function public.has_security_passcode() is
  'Whether the calling user has enrolled a mobile security passcode. Safe for direct client RPC use -- returns only a boolean.';

grant execute on function public.has_security_passcode() to authenticated;

-- Phase 9 reminder. Ensures exactly one unread 'Security' notification
-- exists for the calling user -- a no-op if one is already pending
-- (dedup -- "do not create duplicate reminders on every login") or if
-- they're already enrolled. The mobile app calls this once whenever it
-- confirms enrolled === false (see PasscodeContext.refreshEnrollmentStatus),
-- which naturally covers every case the governing spec lists the same
-- way (new account post-verification, existing unenrolled account,
-- interrupted enrollment) without needing separate triggers for each.
-- Content is deliberately generic -- no passcode, survivor identity, or
-- case detail of any kind, matching every other notification this
-- project sends.
create or replace function public.ensure_passcode_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    return;
  end if;
  if (select passcode_enrolled from public.user_profiles where profile_id = v_profile_id) then
    return;
  end if;
  if exists (
    select 1 from public.notifications
    where profile_id = v_profile_id and notification_type = 'Security' and is_read = false
  ) then
    return;
  end if;
  insert into public.notifications (profile_id, notification_type, title, message)
  values (
    v_profile_id,
    'Security',
    'Protect Your Case Information',
    'Create your SafeSpace security passcode to help protect your confidential case information. You must complete setup before submitting incident reports or viewing protected case details.'
  );
end;
$$;

comment on function public.ensure_passcode_reminder() is
  'Idempotently ensures the calling user has a pending Phase-9 passcode-enrollment reminder notification if (and only if) they are not yet enrolled. Safe for direct client RPC use -- can only ever affect the caller''s own notifications.';

grant execute on function public.ensure_passcode_reminder() to authenticated;

-- Active protected-access-grant check -- also safe to expose directly,
-- and is the function wired into the RLS policies below (see
-- module33 policy additions further down).
create or replace function public.has_active_protected_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.protected_access_grants
    where profile_id = public.current_profile_id()
      and revoked_at is null
      and expires_at > now()
  );
$$;

comment on function public.has_active_protected_access() is
  'Whether the calling user currently holds a non-expired, non-revoked protected-access grant (i.e. verified their security passcode within the configured window). Evaluated fresh against the real server clock on every call -- never trusts a client-reported expiry. Used both as a direct client RPC (so the mobile app can decide whether to show the Verify Passcode screen before even attempting a protected fetch) AND inside the case_reports/case_status_history SELECT policies below, which is the actual trusted-backend enforcement boundary.';

grant execute on function public.has_active_protected_access() to authenticated;

-- Enrollment (first-time passcode creation). SECURITY DEFINER so it can
-- write to the locked-down security_passcodes table and flip
-- user_profiles.passcode_enrolled, neither of which the caller's own
-- `authenticated` grants would otherwise allow.
create or replace function public.enroll_security_passcode(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.security_passcodes where profile_id = v_profile_id) then
    raise exception 'a security passcode is already enrolled for this account' using errcode = '23505';
  end if;
  -- Length floor enforced again here as a backstop -- the real policy
  -- (length, strength estimate, breach-list check) is applied client-side
  -- and in the Edge Function before this is ever called; this is just the
  -- last trusted boundary refusing an obviously-too-short value outright.
  if length(p_passcode) < 8 then
    raise exception 'passcode does not meet the minimum length requirement' using errcode = '22023';
  end if;

  insert into public.security_passcodes (profile_id, passcode_hash)
  values (v_profile_id, public.hash_security_passcode(p_passcode));

  update public.user_profiles set passcode_enrolled = true where profile_id = v_profile_id;

  -- Phase 9: resolves any pending enrollment-reminder notification --
  -- marked read rather than deleted, consistent with how every other
  -- notification in this project is "completed" (is_read), not removed.
  update public.notifications
    set is_read = true
    where profile_id = v_profile_id and notification_type = 'Security' and is_read = false;
end;
$$;

comment on function public.enroll_security_passcode(text) is
  'First-time passcode enrollment for the calling (mobile) user. Raises if already enrolled -- callers must go through reset_security_passcode() to replace an existing one. Not granted to authenticated/anon directly -- called only from the security-passcode Edge Function, which has already re-verified the caller''s session and applied the full strength policy before reaching here.';

revoke all on function public.enroll_security_passcode(text) from public, authenticated, anon;

-- Verification. Returns a small result row rather than a bare boolean so
-- the caller can distinguish "wrong code" from "temporarily locked" and
-- show the right message/cooldown -- mirrors the shape other
-- attempt-limited flows in this app already return (e.g. AuthContext's
-- friendly-error pattern), just expressed as SQL output columns instead
-- of a TS union.
create or replace function public.verify_security_passcode(p_passcode text)
returns table (success boolean, locked boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_row public.security_passcodes%rowtype;
  v_now timestamptz := now();
  v_lock_seconds integer;
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.security_passcodes where profile_id = v_profile_id for update;
  if not found then
    -- No passcode enrolled at all -- not a "wrong code", a distinct state
    -- the caller (Edge Function) already knows about via
    -- has_security_passcode() before ever calling this, so this is just
    -- a defensive backstop.
    return query select false, false, null::integer;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select false, true, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer;
    return;
  end if;

  if public.verify_security_passcode_hash(p_passcode, v_row.passcode_hash) then
    update public.security_passcodes
      set failed_attempts = 0, locked_until = null, updated_at = v_now
      where profile_id = v_profile_id;

    -- Issue a fresh 5-minute protected-access grant. Does not revoke any
    -- still-valid prior grant (there normally isn't one -- the app only
    -- calls this when it doesn't already have an active one) but
    -- harmlessly layers if it does; has_active_protected_access() just
    -- needs ANY non-expired row to exist.
    insert into public.protected_access_grants (profile_id, expires_at)
    values (v_profile_id, v_now + interval '5 minutes');

    return query select true, false, null::integer;
    return;
  end if;

  -- Wrong code: escalating lockout. 5 misses -> 1 minute, 10 -> 5
  -- minutes, 15+ -> 15 minutes (capped) -- deliberately short-and-escalating
  -- rather than one long lock, so a genuine user who mistypes a few times
  -- isn't shut out for long, while sustained guessing gets progressively
  -- more expensive. No precedent for this in the existing codebase (first
  -- rate-limiting mechanism of its kind in this project), kept entirely
  -- self-contained in this one table rather than overloading audit_logs.
  v_lock_seconds := null;
  if v_row.failed_attempts + 1 >= 15 then
    v_lock_seconds := 900;
  elsif v_row.failed_attempts + 1 >= 10 then
    v_lock_seconds := 300;
  elsif v_row.failed_attempts + 1 >= 5 then
    v_lock_seconds := 60;
  end if;

  update public.security_passcodes
    set failed_attempts = failed_attempts + 1,
        locked_until = case when v_lock_seconds is not null then v_now + make_interval(secs => v_lock_seconds) else locked_until end,
        updated_at = v_now
    where profile_id = v_profile_id;

  return query select false, (v_lock_seconds is not null), v_lock_seconds;
end;
$$;

comment on function public.verify_security_passcode(text) is
  'Verifies a passcode attempt for the calling user, applying server-side lockout. Not granted to authenticated/anon directly -- called only from the security-passcode Edge Function, which logs the outcome to audit_logs (success/failure/lockout) with no passcode content, and which is the only place a mobile client can reach this from.';

revoke all on function public.verify_security_passcode(text) from public, authenticated, anon;

-- Change (requires already holding an active protected-access grant --
-- i.e. the caller just verified their CURRENT passcode) or reset (caller
-- has instead just re-authenticated with their Supabase Auth password,
-- the "appropriate reauthentication" recovery path -- see
-- ChangePasswordScreen.tsx's existing signInWithPassword-before-sensitive-
-- change precedent, reused the same way here). Both funnel through this
-- one function; p_require_active_grant distinguishes which proof the
-- Edge Function already checked before calling it.
create or replace function public.reset_security_passcode(p_new_passcode text, p_require_active_grant boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_require_active_grant and not public.has_active_protected_access() then
    raise exception 'an active protected-access grant is required to change the passcode' using errcode = '28000';
  end if;
  if length(p_new_passcode) < 8 then
    raise exception 'passcode does not meet the minimum length requirement' using errcode = '22023';
  end if;

  insert into public.security_passcodes (profile_id, passcode_hash, failed_attempts, locked_until, updated_at)
  values (v_profile_id, public.hash_security_passcode(p_new_passcode), 0, null, now())
  on conflict (profile_id) do update
    set passcode_hash = excluded.passcode_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();

  update public.user_profiles set passcode_enrolled = true where profile_id = v_profile_id;

  -- Any change or reset invalidates every currently-active grant -- a
  -- verification performed against the OLD passcode must never continue
  -- to authorize access under the new one.
  update public.protected_access_grants
    set revoked_at = now()
    where profile_id = v_profile_id and revoked_at is null and expires_at > now();
end;
$$;

comment on function public.reset_security_passcode(text, boolean) is
  'Replaces (or, for a never-enrolled account, equivalently creates) the calling user''s passcode and revokes all of their currently-active protected-access grants. Not granted to authenticated/anon -- called only from the security-passcode Edge Function after it has independently verified either an active protected-access grant (change flow) or a fresh Supabase Auth password reauthentication (forgot-passcode recovery flow).';

revoke all on function public.reset_security_passcode(text, boolean) from public, authenticated, anon;

-- Explicit lock -- used on logout and when the app backgrounds, so a
-- grant can be revoked immediately server-side rather than only expiring
-- after up to 5 minutes. Safe to expose directly: it can only ever revoke
-- the CALLER's own grants.
create or replace function public.revoke_protected_access()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.protected_access_grants
    set revoked_at = now()
    where profile_id = public.current_profile_id() and revoked_at is null and expires_at > now();
end;
$$;

comment on function public.revoke_protected_access() is
  'Revokes all of the calling user''s currently-active protected-access grants immediately, without waiting for natural expiry. Called on explicit lock (app backgrounded, inactivity timeout reached client-side, or logout) -- safe for direct client RPC since it can only ever touch the caller''s own rows (current_profile_id()).';

grant execute on function public.revoke_protected_access() to authenticated;

-- ===========================================================================
-- 6. Layer protected-access onto the existing survivor-facing case policies
-- ===========================================================================
--
-- Additive only -- ownership/jurisdiction remain exactly as already
-- enforced; this ANDs an extra condition onto the exact two policies a
-- signed-in survivor's own mobile queries actually go through. Admin/
-- staff access (separate, OR'd-in policies/branches) is left completely
-- untouched -- the passcode requirement applies to the mobile survivor
-- role only, matching the governing spec exactly.
--
-- Verbatim current definitions confirmed by direct read before writing
-- this (not guessed): "Survivors can view own cases" is defined once, in
-- module2_case_data_rls.sql:178-181, never redefined by any later module.
-- "Case participants can view status history" is defined in
-- module2_case_data_rls.sql:207-209 and then re-created (superseding
-- module2's version) in module3_barangay_hierarchy.sql:573-576 -- that
-- module3 version, reproduced below with the added AND clause, is the one
-- this migration replaces.

drop policy if exists "Survivors can view own cases" on public.case_reports;
create policy "Survivors can view own cases"
  on public.case_reports for select
  using (
    survivor_id in (select survivor_id from public.survivors where profile_id = public.current_profile_id())
    and public.has_active_protected_access()
  );

-- case_status_history: owns_case() is purely survivor-ownership (module2,
-- no admin logic inside it) -- gating only that branch on the protected-
-- access grant, and leaving admin_can_access_case(case_id) completely
-- untouched, is what keeps this scoped to the survivor/mobile role only.
drop policy if exists "Case participants can view status history" on public.case_status_history;
create policy "Case participants can view status history"
  on public.case_status_history for select
  using (
    (public.owns_case(case_id) and public.has_active_protected_access())
    or public.admin_can_access_case(case_id)
  );

-- case_reports INSERT (formal incident-report submission) -- this is
-- Phase 6's actual trusted-backend boundary: enrollment (not an active
-- unlock -- see the module header) is required, layered alongside the
-- pre-existing ownership and identity-verification checks, neither of
-- which this touches. Verbatim current definition confirmed by direct
-- read: module10_identity_verification.sql:292-298 (which itself
-- superseded module2's original, identity-verification-free version).
drop policy if exists "Survivors can submit own cases" on public.case_reports;
create policy "Survivors can submit own cases"
  on public.case_reports for insert
  with check (
    survivor_id in (select survivor_id from public.survivors where profile_id = public.current_profile_id())
    and public.is_identity_verified()
    and public.has_security_passcode()
  );

-- ===========================================================================
-- 7. QR/walk-in case-access content function (module14) -- the one
--    content-bearing read in that flow not covered by the RLS policies
--    above, since get_client_case() is SECURITY DEFINER and authorizes
--    via case_client_links rather than the case_reports policy itself.
--    Redefined in place (identical signature) purely to add one early
--    return -- every other line is unchanged from module14's version,
--    reproduced here verbatim aside from that one addition.
-- ===========================================================================

create or replace function public.get_client_case(p_case_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_profile_id uuid;
  v_case public.case_reports%rowtype;
  v_owner_label text;
  v_referral_status text;
  v_history jsonb;
begin
  v_profile_id := public.current_profile_id();
  if v_profile_id is null then
    return null;
  end if;

  -- Added by module33: content is withheld (same "not authorized" null
  -- shape the caller already handles) until the caller has a currently
  -- active protected-access grant -- the QR/walk-in path is a content
  -- fetch like any other, not an exemption from the passcode requirement.
  if not public.has_active_protected_access() then
    return null;
  end if;

  if not exists (
    select 1 from public.case_client_links
    where case_id = p_case_id and profile_id = v_profile_id and status = 'verified'
  ) then
    return null;
  end if;

  select * into v_case from public.case_reports where case_id = p_case_id;
  if v_case is null then
    return null;
  end if;

  if v_case.owner_level = 'Barangay' then
    select 'Barangay ' || b.barangay_name into v_owner_label
    from public.barangays b where b.barangay_id = v_case.owner_barangay_id;
  elsif v_case.owner_level = 'Municipality' then
    select m.municipality_name into v_owner_label
    from public.municipalities m where m.municipality_id = v_case.municipality_id;
  else
    v_owner_label := 'Provincial Office';
  end if;

  select sr.referral_status::text into v_referral_status
  from public.shelter_referrals sr
  where sr.case_id = p_case_id
  order by sr.referred_at desc
  limit 1;

  select jsonb_agg(
           jsonb_build_object('status', h.new_status, 'remarks', h.remarks, 'changed_at', h.changed_at)
           order by h.changed_at
         )
    into v_history
  from public.case_status_history h
  where h.case_id = p_case_id;

  return jsonb_build_object(
    'case_id', v_case.case_id,
    'case_number', v_case.case_number,
    'case_type', v_case.case_type,
    'status', v_case.status,
    'priority_level', v_case.priority_level,
    'reported_at', v_case.reported_at,
    'incident_date', v_case.incident_date,
    'assigned_office', coalesce(v_owner_label, '—'),
    'referral_status', v_referral_status,
    'status_history', coalesce(v_history, '[]'::jsonb)
  );
end;
$$;

-- ===========================================================================
-- Deployment order and manual verification
-- ===========================================================================
--
-- 1. Apply this migration (`supabase db push` or the project's normal
--    migration-apply path) BEFORE deploying the `security-passcode` Edge
--    Function -- the function calls enroll_security_passcode(),
--    verify_security_passcode(), and reset_security_passcode(), all of
--    which must already exist.
-- 2. Deploy the `security-passcode` Edge Function
--    (`supabase functions deploy security-passcode`).
-- 3. No backfill is required or performed: every existing user_profiles
--    row already defaults passcode_enrolled to false (the column add
--    above has no data migration step), which is the correct state for
--    every pre-existing account -- they enroll the same way a brand-new
--    verified account does, per the governing spec's "Apply the same
--    policy to existing verified mobile accounts" requirement. No
--    existing case_reports/case_status_history/survivors rows are
--    touched, added, or removed by this migration.
-- 4. This migration was written without live database access in this
--    environment -- the policy/function bodies it replaces were
--    confirmed by direct, line-cited read of the current migration FILES
--    (module2, module3, module10, module14, as cited in comments above),
--    not by a live schema introspection. Before applying to the live
--    project, run the verification queries below against it directly and
--    confirm every result:
--
--   -- a) Exactly one SELECT policy on case_reports named "Survivors can
--   --    view own cases", and it references has_active_protected_access:
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--     where polrelid = 'public.case_reports'::regclass and polname = 'Survivors can view own cases';
--
--   -- b) Same for the case_status_history and case_reports-insert policies:
--   select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--     from pg_policy where polrelid in ('public.case_status_history'::regclass, 'public.case_reports'::regclass);
--
--   -- c) No authenticated/anon grant leaked onto the locked-down tables:
--   select grantee, table_name, privilege_type from information_schema.role_table_grants
--     where table_name in ('security_passcodes', 'protected_access_grants')
--       and grantee in ('authenticated', 'anon');
--   -- expected: zero rows.
--
--   -- d) No authenticated/anon grant on passcode_enrolled specifically:
--   select grantee, privilege_type from information_schema.role_column_grants
--     where table_name = 'user_profiles' and column_name = 'passcode_enrolled'
--       and grantee in ('authenticated', 'anon');
--   -- expected: zero rows (select is fine via the table-level select grant
--   -- from module1b if one covers it -- this check is specifically about
--   -- UPDATE/INSERT not being grantable on this column).
--
--   -- e) As a disposable test account (own JWT, not service-role): confirm
--   --    has_security_passcode()/has_active_protected_access() both
--   --    return false before enrollment, and that a direct
--   --    `select * from security_passcodes` / `select * from
--   --    protected_access_grants` as that same test account returns a
--   --    permission-denied error, not an empty set (empty-but-permitted
--   --    would mean a grant leaked despite (c) above looking clean).

-- =========================================================
-- SafeSpace — Module 45: client IP address in the audit log.
--
-- Run in the Supabase SQL editor AFTER module44.
--
-- NO Part A/Part B SPLIT NEEDED — no enum values are added.
--
-- =========================================================
-- WHAT THIS ADDS
-- =========================================================
-- audit_logs.ip_address  — the client IP that performed the action,
-- captured automatically for every existing audit trigger and for the
-- browser's own audit writes, WITHOUT modifying any of the 22
-- trg_audit_* triggers. That is done with a column DEFAULT: a trigger
-- that does not name the column gets the default evaluated inside its
-- own transaction, where the request headers are still visible.
--
-- =========================================================
-- *** SURVIVOR IP ADDRESSES ARE DELIBERATELY NOT RECORDED ***
-- =========================================================
-- Five audited tables are written by SURVIVORS, not staff:
--   case_reports, sos_alerts, shelter_requests, chat_sessions,
--   user_verifications
--
-- Recording a survivor's IP would mean audit_logs holds the network
-- location of a person at the moment they filed an abuse report or
-- triggered an emergency SOS. An IP resolves to an ISP and a locality;
-- in domestic-violence cases the threatening party frequently has
-- physical proximity. audit_logs is readable by every
-- provincial_admin/super_admin, so that dataset would be broadly
-- visible inside the organisation.
--
-- Under RA 10173 (Data Privacy Act of 2012) an IP address is personal
-- information, and the context here is sensitive. The accountability
-- purpose of this audit log is ADMINISTRATIVE — who changed a role,
-- who downloaded a backup, who ran a restore. That purpose is fully
-- served by recording staff and administrator IPs. Recording survivor
-- IPs adds little investigative value and creates a real locating
-- risk, so current_audit_ip() returns NULL for survivor actors.
--
-- This is a deliberate, reviewed decision. Do not "fix" it by removing
-- the role check.
--
-- =========================================================
-- THE RECORDED IP IS CLIENT-REPORTED, NOT VERIFIED
-- =========================================================
-- x-forwarded-for is a proxy header. A client can send its own value,
-- and intermediaries append rather than replace. The stored value is
-- therefore evidence of what was reported, NOT a cryptographically
-- established source address. The column comment and the admin UI both
-- say so, because an audit log is most likely to be over-trusted at
-- precisely the moment it is being disputed.
-- =========================================================


-- ---------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------
alter table public.audit_logs
  add column if not exists ip_address text,
  add column if not exists user_agent text;

comment on column public.audit_logs.ip_address is
  'Client IP reported via the x-forwarded-for proxy header at the time of the action. NULL for survivor-originated actions (deliberate — see module45 header) and NULL where no request context was available (e.g. a pg_cron job, which has no HTTP request at all). CLIENT-REPORTED, NOT VERIFIED: x-forwarded-for can be set by the caller, so treat this as evidence of what was reported rather than an established source address.';

comment on column public.audit_logs.user_agent is
  'Client user-agent string reported at the time of the action, same scope and same trust caveat as ip_address.';

-- ---------------------------------------------------------
-- 2. current_request_ip() — parse the proxy header.
--
-- x-forwarded-for is a comma-separated chain: "client, proxy1, proxy2".
-- The LEFTMOST entry is the originating client as reported, which is
-- the value worth recording — while remembering it is exactly the
-- entry a caller can forge. split_part + btrim handles both the single
-- value and the chain.
--
-- Returns NULL rather than raising when there is no request context,
-- so a pg_cron job or a direct SQL-editor statement simply records no
-- IP instead of failing the write it is attached to. An audit trigger
-- must never be the reason a legitimate operation fails.
-- ---------------------------------------------------------
create or replace function public.current_request_ip()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers text;
  v_xff text;
begin
  -- current_setting(..., true) returns NULL instead of raising when the
  -- setting is absent, which is the normal case outside a PostgREST
  -- request.
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;

  v_xff := btrim(split_part((v_headers::json ->> 'x-forwarded-for'), ',', 1));
  if v_xff = '' then
    return null;
  end if;
  return left(v_xff, 100);
exception
  when others then
    -- Malformed header JSON must not break the audited write.
    return null;
end;
$$;

comment on function public.current_request_ip() is
  'Best-effort client IP from the PostgREST request.headers setting (leftmost x-forwarded-for entry). Returns NULL outside an HTTP request context (pg_cron, SQL editor) and on any parse failure, so an audit trigger can never fail the operation it is auditing. The value is client-reportable and must not be treated as verified.';

create or replace function public.current_request_user_agent()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  return left(btrim(coalesce(v_headers::json ->> 'user-agent', '')), 300);
exception
  when others then
    return null;
end;
$$;

-- ---------------------------------------------------------
-- 3. current_audit_ip() — the survivor exclusion lives HERE.
--
-- Placed in its own function, and used as the column DEFAULT, so the
-- rule is enforced in exactly one place for all 22 triggers plus the
-- browser's direct inserts. There is no path that records an IP
-- without passing through this check.
--
-- An actor with no profile row at all (anonymous/public insert) is
-- treated as NOT staff and gets NULL — fail closed.
-- ---------------------------------------------------------
create or replace function public.current_audit_ip()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role
  from public.user_profiles
  where auth_user_id = auth.uid();

  -- No profile, or a survivor: record nothing. See the module header
  -- for why this is deliberate.
  if v_role is null or v_role = 'survivor' then
    return null;
  end if;

  return public.current_request_ip();
end;
$$;

comment on function public.current_audit_ip() is
  'Returns the client IP ONLY when the acting user is a staff/administrator role. Survivor-originated actions, and callers with no profile, always return NULL — recording a survivor''s network location at the moment they report abuse or trigger an SOS is a safety risk this project deliberately refuses to take (see module45 header, RA 10173). Used as the DEFAULT on audit_logs.ip_address so every existing trigger inherits the rule unchanged.';

create or replace function public.current_audit_user_agent()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role
  from public.user_profiles
  where auth_user_id = auth.uid();

  if v_role is null or v_role = 'survivor' then
    return null;
  end if;

  return public.current_request_user_agent();
end;
$$;

-- ---------------------------------------------------------
-- 4. The DEFAULT — this is what makes 22 triggers work untouched.
--
-- audit_row_change() inserts without naming ip_address, so Postgres
-- evaluates this default in the trigger's own transaction, where the
-- PostgREST request.headers setting is still in scope. The same
-- applies to the admin app's direct logAudit() insert.
--
-- Edge Functions are the exception: they reach PostgREST over their
-- own HTTP call, so request.headers there describes the FUNCTION's
-- request, not the operator's browser. Those functions pass the
-- operator's IP explicitly instead (see the TypeScript changes).
-- ---------------------------------------------------------
alter table public.audit_logs
  alter column ip_address set default public.current_audit_ip(),
  alter column user_agent set default public.current_audit_user_agent();

-- ---------------------------------------------------------
-- 5. Grants. These are read by the DEFAULT as the INSERTING role, so
--    authenticated needs EXECUTE; service_role needs it for the Edge
--    Functions' own inserts. anon is deliberately excluded.
-- ---------------------------------------------------------
revoke all on function public.current_request_ip() from public, anon;
revoke all on function public.current_request_user_agent() from public, anon;
revoke all on function public.current_audit_ip() from public, anon;
revoke all on function public.current_audit_user_agent() from public, anon;

grant execute on function public.current_request_ip() to authenticated, service_role;
grant execute on function public.current_request_user_agent() to authenticated, service_role;
grant execute on function public.current_audit_ip() to authenticated, service_role;
grant execute on function public.current_audit_user_agent() to authenticated, service_role;


-- =========================================================
-- VERIFICATION — run after applying.
-- =========================================================

-- 1. Columns and defaults exist (expect current_audit_ip() /
--    current_audit_user_agent() as the defaults):
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'audit_logs' and column_name in ('ip_address','user_agent');

-- 2. Does PostgREST expose request headers on THIS project? Run this
--    from the admin app (not the SQL editor — the SQL editor has no
--    HTTP request context and will correctly return NULL):
--      select public.current_request_ip();
--    Expect your own public IP. NULL from the SQL editor is CORRECT and
--    proves nothing either way — it must be tested through PostgREST.

-- 3. End-to-end, as a technical admin in the admin portal: change
--    something audited (e.g. toggle a municipality active/inactive),
--    then:
--   select action, table_name, ip_address, user_agent, created_at
--   from public.audit_logs order by created_at desc limit 5;
--    Expect ip_address populated for that row.

-- 4. SURVIVOR EXCLUSION — the important one. As a survivor on the
--    mobile app, file an incident report, then:
--   select a.action, a.table_name, a.ip_address, p.role
--   from public.audit_logs a
--   left join public.user_profiles p on p.profile_id = a.profile_id
--   where a.table_name = 'case_reports'
--   order by a.created_at desc limit 5;
--    Expect ip_address IS NULL for every survivor-originated row.

-- 5. Confirm no survivor row anywhere ever carried an IP (expect 0):
--   select count(*)
--   from public.audit_logs a
--   join public.user_profiles p on p.profile_id = a.profile_id
--   where p.role = 'survivor' and a.ip_address is not null;

-- 6. anon cannot reach the helpers (expect false for both):
--   select has_function_privilege('anon', 'public.current_request_ip()', 'EXECUTE');
--   select has_function_privilege('anon', 'public.current_audit_ip()', 'EXECUTE');

-- =========================================================
-- SafeSpace — Module 43: monthly backup scheduling + duplicate-run
-- prevention + schedule run state.
--
-- Run in the Supabase SQL editor AFTER module42_backup_authorization_
-- hardening.sql.
--
-- NO Part A/Part B SPLIT NEEDED. This module adds no enum VALUES — the
-- 'monthly' value was already added by module42's Part A. Everything
-- here is DDL and function replacement, safe in one run.
--
-- =========================================================
-- WHY THIS MODULE EXISTS — a real defect, not a feature request
-- =========================================================
-- module42 Part A added 'monthly' to the backup_frequency enum, but did
-- NOT update module16's set_backup_schedule(), whose cron-expression
-- builder is:
--
--   v_cron_expr := case
--     when p_frequency = 'daily' then format('%s %s * * *', 0, p_hour_utc)
--     else format('%s %s * * %s', 0, p_hour_utc, p_day_of_week)
--   end;
--
-- 'monthly' therefore falls into the `else` (weekly) branch. With
-- p_day_of_week NULL that produces the malformed expression
-- "0 2 * * " and cron.schedule() rejects it; with a day_of_week left
-- over from a previous weekly configuration it silently creates a
-- WEEKLY job while the UI and the backup_schedule row both say monthly.
-- A schedule that claims monthly and runs weekly — or not at all — is
-- exactly the class of failure a backup system must not have, so this
-- module closes it before monthly is exposed in the UI.
--
-- =========================================================
-- DAY-OF-MONTH: 1-28 ONLY, DELIBERATELY
-- =========================================================
-- Plain cron has no "last day of month" token. `0 2 31 * *` simply does
-- not fire in February, April, June, September or November — a silently
-- skipped backup in 5 months of every 12, with nothing in any log to
-- say a run was due. Because a missed backup is indistinguishable from a
-- healthy one until a recovery is attempted, 29/30/31 are not offered
-- at all rather than offered with a caveat nobody reads.
--
-- The CHECK constraint on backup_schedule.day_of_month (module42)
-- already enforces 1-28; this module enforces it again at the function
-- boundary so a direct RPC call cannot bypass the UI.
--
-- =========================================================
-- TIMEZONE: UTC, EXPLICITLY
-- =========================================================
-- pg_cron evaluates schedules in the database's own timezone. Supabase
-- projects run UTC, and this schema stores the hour as `hour_utc` and
-- renders it in the UI as "UTC" — so the configured hour means UTC and
-- there is no DST transition to reason about: UTC has no DST. A
-- schedule set for 02:00 UTC fires at 02:00 UTC every day of the year.
-- Local wall-clock time in Aurora (PHT, UTC+8, which itself observes no
-- DST) is therefore a fixed +8 offset: 02:00 UTC = 10:00 PHT, always.
-- Do NOT reintroduce a local-time field without also handling the
-- missing/duplicated wall-clock hours that a DST-observing zone
-- creates.
--   Verify the assumption on this project with:
--     select current_setting('TimeZone');   -- expect UTC
-- =========================================================


-- ---------------------------------------------------------
-- 1. Occurrence key — real, server-enforced duplicate-run prevention.
--
-- Nothing previously stopped two backups being created for the same
-- scheduled occurrence: a cron retry, a double-fired job, or an
-- operator pressing "Run now" moments after the schedule fired would
-- each produce a second full archive. The partial unique index below
-- makes that impossible at the database level rather than relying on
-- the Edge Function checking first (which races).
--
-- Only SCHEDULED runs are keyed. Manual runs are intentionally
-- unconstrained — an operator may legitimately take two manual backups
-- a minute apart, and pre_restore checkpoints must never be blocked.
-- ---------------------------------------------------------
alter table public.system_backups
  add column if not exists occurrence_key text;

comment on column public.system_backups.occurrence_key is
  'Identifies the scheduled occurrence a run belongs to (e.g. sched:2026-10-23T02). NULL for manual and pre_restore runs, which are deliberately not deduplicated. Enforced unique for scheduled runs by idx_system_backups_occurrence.';

create unique index if not exists idx_system_backups_occurrence
  on public.system_backups (occurrence_key)
  where occurrence_key is not null;

-- ---------------------------------------------------------
-- 2. claim_scheduled_backup_occurrence() — the atomic claim.
--
-- Returns the claimed backup_id exactly once per occurrence key. Any
-- later caller for the same occurrence gets NULL (not an error), so a
-- duplicate cron fire becomes a recorded no-op rather than a failure
-- that pages someone at 02:00.
--
-- Implemented as an INSERT ... ON CONFLICT DO NOTHING against the
-- unique index above, so the winner is decided by the database and not
-- by read-then-write logic that two concurrent callers could both pass.
-- ---------------------------------------------------------
create or replace function public.claim_scheduled_backup_occurrence(
  p_occurrence_key text,
  p_retention_days int default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted uuid;
begin
  if p_occurrence_key is null or p_occurrence_key = '' then
    raise exception 'occurrence key is required';
  end if;

  -- Returns the NEW row's id so the caller reuses it rather than
  -- inserting a second row of its own. If it returned only a boolean,
  -- the export path would create another system_backups row and the
  -- claimed one would sit in 'running' forever — a phantom backup that
  -- looks like a stuck job.
  insert into public.system_backups (backup_type, status, occurrence_key, retention_days)
  values ('scheduled', 'running', p_occurrence_key, coalesce(p_retention_days, 30))
  on conflict (occurrence_key) where occurrence_key is not null
  do nothing
  returning backup_id into v_inserted;

  -- NULL means another invocation already owns this occurrence.
  return v_inserted;
end;
$$;

comment on function public.claim_scheduled_backup_occurrence(text, int) is
  'Atomically claims one scheduled occurrence and returns the system_backups.backup_id it created (status ''running''), or NULL if another invocation already owns that occurrence. The database''s partial unique index decides the winner, so two concurrent cron fires cannot both proceed. The caller MUST reuse the returned id for the export rather than inserting its own row. service_role only.';

revoke all on function public.claim_scheduled_backup_occurrence(text, int) from public, authenticated, anon;
grant execute on function public.claim_scheduled_backup_occurrence(text, int) to service_role;

-- ---------------------------------------------------------
-- 3. set_backup_schedule() — replaced with monthly support.
--
-- The old 5-argument function is DROPPED rather than left in place
-- beside a 6-argument overload. Leaving it would mean two functions
-- with the same name where the 5-arg one still mishandles 'monthly' —
-- and any caller that passed 5 arguments would silently resolve to the
-- broken one. One function, one behaviour.
--
-- Everything else about module16's implementation is preserved
-- deliberately: the is_provincial_technical_admin() gate, the
-- unschedule-then-schedule sequence that keeps backup_schedule and
-- cron.job in sync, the private.app_config dispatch lookup, and the
-- same error text when dispatch is not configured.
-- ---------------------------------------------------------
drop function if exists public.set_backup_schedule(boolean, backup_frequency, int, int, int);

create or replace function public.set_backup_schedule(
  p_enabled boolean,
  p_frequency backup_frequency,
  p_hour_utc int,
  p_day_of_week int default null,
  p_retention_days int default 30,
  p_day_of_month int default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_cron_expr text;
  v_url text;
  v_secret text;
begin
  if not public.is_provincial_technical_admin() then
    raise exception 'Not authorized to change the backup schedule';
  end if;
  if p_hour_utc is null or p_hour_utc < 0 or p_hour_utc > 23 then
    raise exception 'hour_utc must be between 0 and 23';
  end if;
  if p_frequency = 'weekly' and (p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6) then
    raise exception 'day_of_week (0-6) is required for a weekly schedule';
  end if;
  -- See the DAY-OF-MONTH note in this file's header for why 29-31 are
  -- rejected instead of silently skipping short months.
  if p_frequency = 'monthly' and (p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 28) then
    raise exception 'day_of_month (1-28) is required for a monthly schedule. 29-31 are not supported because cron would skip months that are shorter, producing a silently missed backup.';
  end if;
  if p_retention_days is null or p_retention_days <= 0 then
    raise exception 'retention_days must be a positive number';
  end if;

  update public.backup_schedule
  set enabled = p_enabled,
      frequency = p_frequency,
      hour_utc = p_hour_utc,
      day_of_week = case when p_frequency = 'weekly' then p_day_of_week else null end,
      day_of_month = case when p_frequency = 'monthly' then p_day_of_month else null end,
      retention_days = p_retention_days,
      updated_by = public.current_profile_id(),
      updated_at = now()
  where schedule_id = '00000000-0000-0000-0000-000000000001';

  if exists (select 1 from cron.job where jobname = 'safeher-scheduled-backup') then
    perform cron.unschedule('safeher-scheduled-backup');
  end if;

  if p_enabled then
    -- Explicit per-frequency branch. No `else` fallthrough: an enum
    -- value added in future raises loudly here instead of quietly
    -- inheriting another frequency's expression, which is precisely the
    -- defect this module was written to fix.
    v_cron_expr := case p_frequency
      when 'daily'   then format('%s %s * * *', 0, p_hour_utc)
      when 'weekly'  then format('%s %s * * %s', 0, p_hour_utc, p_day_of_week)
      when 'monthly' then format('%s %s %s * *', 0, p_hour_utc, p_day_of_month)
    end;

    if v_cron_expr is null then
      raise exception 'Unsupported backup frequency %. set_backup_schedule() must be updated before this frequency can be used.', p_frequency;
    end if;

    select value into v_url from private.app_config where key = 'backup_dispatch_url';
    select value into v_secret from private.app_config where key = 'backup_dispatch_secret';

    if v_url is null or v_secret is null or v_url = '' or v_secret = '' then
      raise exception 'Backup dispatch is not configured yet. Deploy the backup-create Edge Function and set backup_dispatch_url/backup_dispatch_secret in private.app_config first (see module16''s operator setup notes).';
    end if;

    perform cron.schedule(
      'safeher-scheduled-backup',
      v_cron_expr,
      format(
        $c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', %L), body := '{"action":"create","trigger":"scheduled"}'::jsonb);$c$,
        v_url, v_secret
      )
    );
  end if;

  -- Informational mirror for the UI. cron.job remains the single source
  -- of truth for when a run actually fires; this never drives execution.
  update public.backup_schedule
  set next_run_at = case
        when not p_enabled then null
        else (
          select min(t)
          from (
            select generate_series(
              date_trunc('day', now() at time zone 'utc'),
              date_trunc('day', now() at time zone 'utc') + interval '62 days',
              interval '1 day'
            ) + make_interval(hours => p_hour_utc) as t
          ) s
          where t > (now() at time zone 'utc')
            and (
              p_frequency = 'daily'
              or (p_frequency = 'weekly'  and extract(dow  from t) = p_day_of_week)
              or (p_frequency = 'monthly' and extract(day  from t) = p_day_of_month)
            )
        ) at time zone 'utc'
      end
  where schedule_id = '00000000-0000-0000-0000-000000000001';
end;
$$;

revoke all on function public.set_backup_schedule(boolean, backup_frequency, int, int, int, int) from public;
grant execute on function public.set_backup_schedule(boolean, backup_frequency, int, int, int, int) to authenticated;

-- ---------------------------------------------------------
-- 4. set_backup_schedule_authorized() — replaced to pass day_of_month.
--
-- The module42 wrapper is preserved in behaviour exactly: same grant
-- consumption, same refusal of non-schedule operations, same profile
-- binding from the JWT rather than a parameter, same audit row. The
-- ONLY change is the added p_day_of_month passthrough, which the old
-- signature could not express.
-- ---------------------------------------------------------
drop function if exists public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int);

create or replace function public.set_backup_schedule_authorized(
  p_grant_id uuid,
  p_operation text,
  p_enabled boolean,
  p_frequency backup_frequency,
  p_hour_utc int,
  p_day_of_week int default null,
  p_retention_days int default 30,
  p_day_of_month int default null
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

  if p_operation not in ('schedule_create', 'schedule_modify') then
    raise exception 'A schedule change requires a schedule_create or schedule_modify authorization, not %', p_operation
      using errcode = '42501';
  end if;

  select * into v_consumed
  from public.consume_backup_grant(p_grant_id, v_profile_id, p_operation, null);

  if not v_consumed.ok then
    raise exception 'BACKUP_AUTH_REQUIRED: %', v_consumed.reason using errcode = '42501';
  end if;

  perform public.set_backup_schedule(
    p_enabled, p_frequency, p_hour_utc, p_day_of_week, p_retention_days, p_day_of_month
  );

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
      'day_of_month', p_day_of_month,
      'retention_days', p_retention_days,
      'authorized_via', p_operation
    )
  );
end;
$$;

revoke all on function public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int, int) from public, anon;
grant execute on function public.set_backup_schedule_authorized(uuid, text, boolean, backup_frequency, int, int, int, int) to authenticated;

-- ---------------------------------------------------------
-- 5. record_scheduled_run_outcome() — populates the run-state columns
--    module42 added but nothing yet wrote.
-- ---------------------------------------------------------
create or replace function public.record_scheduled_run_outcome(
  p_backup_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.backup_schedule
  set last_run_at = now(),
      last_run_status = p_status,
      last_run_backup_id = p_backup_id
  where schedule_id = '00000000-0000-0000-0000-000000000001';
end;
$$;

comment on function public.record_scheduled_run_outcome(uuid, text) is
  'Records the outcome of a scheduled backup run on backup_schedule (last_run_at/last_run_status/last_run_backup_id) so the UI can show real run state instead of inferring it. Called by backup-create''s scheduled path. service_role only.';

revoke all on function public.record_scheduled_run_outcome(uuid, text) from public, authenticated, anon;
grant execute on function public.record_scheduled_run_outcome(uuid, text) to service_role;

-- ---------------------------------------------------------
-- 6. Least-privilege tidy-up on module42's one over-permissive function.
--
-- is_backup_protected_operation() was created without a revoke, so it
-- inherited PUBLIC EXECUTE — verified live against the production
-- project, where an anonymous REST call returned HTTP 200. It exposes
-- no data (it answers "is this string in a fixed list"), so this is
-- least-privilege hygiene rather than an incident, but there is no
-- reason for anon to enumerate the protected-operation vocabulary.
-- ---------------------------------------------------------
revoke all on function public.is_backup_protected_operation(text) from public, anon;
grant execute on function public.is_backup_protected_operation(text) to authenticated, service_role;


-- =========================================================
-- VERIFICATION — run separately after applying.
-- =========================================================

-- 1. Timezone assumption this module documents (expect UTC):
--   select current_setting('TimeZone');

-- 2. Only the 6-arg set_backup_schedule should remain (expect 1 row):
--   select pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'set_backup_schedule';

-- 3. Only the 8-arg wrapper should remain (expect 1 row):
--   select pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'set_backup_schedule_authorized';

-- 4. Monthly now produces a day-of-month cron expression. As a
--    technical admin (expect "0 3 15 * *"):
--   select public.set_backup_schedule(true, 'monthly', 3, null, 30, 15);
--   select jobname, schedule, active from cron.job where jobname = 'safeher-scheduled-backup';

-- 5. Out-of-range day_of_month is refused (expect the 1-28 exception):
--   select public.set_backup_schedule(true, 'monthly', 3, null, 30, 31);

-- 6. Monthly without a day is refused (expect the same exception):
--   select public.set_backup_schedule(true, 'monthly', 3, null, 30, null);

-- 7. next_run_at is populated and in the future:
--   select frequency, hour_utc, day_of_month, next_run_at,
--          next_run_at > now() as in_future
--   from public.backup_schedule;

-- 8. Duplicate-occurrence prevention — expect TRUE then FALSE, and
--    exactly ONE row afterwards:
--   select public.claim_scheduled_backup_occurrence('test:occurrence:1', 30); -- expect a uuid
--   select public.claim_scheduled_backup_occurrence('test:occurrence:1', 30); -- expect NULL
--   select count(*) from public.system_backups where occurrence_key = 'test:occurrence:1';
--   -- cleanup:
--   delete from public.system_backups where occurrence_key = 'test:occurrence:1';

-- 9. anon can no longer reach is_backup_protected_operation
--    (expect false, and a 401 from REST rather than HTTP 200):
--   select has_function_privilege('anon', 'public.is_backup_protected_operation(text)', 'EXECUTE');

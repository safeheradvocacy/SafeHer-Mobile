-- =========================================================
-- SafeHer — Module 16: Provincial Admin technical control center
-- (Administrative Configuration Backup, real scheduling, System Health)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module15_barangay_anon_read_grant.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10/11:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- SCOPE — this module deliberately backs up ADMINISTRATIVE/REFERENCE
-- data only (municipalities, barangays, shelters, non-survivor
-- user_profiles rows) — never survivors, case_reports, case_*,
-- user_verifications, case_access_tokens/case_client_links, audit_logs,
-- notifications, or saved_reports. Full database-level recovery is a
-- SEPARATE, real Supabase platform capability (Point-in-Time Recovery /
-- Physical Backups) that is NOT enabled on this project today — verified
-- directly via `supabase backups list`:
--   {"region":"ap-southeast-1","walg_enabled":true,"pitr_enabled":false,
--    "backups":[],"physical_backup_data":{}}
-- Enabling PITR is a Supabase plan/billing action taken in the Supabase
-- Dashboard, not something this schema or app can turn on — the admin UI
-- states this plainly rather than fabricating a working control for it.
--
-- AUTHORIZATION — every new policy/RPC below uses the EXISTING
-- is_provincial_technical_admin() (module11) UNCHANGED. This is
-- deliberately narrower than is_provincial_admin() (which intentionally
-- includes provincial_staff for province-wide OPERATIONAL reach
-- elsewhere in this schema) — backup/restore/schedule administration
-- must stay technical-admin-only, so provincial_staff must NOT reach
-- any of it. Nothing here modifies either helper function.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/table if not exists) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type notification_type add value if not exists 'System';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enum types (brand-new types, not new values on an existing
--    type — no Part A/B split needed for these specifically).
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'backup_run_type') then
    create type public.backup_run_type as enum ('manual', 'scheduled');
  end if;
  if not exists (select 1 from pg_type where typname = 'backup_run_status') then
    create type public.backup_run_status as enum ('running', 'completed', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'backup_frequency') then
    create type public.backup_frequency as enum ('daily', 'weekly');
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. pg_cron — server-side scheduling (module8's pg_net is already
--    enabled and is reused here unchanged; pg_cron is new).
-- ---------------------------------------------------------
create extension if not exists pg_cron;

-- ---------------------------------------------------------
-- 3. system_backups — one real row per real export attempt. Only ever
--    written by the backup-create Edge Function's service-role client
--    (no authenticated INSERT/UPDATE/DELETE grant exists at all) — a
--    technical admin can SELECT to see real history, never fabricate
--    a row from the client.
-- ---------------------------------------------------------
create table if not exists public.system_backups (
  backup_id       uuid primary key default gen_random_uuid(),
  backup_type     backup_run_type not null,
  status          backup_run_status not null default 'running',
  initiated_by    uuid references public.user_profiles(profile_id), -- null for scheduled runs
  storage_path    text,
  size_bytes      bigint,
  row_counts      jsonb,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  error_message   text,
  retention_days  int not null default 30,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_system_backups_started_at on public.system_backups(started_at desc);

alter table public.system_backups enable row level security;

drop policy if exists "Technical admins can view system backups" on public.system_backups;
create policy "Technical admins can view system backups"
  on public.system_backups for select
  using (public.is_provincial_technical_admin());

grant select on public.system_backups to authenticated;
-- service_role does NOT automatically inherit privileges on a brand-new
-- table just because it bypasses RLS (GRANT and RLS are separate layers
-- — the same lesson already documented in module3_barangay_hierarchy.sql
-- for barangays/case_referrals) — explicit here so backup-create's
-- adminClient can actually read/write this table.
grant select, insert, update, delete on public.system_backups to service_role;

-- ---------------------------------------------------------
-- 4. backup_schedule — single-row configuration, viewable by technical
--    admins; changed ONLY via set_backup_schedule() below (no
--    authenticated UPDATE grant), so the cron job and the row can never
--    drift apart.
-- ---------------------------------------------------------
create table if not exists public.backup_schedule (
  schedule_id     uuid primary key default gen_random_uuid(),
  enabled         boolean not null default false,
  frequency       backup_frequency not null default 'daily',
  hour_utc        int not null default 2 check (hour_utc between 0 and 23),
  day_of_week     int check (day_of_week between 0 and 6), -- 0=Sunday; only meaningful when frequency='weekly'
  retention_days  int not null default 30 check (retention_days > 0),
  updated_by      uuid references public.user_profiles(profile_id),
  updated_at      timestamptz not null default now()
);

insert into public.backup_schedule (schedule_id, enabled, frequency, hour_utc, retention_days)
values ('00000000-0000-0000-0000-000000000001', false, 'daily', 2, 30)
on conflict (schedule_id) do nothing;

alter table public.backup_schedule enable row level security;

drop policy if exists "Technical admins can view backup schedule" on public.backup_schedule;
create policy "Technical admins can view backup schedule"
  on public.backup_schedule for select
  using (public.is_provincial_technical_admin());

grant select on public.backup_schedule to authenticated;
-- No update/insert/delete grant — set_backup_schedule() (security
-- definer, owned by postgres) is the only writer, so a schedule change
-- always keeps the row and the real cron.job entry in sync atomically.

-- ---------------------------------------------------------
-- 5. set_backup_schedule() — the ONE authorized way to change the
--    schedule. Translates the admin UI's simple fields into a real
--    cron expression and a real cron.schedule()/cron.unschedule() call
--    — never a fake "saved" toggle with no underlying job.
-- ---------------------------------------------------------
create or replace function public.set_backup_schedule(
  p_enabled boolean,
  p_frequency backup_frequency,
  p_hour_utc int,
  p_day_of_week int default null,
  p_retention_days int default 30
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
  if p_retention_days is null or p_retention_days <= 0 then
    raise exception 'retention_days must be a positive number';
  end if;

  update public.backup_schedule
  set enabled = p_enabled,
      frequency = p_frequency,
      hour_utc = p_hour_utc,
      day_of_week = case when p_frequency = 'weekly' then p_day_of_week else null end,
      retention_days = p_retention_days,
      updated_by = public.current_profile_id(),
      updated_at = now()
  where schedule_id = '00000000-0000-0000-0000-000000000001';

  if exists (select 1 from cron.job where jobname = 'safeher-scheduled-backup') then
    perform cron.unschedule('safeher-scheduled-backup');
  end if;

  if p_enabled then
    v_cron_expr := case
      when p_frequency = 'daily' then format('%s %s * * *', 0, p_hour_utc)
      else format('%s %s * * %s', 0, p_hour_utc, p_day_of_week)
    end;

    select value into v_url from private.app_config where key = 'backup_dispatch_url';
    select value into v_secret from private.app_config where key = 'backup_dispatch_secret';

    if v_url is null or v_secret is null or v_url = '' or v_secret = '' then
      raise exception 'Backup dispatch is not configured yet. Deploy the backup-create Edge Function and set backup_dispatch_url/backup_dispatch_secret in private.app_config first (see the one-time operator setup notes at the end of this file).';
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
end;
$$;

revoke all on function public.set_backup_schedule(boolean, backup_frequency, int, int, int) from public;
grant execute on function public.set_backup_schedule(boolean, backup_frequency, int, int, int) to authenticated;

-- ---------------------------------------------------------
-- 6. Storage — system-backups bucket. Mirrors identity-documents'
--    (module10) private-bucket-plus-explicit-policy pattern exactly.
--    No authenticated INSERT/UPDATE/DELETE policy — only the Edge
--    Function's service-role client writes objects here; a technical
--    admin only ever reads via a short-lived signed URL (never this
--    SELECT policy directly, and never a public URL).
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('system-backups', 'system-backups', false, 52428800, array['application/json', 'application/gzip'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Technical admins can view system backup files" on storage.objects;
create policy "Technical admins can view system backup files"
  on storage.objects for select
  using (bucket_id = 'system-backups' and public.is_provincial_technical_admin());

-- ---------------------------------------------------------
-- 7. Audit trail for the new tables — reuses the existing generic
--    audit_row_change trigger (module3), same convention as every
--    other tracked table in this schema.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_system_backups on public.system_backups;
create trigger trg_audit_system_backups after insert or update or delete on public.system_backups
  for each row execute procedure public.audit_row_change('backup_id');

drop trigger if exists trg_audit_backup_schedule on public.backup_schedule;
create trigger trg_audit_backup_schedule after insert or update or delete on public.backup_schedule
  for each row execute procedure public.audit_row_change('schedule_id');


-- =========================================================
-- ONE-TIME OPERATOR SETUP (not part of the idempotent script above —
-- run these two statements yourself, once, with real values, AFTER
-- deploying the backup-create Edge Function and setting its
-- BACKUP_DISPATCH_SECRET via `supabase secrets set`). Mirrors module8's
-- push_dispatch_url/push_dispatch_secret setup exactly.
--
--   insert into private.app_config (key, value) values
--     ('backup_dispatch_url', 'https://<project-ref>.supabase.co/functions/v1/backup-create')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
--   insert into private.app_config (key, value) values
--     ('backup_dispatch_secret', '<same random value passed to supabase secrets set BACKUP_DISPATCH_SECRET>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- =========================================================


-- =========================================================
-- VERIFICATION — run these separately, after everything above (and the
-- one-time operator setup), to confirm the migration applied correctly.
-- All read-only unless noted.
-- =========================================================

-- 1. Confirm the new enum/tables/policies exist:
--   select enumlabel from pg_enum where enumtypid = 'notification_type'::regtype order by enumsortorder;
--   select relrowsecurity from pg_class where relname in ('system_backups','backup_schedule');
--   select policyname, cmd from pg_policies where tablename in ('system_backups','backup_schedule');

-- 2. Confirm NO authenticated write grant exists on system_backups
--    (expect 0 rows — only service_role writes it):
--   select privilege_type from information_schema.role_table_grants
--   where table_name = 'system_backups' and grantee = 'authenticated'
--     and privilege_type in ('INSERT','UPDATE','DELETE');

-- 3. Confirm role scoping — as each of provincial_admin/super_admin
--    (expect success), then provincial_staff/municipal_admin/
--    barangay_admin (expect 0 rows / RLS-empty, NOT an error):
--   select count(*) from system_backups;
--   select count(*) from backup_schedule;
--   select public.set_backup_schedule(true, 'daily', 2, null, 30); -- expect exception for non-technical-admin callers

-- 4. Confirm anon is denied entirely (expect 42501, not empty rows):
--   curl "$SUPABASE_URL/rest/v1/system_backups?select=*" -H "apikey: $ANON_KEY"

-- 5. Confirm the cron job reflects reality after enabling a schedule:
--   select jobname, schedule, active from cron.job where jobname = 'safeher-scheduled-backup';

-- =========================================================
-- SafeSpace — Module 23: Backup integrity verification + controlled
-- Restore capability (CIA-aligned: Confidentiality / Integrity /
-- Availability), for the Administrative Configuration Backup introduced
-- in module16.
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module22_case_services.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10/11/16:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- WHAT THIS DOES NOT CHANGE — per the explicit brief ("do not rebuild
-- the existing working backup scheduler"):
--   * backup_schedule, set_backup_schedule(), the pg_cron job, the
--     backup-create Edge Function's existing create/download actions,
--     the EXPORT_TABLES list, and the system-backups Storage bucket's
--     existing policies are all UNCHANGED.
--   * is_provincial_technical_admin() (module11) is reused UNCHANGED —
--     this module does not define a second/competing authorization
--     function, and does not grant restore access to provincial_staff
--     or any other role.
--
-- WHAT THIS ADDS (all additive — new columns, new types, new tables,
-- new functions; nothing dropped, nothing destructive):
--   1. Cryptographic integrity columns on system_backups (checksum,
--      verification_status, schema/environment markers) — module16's
--      backup-create only ever compared row counts after decompressing
--      the file; it had no way to detect single-byte corruption that
--      happened to preserve row counts. A SHA-256 digest closes that
--      gap, computed once at backup time and re-verified before every
--      restore.
--   2. system_restores — one row per restore attempt, mirroring
--      system_backups' own "service-role writes, technical-admin reads
--      only" shape exactly: no authenticated INSERT/UPDATE/DELETE grant
--      at all. The ONLY authenticated entry point is
--      begin_restore_operation() below, which is itself gated by
--      is_provincial_technical_admin() and a real, backend-enforced
--      restore lock (see its comment) — never a client-side boolean.
--   3. begin_restore_operation() — the one place concurrent restore
--      attempts are actually serialized, via a real Postgres advisory
--      lock, not a React state flag.
--
-- SCOPE OF RESTORE ITSELF — deliberately narrower than "replace the
-- table": see supabase/functions/backup-restore/index.ts for why a
-- destructive truncate-and-replace of municipalities/barangays/shelters
-- was rejected in favor of an additive upsert, and why administrator
-- account rows are excluded from restore entirely (reverting role/
-- active-status changes could silently reinstate access that was
-- deliberately revoked — a confidentiality/access-control regression,
-- not a recovery).
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type backup_run_type add value if not exists 'pre_restore';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enum types (brand-new types, not new values on an existing
--    type — no Part A/B split needed for these specifically).
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'backup_verification_status') then
    create type public.backup_verification_status as enum ('unverified', 'verified', 'corrupted');
  end if;
  if not exists (select 1 from pg_type where typname = 'restore_operation_status') then
    create type public.restore_operation_status as enum (
      'pending',              -- row just created; validation about to run
      'validation_failed',    -- terminal — backup failed one or more pre-restore checks
      'awaiting_confirmation',-- validation passed; waiting for the typed confirmation phrase
      'confirmed',            -- confirmation phrase matched; execution may begin
      'creating_safety_backup',
      'safety_backup_failed', -- terminal — restore MUST NOT proceed without one
      'restoring',
      'restore_failed',       -- terminal — the upsert itself errored
      'verifying',
      'verification_failed',  -- terminal — restore applied, but post-restore health checks failed
      'verified'              -- terminal — the only true "success" end state
    );
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Integrity + compatibility columns on the EXISTING system_backups
--    table — additive, nothing removed. Backfilled as NULL/'unverified'
--    for any backups that already existed before this migration; they
--    simply show as "Unverified" in the UI (never fabricated as
--    verified) until re-validated, and (being pre-checksum) can never be
--    used as a restore source until that validation actually computes
--    and stores a checksum — see backup-restore's validate step.
-- ---------------------------------------------------------
alter table public.system_backups
  add column if not exists checksum_sha256 text,
  add column if not exists verification_status backup_verification_status not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists schema_version text,
  add column if not exists project_ref text;

-- ---------------------------------------------------------
-- 3. system_restores — one row per restore ATTEMPT (not per success —
--    failed/rejected attempts are kept too, since they are themselves
--    security-relevant audit history). Same confidentiality shape as
--    system_backups: no authenticated write grant exists anywhere;
--    begin_restore_operation() (security definer) is the only way an
--    authenticated technical admin can create a row, and only the
--    backup-restore Edge Function's service-role client advances it
--    afterward.
-- ---------------------------------------------------------
create table if not exists public.system_restores (
  operation_id          uuid primary key default gen_random_uuid(),
  backup_id             uuid not null references public.system_backups(backup_id),
  requested_by          uuid references public.user_profiles(profile_id),
  status                restore_operation_status not null default 'pending',
  confirmation_phrase   text not null,
  validation_result     jsonb,
  safety_backup_id      uuid references public.system_backups(backup_id),
  restored_row_counts   jsonb,
  verification_result   jsonb,
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_system_restores_created_at on public.system_restores(created_at desc);
create index if not exists idx_system_restores_status on public.system_restores(status);

alter table public.system_restores enable row level security;

drop policy if exists "Technical admins can view restore operations" on public.system_restores;
create policy "Technical admins can view restore operations"
  on public.system_restores for select
  using (public.is_provincial_technical_admin());

grant select on public.system_restores to authenticated;
grant select, insert, update, delete on public.system_restores to service_role;

drop trigger if exists trg_audit_system_restores on public.system_restores;
create trigger trg_audit_system_restores after insert or update or delete on public.system_restores
  for each row execute procedure public.audit_row_change('operation_id');

-- ---------------------------------------------------------
-- 4. begin_restore_operation() — the ONE authenticated entry point into
--    the restore lifecycle, and the ONLY place a new system_restores
--    row can be created by a human. Does three things atomically, in
--    one transaction:
--      a. Re-checks is_provincial_technical_admin() server-side —
--         never trusts that the caller reached this via an
--         already-gated UI route.
--      b. Acquires a real backend lock (pg_advisory_xact_lock) so two
--         technical admins clicking "Restore" at the same instant
--         cannot both pass the "is anything already running" check —
--         this is the actual serialization point; everything after it
--         (confirm/execute, driven by the Edge Function) is already
--         protected because by then exactly one operation_id exists in
--         a non-terminal state, which every later step re-checks.
--      c. Inserts the row with a SERVER-generated confirmation phrase —
--         the brief's explicit requirement that this phrase be
--         generated/displayed by the system, not assumed by the
--         frontend — embedding the backup's own short ID so confirming
--         the wrong backup is structurally harder, not just differently
--         worded.
-- ---------------------------------------------------------
create or replace function public.begin_restore_operation(p_backup_id uuid)
returns table (operation_id uuid, confirmation_phrase text)
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid;
  v_phrase text;
  v_backup_short text;
begin
  if not public.is_provincial_technical_admin() then
    raise exception 'Not authorized to initiate a restore operation';
  end if;

  if not exists (select 1 from public.system_backups where backup_id = p_backup_id) then
    raise exception 'Backup not found';
  end if;

  -- Real backend lock — held for this function's transaction only,
  -- which is exactly as long as the exclusivity check + insert below
  -- need to be atomic together. Blocks (rather than failing) a
  -- simultaneous caller for the brief instant this transaction is open,
  -- which is the correct behavior: the second caller's own "already in
  -- progress" check then sees the first caller's just-committed row.
  perform pg_advisory_xact_lock(hashtext('safespace_restore_lock'));

  if exists (
    select 1 from public.system_restores
    where status not in ('validation_failed', 'safety_backup_failed', 'restore_failed', 'verification_failed', 'verified')
  ) then
    raise exception 'RESTORE_LOCKED: Another recovery operation is currently in progress.';
  end if;

  v_backup_short := upper(left(replace(p_backup_id::text, '-', ''), 8));
  v_phrase := 'RESTORE SAFESPACE ' || v_backup_short;

  insert into public.system_restores (backup_id, requested_by, status, confirmation_phrase)
  values (p_backup_id, public.current_profile_id(), 'pending', v_phrase)
  returning system_restores.operation_id into v_operation_id;

  return query select v_operation_id, v_phrase;
end;
$$;

revoke all on function public.begin_restore_operation(uuid) from public;
grant execute on function public.begin_restore_operation(uuid) to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the new enum/table/policy/function exist:
--   select enumlabel from pg_enum where enumtypid = 'backup_run_type'::regtype order by enumsortorder;
--   select enumlabel from pg_enum where enumtypid = 'restore_operation_status'::regtype order by enumsortorder;
--   select relrowsecurity from pg_class where relname = 'system_restores';
--   select policyname, cmd from pg_policies where tablename = 'system_restores';
--   select proname from pg_proc where proname = 'begin_restore_operation';

-- 2. Confirm NO authenticated write grant exists on system_restores
--    (expect 0 rows — only service_role writes rows directly; humans
--    only ever reach begin_restore_operation()):
--   select privilege_type from information_schema.role_table_grants
--   where table_name = 'system_restores' and grantee = 'authenticated'
--     and privilege_type in ('INSERT','UPDATE','DELETE');

-- 3. As a disposable provincial_admin/super_admin (expect success),
--    then provincial_staff/municipal_admin/barangay_admin/survivor
--    (expect exception "Not authorized..."):
--   select * from public.begin_restore_operation('<any real backup_id>');

-- 4. Confirm the lock actually blocks a second concurrent attempt
--    (run two sessions; the second should see RESTORE_LOCKED while the
--    first's system_restores row is in a non-terminal status):
--   select status from system_restores order by created_at desc limit 1;
--   select public.begin_restore_operation('<same or another backup_id>'); -- expect RESTORE_LOCKED

-- 5. Confirm anon is denied entirely (expect 42501, not empty rows):
--   curl "$SUPABASE_URL/rest/v1/system_restores?select=*" -H "apikey: $ANON_KEY"

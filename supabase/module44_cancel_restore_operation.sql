-- =========================================================
-- SafeSpace — Module 44: cancellable restore operations.
--
-- Run in the Supabase SQL editor AFTER module43.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9/10/11/16/
-- 23/42: Postgres will not let a newly-added enum value be referenced
-- by anything else in the same transaction/script that added it.
-- RUN PART A ALONE FIRST, let it commit, THEN run Part B.
--
-- =========================================================
-- THE DEFECT THIS FIXES
-- =========================================================
-- begin_restore_operation() (module23) inserts a system_restores row
-- as soon as the operator opens the restore wizard — before validation,
-- before confirmation, before anything is written. That row then holds
-- the restore lock, because begin_restore_operation() refuses to start
-- a new operation while any row sits in a non-terminal status.
--
-- But the admin UI's wizard "Cancel" only cleared local React state
-- (closeWizard() = setWizard(null) + reload). Nothing ever moved the
-- row to a terminal status. So:
--
--   open the restore wizard -> press Cancel -> the operation row is
--   orphaned in 'pending'/'awaiting_confirmation' FOREVER
--
-- The visible symptoms are a permanent red "SAFESPACE RECOVERY IN
-- PROGRESS" banner, Create Backup and Restore disabled on every
-- backup, and every future restore attempt failing with
-- RESTORE_LOCKED. There was no supported way out except editing
-- system_restores by hand in the SQL editor, which is exactly the kind
-- of surgery a recovery tool should not require.
--
-- =========================================================
-- WHY A NEW 'cancelled' STATUS RATHER THAN REUSING ONE
-- =========================================================
-- The five existing terminal statuses are 'validation_failed',
-- 'safety_backup_failed', 'restore_failed', 'verification_failed' and
-- 'verified'. Marking an abandoned wizard as 'restore_failed' would
-- record that a restore was attempted and failed, when in fact nothing
-- was ever written — and system_restores is security-relevant audit
-- history that gets read during incident review. A deliberate
-- 'cancelled' state keeps that history honest.
-- =========================================================


-- =========================================================
-- PART A — run this ALONE first, then come back and run Part B.
-- =========================================================

alter type restore_operation_status add value if not exists 'cancelled';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

-- ---------------------------------------------------------
-- 1. begin_restore_operation() — replaced so 'cancelled' counts as
--    terminal.
--
-- Without this, a cancelled operation would STILL hold the lock and the
-- cancel button would appear to do nothing — the bug would simply move
-- rather than be fixed. Everything else about module23's implementation
-- is preserved exactly: the is_provincial_technical_admin() gate, the
-- pg_advisory_xact_lock serialization, and the server-generated
-- confirmation phrase embedding the backup's short id.
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

  perform pg_advisory_xact_lock(hashtext('safespace_restore_lock'));

  if exists (
    select 1 from public.system_restores
    where status not in (
      'validation_failed', 'safety_backup_failed', 'restore_failed',
      'verification_failed', 'verified',
      'cancelled'  -- module44
    )
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

-- ---------------------------------------------------------
-- 2. cancel_restore_operation() — the supported way out.
--
-- SAFETY: the statuses are split into two groups on purpose.
--
--   Freely cancellable ('pending', 'awaiting_confirmation',
--   'confirmed') — nothing has been written yet. These are the states
--   an abandoned wizard leaves behind, and cancelling one is a pure
--   bookkeeping correction.
--
--   NOT freely cancellable ('creating_safety_backup', 'restoring',
--   'verifying') — an Edge Function may be actively writing. Marking
--   one terminal would release the lock while a restore is still
--   running, letting a SECOND restore start concurrently against a
--   half-restored database. That is strictly worse than a stuck
--   banner, so it is refused unless the operation is demonstrably
--   stale: p_force requires it to have been untouched for at least
--   30 minutes, which is far longer than any real run.
--
-- The 30-minute floor is enforced HERE, server-side, not in the UI —
-- a caller cannot pass a shorter threshold.
-- ---------------------------------------------------------
create or replace function public.cancel_restore_operation(
  p_operation_id uuid,
  p_force boolean default false
)
returns table (ok boolean, reason text, cancelled_status text)
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.system_restores%rowtype;
  v_last_activity timestamptz;
  v_stale_after interval := interval '30 minutes';
begin
  if not public.is_provincial_technical_admin() then
    raise exception 'Not authorized to cancel a restore operation' using errcode = '42501';
  end if;

  select * into v_row from public.system_restores where operation_id = p_operation_id for update;
  if not found then
    return query select false, 'not_found'::text, null::text;
    return;
  end if;

  if v_row.status in (
    'validation_failed', 'safety_backup_failed', 'restore_failed',
    'verification_failed', 'verified', 'cancelled'
  ) then
    -- Already terminal: nothing to cancel, and reporting success would
    -- imply this call changed something.
    return query select false, 'already_finished'::text, v_row.status::text;
    return;
  end if;

  if v_row.status in ('creating_safety_backup', 'restoring', 'verifying') then
    v_last_activity := greatest(
      coalesce(v_row.started_at, v_row.created_at),
      v_row.created_at
    );

    if not p_force then
      return query select false, 'in_flight'::text, v_row.status::text;
      return;
    end if;

    if v_last_activity > (now() - v_stale_after) then
      -- Force was requested but the operation is recent enough that it
      -- may genuinely still be running.
      return query select false, 'too_recent_to_force'::text, v_row.status::text;
      return;
    end if;

    update public.system_restores
    set status = 'cancelled',
        completed_at = now(),
        error_message = format(
          'Force-cancelled by a technical administrator after being stalled in %s for over 30 minutes. Any partially applied changes were NOT rolled back — review restored_row_counts and the pre-restore safety backup before retrying.',
          v_row.status
        )
    where operation_id = p_operation_id;

    insert into public.audit_logs (profile_id, action, table_name, record_id, new_values)
    values (
      public.current_profile_id(),
      'RESTORE_FORCE_CANCELLED',
      'system_restores',
      p_operation_id,
      jsonb_build_object('previous_status', v_row.status, 'backup_id', v_row.backup_id, 'forced', true)
    );

    return query select true, 'force_cancelled'::text, v_row.status::text;
    return;
  end if;

  -- Freely cancellable: nothing was written.
  update public.system_restores
  set status = 'cancelled',
      completed_at = now(),
      error_message = format('Cancelled by a technical administrator before execution (was %s). No data was modified.', v_row.status)
  where operation_id = p_operation_id;

  insert into public.audit_logs (profile_id, action, table_name, record_id, new_values)
  values (
    public.current_profile_id(),
    'RESTORE_CANCELLED',
    'system_restores',
    p_operation_id,
    jsonb_build_object('previous_status', v_row.status, 'backup_id', v_row.backup_id, 'forced', false)
  );

  return query select true, 'cancelled'::text, v_row.status::text;
end;
$$;

comment on function public.cancel_restore_operation(uuid, boolean) is
  'Cancels a restore operation and releases the restore lock. Operations that have not written anything (pending/awaiting_confirmation/confirmed) cancel freely. Operations that may be mid-write (creating_safety_backup/restoring/verifying) are REFUSED unless p_force is true AND the operation has been stalled for over 30 minutes — releasing the lock on a live restore would permit a concurrent second restore against a half-restored database. The 30-minute floor is server-side and cannot be shortened by the caller. Every cancellation is audited.';

revoke all on function public.cancel_restore_operation(uuid, boolean) from public, anon;
grant execute on function public.cancel_restore_operation(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- 3. ONE-OFF: release any operation currently stuck from the defect
--    described in this file's header.
--
-- Bounded deliberately to the three never-wrote-anything statuses. A
-- row in 'restoring' or 'creating_safety_backup' is NOT touched here —
-- that needs a human decision via cancel_restore_operation(..., true),
-- because something may have been partially applied.
-- ---------------------------------------------------------
update public.system_restores
set status = 'cancelled',
    completed_at = now(),
    error_message = 'Cancelled by module44: orphaned by the wizard-cancel defect (the UI never released the operation row). No data was modified by this operation.'
where status in ('pending', 'awaiting_confirmation', 'confirmed');


-- =========================================================
-- VERIFICATION — run after Part B.
-- =========================================================

-- 1. 'cancelled' exists on the enum:
--   select enumlabel from pg_enum
--   where enumtypid = 'restore_operation_status'::regtype order by enumsortorder;

-- 2. Nothing is holding the lock any more (expect 0 rows):
--   select operation_id, status, created_at from public.system_restores
--   where status not in ('validation_failed','safety_backup_failed','restore_failed',
--                        'verification_failed','verified','cancelled');

-- 3. What was just released (expect your stuck operation(s)):
--   select operation_id, status, error_message, completed_at
--   from public.system_restores where status = 'cancelled'
--   order by completed_at desc limit 5;

-- 4. A new restore can start again — as a technical admin, against any
--    completed backup (expect an operation_id + confirmation phrase,
--    NOT RESTORE_LOCKED). Cancel it immediately afterwards:
--   select * from public.begin_restore_operation('<a real backup_id>');
--   select * from public.cancel_restore_operation('<the operation_id returned>');

-- 5. An in-flight operation is protected from a casual cancel
--    (expect ok=false, reason='in_flight'):
--   -- with a row artificially set to 'restoring', then:
--   select * from public.cancel_restore_operation('<that operation_id>');

-- 6. Non-technical-admin callers are refused (expect 42501) — as
--    provincial_staff / municipal_admin / barangay_admin:
--   select * from public.cancel_restore_operation('<any operation_id>');

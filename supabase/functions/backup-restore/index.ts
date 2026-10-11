// supabase/functions/backup-restore/index.ts
//
// Deploy with:
//   supabase functions deploy backup-restore
// (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are already available to
// Edge Functions automatically. No new secret is needed — unlike
// backup-create, this function has no scheduled/internal caller at all:
// restore is never automatic.)
//
// Module 23 — the controlled Restore capability for the Administrative
// Configuration Backup (module16/backup-create). Every action here is
// human-only, technical-admin-only, and re-checks authorization
// server-side regardless of what the frontend already gated.
//
// Three actions, matching three steps of the frontend wizard:
//   'begin'   — claim the (real, backend-level) restore lock, generate
//               the confirmation phrase, and run full validation against
//               the selected backup. Never returns a usable operation
//               without having actually validated something.
//   'confirm' — check the typed phrase against the one this function
//               generated, nothing else; never a blind "confirmed:true".
//   'execute' — re-validate one more time, attempt a pre-restore safety
//               backup (abort if it fails — never restore without one),
//               apply the selected backup, then run read-only
//               post-restore verification before ever reporting success.
//
// RESTORE SCOPE — upsert, never delete or truncate. municipalities,
// barangays, and shelters rows from the backup are inserted/updated by
// primary key; anything created or changed in the live tables AFTER the
// backup was taken is left alone. A destructive "make the table exactly
// match the backup" restore was deliberately rejected: these tables have
// foreign-key dependents (survivors, case_reports, user_profiles, ...)
// that are NOT part of this backup/restore at all, so deleting a row
// that's newer than the backup could orphan a live case or account
// record. Upsert-only means restore can only ever ADD BACK what's
// missing or REVERT a row to an earlier state — it structurally cannot
// break a foreign key that wasn't already broken.
//
// The backup's "administrators" payload (non-survivor user_profiles —
// role, is_active, municipality/barangay/shelter assignment) is
// deliberately EXCLUDED from restore entirely, even though it IS part of
// the backup file. Reverting an administrator account's role or
// is_active flag could silently reinstate access that was deliberately
// revoked after the backup was taken — a confidentiality/access-control
// regression, not a recovery. If an administrator account genuinely
// needs to be restored, that is a deliberate, individually-reviewed
// action for Roles & Permissions, not a side effect of a database
// restore.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createBackupExport, runBackupValidation } from '../_shared/backupCore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Table -> primary key column, for the upsert. Deliberately NOT
// `administrators` — see file header.
const RESTORABLE_TABLES: Record<string, string> = {
  municipalities: 'municipality_id',
  barangays: 'barangay_id',
  shelters: 'shelter_id',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const res = await handleRequest(req);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers.entries()), ...corsHeaders },
    });
  } catch (e) {
    console.error('[backup-restore] unhandled error:', e);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. See server logs.' }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }
});

interface Caller {
  profileId: string;
  callerClient: SupabaseClient; // authenticated AS the human caller — needed so begin_restore_operation's internal is_provincial_technical_admin() check resolves auth.uid() correctly.
}

async function authorize(req: Request, supabaseUrl: string, serviceRoleKey: string): Promise<Caller | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }
  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  const {
    data: { user: callerUser },
  } = await callerClient.auth.getUser();
  if (!callerUser) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  }
  const { data: callerProfile } = await callerClient.from('user_profiles').select('profile_id, role').eq('auth_user_id', callerUser.id).single();
  if (!callerProfile || !['provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    // Deliberately the same wording/status as backup-create's own check —
    // this is the exact same technical-admin boundary, not a second one.
    return new Response(JSON.stringify({ error: 'Not authorized — technical administrator access required' }), { status: 403 });
  }
  return { profileId: callerProfile.profile_id, callerClient };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const body = await req.json().catch(() => null);
  const action: string | undefined = body?.action;
  if (!action || !['begin', 'confirm', 'execute'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }

  // Every action here is human-only — there is no internal-secret path
  // at all in this function. Restore is never triggered by anything but
  // an authenticated technical administrator.
  const caller = await authorize(req, supabaseUrl, serviceRoleKey);
  if (caller instanceof Response) return caller;

  if (action === 'begin') return handleBegin(adminClient, caller, body?.backupId);
  if (action === 'confirm') return handleConfirm(adminClient, caller, body?.operationId, body?.confirmationPhrase);
  return handleExecute(adminClient, caller, body?.operationId);
}

async function audit(adminClient: SupabaseClient, profileId: string, action: string, operationId: string, values: Record<string, unknown>) {
  await adminClient.from('audit_logs').insert({
    profile_id: profileId,
    action,
    table_name: 'system_restores',
    record_id: operationId,
    new_values: values, // metadata only — operation/backup IDs, status, counts, sanitized errors. Never file contents.
  });
}

async function handleBegin(adminClient: SupabaseClient, caller: Caller, backupId: string | undefined): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });

  const { data: backup, error: backupErr } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (backupErr || !backup) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });

  // The one authenticated entry point into the restore lifecycle — a
  // real Postgres advisory lock inside this RPC (not a React boolean)
  // is what actually serializes two technical admins clicking Restore
  // at the same instant. See module23's SQL for the full reasoning.
  const { data: beginResult, error: beginErr } = await caller.callerClient.rpc('begin_restore_operation', { p_backup_id: backupId });
  if (beginErr || !beginResult || !beginResult[0]) {
    const message = beginErr?.message ?? 'Could not start restore';
    const locked = message.includes('RESTORE_LOCKED');
    return new Response(
      JSON.stringify({ error: locked ? 'Another recovery operation is currently in progress.' : message }),
      { status: locked ? 409 : 403 }
    );
  }
  const operationId: string = beginResult[0].operation_id;
  const confirmationPhrase: string = beginResult[0].confirmation_phrase;

  await audit(adminClient, caller.profileId, 'RESTORE_REQUESTED', operationId, { backup_id: backupId, outcome: 'in_progress' });
  await audit(adminClient, caller.profileId, 'RESTORE_VALIDATION_STARTED', operationId, { backup_id: backupId });

  const validation = await runBackupValidation(adminClient, backup);

  if (!validation.valid) {
    await adminClient
      .from('system_restores')
      .update({ status: 'validation_failed', validation_result: validation.checklist, completed_at: new Date().toISOString() })
      .eq('operation_id', operationId);
    await audit(adminClient, caller.profileId, 'RESTORE_VALIDATION_FAILED', operationId, { backup_id: backupId, checklist: validation.checklist, outcome: 'failed' });
    return new Response(
      JSON.stringify({
        operationId,
        status: 'validation_failed',
        valid: false,
        checklist: validation.checklist,
        message: 'Backup validation failed. This backup cannot be restored.',
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  await adminClient
    .from('system_restores')
    .update({ status: 'awaiting_confirmation', validation_result: validation.checklist })
    .eq('operation_id', operationId);

  return new Response(
    JSON.stringify({
      operationId,
      status: 'awaiting_confirmation',
      valid: true,
      checklist: validation.checklist,
      confirmationPhrase,
      backupPreview: {
        backupId: backup.backup_id,
        createdAt: backup.completed_at ?? backup.started_at,
        sizeBytes: backup.size_bytes,
        rowCounts: backup.row_counts,
        schemaVersion: validation.schemaVersion,
      },
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}

async function handleConfirm(
  adminClient: SupabaseClient,
  caller: Caller,
  operationId: string | undefined,
  confirmationPhrase: string | undefined
): Promise<Response> {
  if (!operationId || !confirmationPhrase) {
    return new Response(JSON.stringify({ error: 'operationId and confirmationPhrase are required' }), { status: 400 });
  }
  const { data: op, error } = await adminClient.from('system_restores').select('*').eq('operation_id', operationId).single();
  if (error || !op) return new Response(JSON.stringify({ error: 'Restore operation not found' }), { status: 404 });

  if (op.status !== 'awaiting_confirmation') {
    return new Response(JSON.stringify({ error: 'This restore is no longer awaiting confirmation.' }), { status: 409 });
  }
  if (confirmationPhrase.trim() !== op.confirmation_phrase) {
    return new Response(JSON.stringify({ error: 'Confirmation phrase does not match.' }), { status: 400 });
  }

  await adminClient.from('system_restores').update({ status: 'confirmed' }).eq('operation_id', operationId).eq('status', 'awaiting_confirmation');
  await audit(adminClient, caller.profileId, 'RESTORE_CONFIRMED', operationId, { backup_id: op.backup_id, outcome: 'confirmed' });

  return new Response(JSON.stringify({ operationId, status: 'confirmed' }), { headers: { 'content-type': 'application/json' } });
}

async function handleExecute(adminClient: SupabaseClient, caller: Caller, operationId: string | undefined): Promise<Response> {
  if (!operationId) return new Response(JSON.stringify({ error: 'operationId is required' }), { status: 400 });

  // Atomic compare-and-swap — only ONE call (concurrent duplicate clicks
  // included) can ever see rowCount > 0 here, because the WHERE clause
  // only matches the single moment the row is still 'confirmed'. Every
  // other caller (a browser refresh resubmitting the same request, a
  // second admin tab) gets rejected below instead of double-executing.
  const { data: claimed, error: claimErr } = await adminClient
    .from('system_restores')
    .update({ status: 'creating_safety_backup', started_at: new Date().toISOString() })
    .eq('operation_id', operationId)
    .eq('status', 'confirmed')
    .select()
    .single();
  if (claimErr || !claimed) {
    return new Response(JSON.stringify({ error: 'This restore is not in a confirmed state, or has already started.' }), { status: 409 });
  }

  const { data: backup, error: backupErr } = await adminClient.from('system_backups').select('*').eq('backup_id', claimed.backup_id).single();
  if (backupErr || !backup) {
    await failOperation(adminClient, caller, operationId, 'restore_failed', 'Selected backup could not be re-read at execution time.');
    return new Response(JSON.stringify({ error: 'Restore failed. The selected backup could not be re-read.' }), { status: 500 });
  }

  // Re-validate immediately before touching data — never trust a
  // validation result from the earlier 'begin' step, however recent.
  const revalidation = await runBackupValidation(adminClient, backup);
  if (!revalidation.valid) {
    await failOperation(adminClient, caller, operationId, 'restore_failed', 'Backup failed re-validation immediately before restore.', revalidation.checklist);
    return new Response(
      JSON.stringify({ error: 'Restore cannot continue — the backup failed re-validation immediately before execution.', checklist: revalidation.checklist }),
      { status: 409 }
    );
  }

  // --- Pre-restore safety backup — mandatory, not optional. ---
  const safetyResult = await createBackupExport(adminClient, 'pre_restore', caller.profileId);
  if (!safetyResult.ok) {
    await adminClient
      .from('system_restores')
      .update({ status: 'safety_backup_failed', completed_at: new Date().toISOString(), error_message: 'Pre-restore safety backup could not be created.' })
      .eq('operation_id', operationId);
    await audit(adminClient, caller.profileId, 'RESTORE_FAILED', operationId, { backup_id: claimed.backup_id, stage: 'pre_restore_backup', outcome: 'failed' });
    return new Response(
      JSON.stringify({ error: 'Pre-restore safety backup could not be created. Restore cannot safely continue.' }),
      { status: 500 }
    );
  }
  await adminClient.from('system_restores').update({ safety_backup_id: safetyResult.backupId }).eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'PRE_RESTORE_BACKUP_CREATED', operationId, { backup_id: claimed.backup_id, safety_backup_id: safetyResult.backupId, outcome: 'completed' });

  // --- Apply the restore (upsert-only — see file header for why). ---
  await adminClient.from('system_restores').update({ status: 'restoring' }).eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'RESTORE_STARTED', operationId, { backup_id: claimed.backup_id, outcome: 'in_progress' });

  let restoredCounts: Record<string, number> = {};
  try {
    const { data: fileBlob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
    if (dlErr || !fileBlob) throw new Error('Backup file could not be retrieved for restore.');
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json) as { tables?: Record<string, unknown[]> };

    for (const [table, pkColumn] of Object.entries(RESTORABLE_TABLES)) {
      const rows = parsed.tables?.[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        restoredCounts[table] = 0;
        continue;
      }
      const { error: upsertErr } = await adminClient.from(table).upsert(rows, { onConflict: pkColumn });
      if (upsertErr) throw new Error(`Failed to restore ${table}: ${upsertErr.message}`);
      restoredCounts[table] = rows.length;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backup-restore] execute failed:', message);
    await failOperation(adminClient, caller, operationId, 'restore_failed', message);
    return new Response(JSON.stringify({ error: 'Restore failed while applying data. See Recovery Activity for details.' }), { status: 500 });
  }

  await adminClient
    .from('system_restores')
    .update({ restored_row_counts: restoredCounts })
    .eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'RESTORE_COMPLETED', operationId, { backup_id: claimed.backup_id, restored_row_counts: restoredCounts, outcome: 'completed' });

  // --- Post-restore verification — read-only health checks only. ---
  await adminClient.from('system_restores').update({ status: 'verifying' }).eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'RESTORE_VERIFICATION_STARTED', operationId, { backup_id: claimed.backup_id });

  const verification = await verifyRestoredSystem(adminClient);

  if (!verification.ok) {
    await adminClient
      .from('system_restores')
      .update({ status: 'verification_failed', verification_result: verification.checks, completed_at: new Date().toISOString() })
      .eq('operation_id', operationId);
    await audit(adminClient, caller.profileId, 'RESTORE_VERIFICATION_FAILED', operationId, { backup_id: claimed.backup_id, checks: verification.checks, outcome: 'failed' });
    return new Response(
      JSON.stringify({
        operationId,
        status: 'verification_failed',
        message: 'Restore completed but post-restore verification failed. System requires investigation.',
        checks: verification.checks,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  await adminClient
    .from('system_restores')
    .update({ status: 'verified', verification_result: verification.checks, completed_at: new Date().toISOString() })
    .eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'RESTORE_VERIFIED', operationId, { backup_id: claimed.backup_id, checks: verification.checks, outcome: 'verified' });

  return new Response(
    JSON.stringify({ operationId, status: 'verified', message: 'Restore completed and verified.', restoredCounts, checks: verification.checks }),
    { headers: { 'content-type': 'application/json' } }
  );
}

async function failOperation(
  adminClient: SupabaseClient,
  caller: Caller,
  operationId: string,
  status: string,
  errorMessage: string,
  validationResult?: unknown
) {
  await adminClient
    .from('system_restores')
    .update({ status, error_message: errorMessage.slice(0, 500), completed_at: new Date().toISOString(), ...(validationResult ? { validation_result: validationResult } : {}) })
    .eq('operation_id', operationId);
  await audit(adminClient, caller.profileId, 'RESTORE_FAILED', operationId, { error: errorMessage.slice(0, 200), outcome: 'failed' });
}

interface HealthCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

// Read-only only — this never writes, per the brief's explicit
// "do not modify production data merely to test it."
async function verifyRestoredSystem(adminClient: SupabaseClient): Promise<{ ok: boolean; checks: HealthCheck[] }> {
  const checks: HealthCheck[] = [];
  const pass = (label: string, detail?: string) => checks.push({ label, passed: true, detail });
  const fail = (label: string, detail?: string) => checks.push({ label, passed: false, detail });

  let shelterTotal: number | null = null;
  for (const table of Object.keys(RESTORABLE_TABLES)) {
    const { error, count } = await adminClient.from(table).select('*', { count: 'exact', head: true });
    if (error) fail(`${table} table is queryable`, error.message);
    else pass(`${table} table is queryable`, `${count ?? 0} rows`);
    if (table === 'shelters') shelterTotal = count ?? 0;
  }

  const { error: backupsErr } = await adminClient.from('system_backups').select('backup_id').limit(1);
  if (backupsErr) fail('Backup/recovery metadata reachable', backupsErr.message);
  else pass('Backup/recovery metadata reachable');

  // A real, targeted referential-integrity check specific to the risk
  // this restore design exists to avoid: every shelter's municipality_id
  // must resolve to a real municipality row. An upsert-only restore
  // cannot introduce this break on its own, but this is what would catch
  // it immediately if it somehow occurred rather than finding out later
  // from a broken admin screen. `!inner` drops any shelter whose
  // municipality_id doesn't match a real row, so a lower count than the
  // shelters table's own total count means an orphan exists.
  const { count: joinedCount, error: joinErr } = await adminClient
    .from('shelters')
    .select('shelter_id, municipalities!inner(municipality_id)', { count: 'exact', head: true });
  if (joinErr) {
    fail('Shelter → municipality references intact', joinErr.message);
  } else if (shelterTotal != null && (joinedCount ?? 0) < shelterTotal) {
    fail('Shelter → municipality references intact', `${shelterTotal - (joinedCount ?? 0)} shelter(s) reference a missing municipality`);
  } else {
    pass('Shelter → municipality references intact');
  }

  return { ok: checks.every((c) => c.passed), checks };
}

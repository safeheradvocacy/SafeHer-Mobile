// supabase/functions/backup-create/index.ts
//
// Deploy with:
//   supabase functions deploy backup-create
//   supabase secrets set BACKUP_DISPATCH_SECRET=<random value>
// (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are already available to
// Edge Functions automatically.)
//
// Real, working "Administrative Configuration Backup" (module16) —
// exports municipalities, barangays, shelters, and non-survivor
// user_profiles rows (technical/administrative reference data ONLY —
// never survivors, case_reports, case_*, user_verifications,
// case_access_tokens/case_client_links, audit_logs, notifications, or
// saved_reports) to the private `system-backups` Storage bucket, and
// records real metadata in public.system_backups. This is NOT a full
// database backup — full database-level recovery is Supabase's own
// Point-in-Time Recovery, a separate real platform capability that is
// not enabled for this project today (see module16's file header for
// the verified `supabase backups list` output).
//
// Restore (module23) lives in the separate backup-restore Edge
// Function, not here — both functions import the actual export/
// validation logic from _shared/backupCore.ts rather than one
// duplicating the other, and specifically rather than backup-restore
// importing this file directly: an earlier draft did that and it was
// a real bug, not just untidy — this file's own serve(...) call below
// is a side effect that fires on import, so importing this index.ts
// from backup-restore's index.ts silently registered a SECOND request
// handler that intercepted every request meant for backup-restore and
// answered "Unknown action" for begin/confirm/execute. _shared/
// backupCore.ts has no serve(...) call and is safe to import from
// anywhere.
//
// Two callers, both handled the same way create-admin-user/
// send-push-notification already establish:
//  - A human technical administrator (provincial_admin/super_admin),
//    authenticated via their own JWT.
//  - The pg_cron scheduled job (module16's set_backup_schedule()),
//    which has no user JWT and instead presents the shared
//    `x-internal-secret` header matching this function's own
//    BACKUP_DISPATCH_SECRET — identical shape to send-push-notification's
//    PUSH_DISPATCH_SECRET check. Only the 'create' action accepts this
//    path; 'validate'/'download' are human-only actions.

// MODULE 42 ADDITIONS
//  * Every HUMAN action now additionally requires a single-use
//    authorization grant minted by the backup-auth function after the
//    dedicated password was entered (§5). The grant is consumed
//    server-side here — the frontend hiding a button is not a control.
//  * 'create' writes a versioned ZIP archive (createZipBackupExport)
//    instead of the legacy .json.gz. Existing .json.gz backups stay
//    fully readable/validatable: which path a row took is recorded in
//    system_backups.archive_format and routed on explicitly.
//  * New 'delete' action, also grant-gated, which refuses to remove an
//    archive that a restore operation still references.
//
//  The SCHEDULED caller is deliberately exempt from the grant — and can
//  only ever reach 'create'. A scheduled run cannot have a human typing
//  a password at 02:00, so it authenticates with module16's
//  x-internal-secret and is authorized for that one operation only. It
//  can neither download, validate, delete, nor restore (§5's
//  "the scheduler must not be able to restore or delete data simply
//  because it can create a backup").

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createZipBackupExport, runBackupValidation, runZipArchiveValidation } from '../_shared/backupCore.ts';
import { auditContextFrom } from '../_shared/requestContext.ts';

// Carried into every audit insert in this file. The database default on
// audit_logs.ip_address would record THIS function's address rather
// than the operator's browser, so the real client context is passed
// explicitly instead.
type AuditCtx = { ip_address: string | null; user_agent: string | null };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    console.error('[backup-create] unhandled error:', e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const body = await req.json().catch(() => null);
  const action: string | undefined = body?.action;
  if (!action || !['create', 'validate', 'download', 'delete'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }

  // Authorization — resolved once, used by whichever action runs below.
  const internalSecret = req.headers.get('x-internal-secret');
  const expectedSecret = Deno.env.get('BACKUP_DISPATCH_SECRET');
  const isScheduledCaller = action === 'create' && !!expectedSecret && internalSecret === expectedSecret;

  let callerProfileId: string | null = null;
  if (!isScheduledCaller) {
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
    const { data: callerProfile } = await callerClient.from('user_profiles').select('*').eq('auth_user_id', callerUser.id).single();
    if (!callerProfile || !['provincial_admin', 'super_admin'].includes(callerProfile.role) || !callerProfile.is_active) {
      return new Response(JSON.stringify({ error: 'Not authorized — technical administrator access required' }), { status: 403 });
    }
    // Held as a non-nullable local as well: callerProfileId is declared
    // `string | null` for the scheduled path (which has no human
    // caller), but inside this branch it is always a real profile id.
    // consumeGrant requires a definite id — passing the nullable
    // binding would let a future refactor hand it null and silently
    // widen the authorization check.
    const humanProfileId: string = callerProfile.profile_id;
    callerProfileId = humanProfileId;

    // Module 42 — the dedicated-password gate, enforced on the backend
    // for every human action. A grant is bound to one operation and one
    // target and is spent here exactly once.
    const refusal = await consumeGrant(
      adminClient,
      body?.grantId,
      humanProfileId,
      action,
      action === 'create' ? null : body?.backupId ?? null
    );
    if (refusal) return refusal;
  }

  const auditCtx = auditContextFrom(req);

  if (action === 'create') return handleCreate(adminClient, callerProfileId, isScheduledCaller, body?.includeStorageBinaries === true);
  if (action === 'validate') return handleValidate(adminClient, body?.backupId, callerProfileId, auditCtx);
  if (action === 'delete') return handleDelete(adminClient, body?.backupId, callerProfileId, auditCtx);
  return handleDownload(adminClient, body?.backupId, callerProfileId, auditCtx);
}

/**
 * Spends a module42 authorization grant. Returns a Response on refusal,
 * or null when the grant was valid and has been consumed.
 *
 * Deliberately returns distinct statuses: a MISSING grant is 401
 * (authorize first), an invalid/expired/already-used one is 403 (that
 * authorization will not work, get a new one). Flattening both into one
 * message would make an expired grant indistinguishable from a
 * misconfigured deployment.
 */
async function consumeGrant(
  adminClient: SupabaseClient,
  grantId: unknown,
  profileId: string,
  operation: string,
  targetId: string | null
): Promise<Response | null> {
  if (typeof grantId !== 'string' || grantId.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Backup authorization is required for this operation.', reason: 'grant_required' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }
  const { data, error } = await adminClient
    .rpc('consume_backup_grant', {
      p_grant_id: grantId,
      p_profile_id: profileId,
      p_operation: operation,
      p_target_id: targetId,
    })
    .single();

  if (error) {
    console.error(`[backup-create] consume_backup_grant failed (code=${error.code}): ${error.message}`);
    return new Response(JSON.stringify({ error: 'Could not verify backup authorization.', reason: 'grant_check_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const row = data as { ok: boolean; reason: string };
  if (!row.ok) {
    await adminClient.from('audit_logs').insert({
      profile_id: profileId,
      action: 'BACKUP_AUTH_GRANT_REJECTED',
      table_name: 'backup_auth_grants',
      new_values: { operation, target_id: targetId, reason: row.reason },
    });
    return new Response(JSON.stringify({ error: 'Backup authorization is not valid for this operation.', reason: row.reason }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return null;
}

async function handleCreate(
  adminClient: SupabaseClient,
  callerProfileId: string | null,
  isScheduled: boolean,
  includeStorageBinaries: boolean
): Promise<Response> {
  // module43 — duplicate-occurrence guard for UNATTENDED runs only.
  //
  // A cron retry, a double-fired job, or a transient network error that
  // causes pg_net to re-POST would each otherwise produce a second full
  // archive for the same scheduled moment. The claim is decided by a
  // partial unique index in the database, so two concurrent invocations
  // cannot both win it.
  //
  // Manual runs are deliberately NOT keyed: an operator may legitimately
  // take two backups minutes apart, and blocking that would be wrong.
  let claimedBackupId: string | undefined;
  if (isScheduled) {
    // Hour-resolution key, matching the schedule's own hour resolution.
    const now = new Date();
    const occurrenceKey = `sched:${now.toISOString().slice(0, 13)}`; // sched:YYYY-MM-DDTHH (UTC)

    const { data: claimed, error: claimErr } = await adminClient.rpc('claim_scheduled_backup_occurrence', {
      p_occurrence_key: occurrenceKey,
      p_retention_days: null,
    });

    if (claimErr) {
      console.error(`[backup-create] occurrence claim failed (code=${claimErr.code}): ${claimErr.message}`);
      return new Response(
        JSON.stringify({ error: 'Could not claim the scheduled occurrence.', reason: 'claim_failed' }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
    if (!claimed) {
      // Not an error: another invocation already owns this occurrence.
      // Returning 200 keeps pg_net from treating it as a failure and
      // retrying, which would just lose the race again.
      console.log(`[backup-create] occurrence ${occurrenceKey} already claimed; skipping duplicate scheduled run.`);
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'duplicate_occurrence', occurrenceKey }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    claimedBackupId = claimed as string;
  }

  const result = await createZipBackupExport(
    adminClient,
    isScheduled ? 'scheduled' : 'manual',
    callerProfileId,
    includeStorageBinaries,
    claimedBackupId
  );

  // Record real scheduled-run state so the UI shows what happened
  // rather than inferring it from the backup list.
  if (isScheduled && result.backupId) {
    const { error: outcomeErr } = await adminClient.rpc('record_scheduled_run_outcome', {
      p_backup_id: result.backupId,
      p_status: result.ok ? (result.isComplete === false ? 'completed_with_warnings' : 'completed') : 'failed',
    });
    if (outcomeErr) console.error('[backup-create] could not record scheduled run outcome:', outcomeErr.message);
  }
  if (!result.ok) {
    return new Response(JSON.stringify({ backupId: result.backupId, status: 'failed', error: result.error }), { status: 500 });
  }
  // isComplete is reported separately from status on purpose: "the run
  // finished" and "the archive holds everything" are different claims,
  // and the UI must be able to show "Complete with warnings".
  return new Response(
    JSON.stringify({
      backupId: result.backupId,
      status: 'completed',
      isComplete: result.isComplete,
      sizeBytes: result.sizeBytes,
      durationMs: result.durationMs,
      rowCounts: result.rowCounts,
      coverage: result.coverage,
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}

/**
 * Deletes an archive. Refuses while any restore operation still
 * references it (as the source or as its pre-restore checkpoint), and
 * refuses while a non-terminal restore is running at all — §6's
 * "avoid allowing a backup to be deleted while a restore or validation
 * job is actively using it", enforced here rather than hoped for.
 */
async function handleDelete(
  adminClient: SupabaseClient,
  backupId: string | undefined,
  callerProfileId: string | null,
  auditCtx: AuditCtx
): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });

  const { data: backup, error } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (error || !backup) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });

  const { data: referencing } = await adminClient
    .from('system_restores')
    .select('operation_id, status, backup_id, safety_backup_id')
    .or(`backup_id.eq.${backupId},safety_backup_id.eq.${backupId}`);

  if ((referencing ?? []).length > 0) {
    const active = (referencing ?? []).filter(
      (r) =>
        !['validation_failed', 'safety_backup_failed', 'restore_failed', 'verification_failed', 'verified', 'cancelled'].includes(
          r.status
        )
    );
    return new Response(
      JSON.stringify({
        error: active.length > 0
          ? 'This archive is in use by a restore operation that is still running.'
          : 'This archive is referenced by restore history and is retained for audit purposes.',
        reason: active.length > 0 ? 'in_use_by_restore' : 'referenced_by_restore_history',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } }
    );
  }

  // Refuse to delete the last remaining verified recovery copy — §11's
  // "do not automatically delete the only verified recovery copy",
  // applied to manual deletion too, since a human clicking delete on
  // their only good backup is the same loss.
  if (backup.verification_status === 'verified') {
    const { count } = await adminClient
      .from('system_backups')
      .select('backup_id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .eq('verification_status', 'verified')
      .neq('backup_id', backupId);
    if ((count ?? 0) === 0) {
      return new Response(
        JSON.stringify({
          error: 'This is the only verified backup. Create and verify another before deleting it.',
          reason: 'last_verified_copy',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      );
    }
  }

  if (backup.storage_path) {
    const { error: rmErr } = await adminClient.storage.from('system-backups').remove([backup.storage_path]);
    if (rmErr) {
      return new Response(JSON.stringify({ error: `Could not remove the archive file: ${rmErr.message}` }), { status: 500 });
    }
  }
  const { error: delErr } = await adminClient.from('system_backups').delete().eq('backup_id', backupId);
  if (delErr) {
    // The file is already gone at this point, so this must be loud
    // rather than swallowed — the same dangling-row failure mode
    // pruneExpired documents.
    console.error(`[backup-create] archive file removed but catalog row ${backupId} could not be deleted: ${delErr.message}`);
    return new Response(JSON.stringify({ error: 'The archive file was removed but its catalog row could not be deleted. See server logs.' }), { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    profile_id: callerProfileId,
    action: 'BACKUP_DELETED',
    table_name: 'system_backups',
    record_id: backupId,
    old_values: { storage_path: backup.storage_path, size_bytes: backup.size_bytes, verification_status: backup.verification_status },
    ...auditCtx,
  });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}

async function handleValidate(
  adminClient: SupabaseClient,
  backupId: string | undefined,
  callerProfileId: string | null,
  auditCtx: AuditCtx
): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });
  const { data: backup, error } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (error || !backup) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });

  // Routed on the RECORDED format, never on the filename — a .json.gz
  // backup from module16 must keep validating under the logic it was
  // written by, and a ZIP must get the archive-content walk.
  if (backup.archive_format === 'zip') {
    const outcome = await runZipArchiveValidation(adminClient, backup);

    // archiveIntact and restoreReady are deliberately distinct: an
    // archive can be byte-perfect and still not be a complete recovery
    // source. Only archiveIntact drives verification_status, because
    // that column means "the bytes are sound", not "this will restore
    // the whole system".
    await adminClient
      .from('system_backups')
      .update({
        verification_status: outcome.archiveIntact ? 'verified' : 'corrupted',
        verified_at: new Date().toISOString(),
      })
      .eq('backup_id', backupId);

    await adminClient.from('audit_logs').insert({
      profile_id: callerProfileId,
      action: outcome.archiveIntact ? 'BACKUP_VALIDATED' : 'BACKUP_INTEGRITY_FAILED',
      table_name: 'system_backups',
      record_id: backupId,
      // Metadata only — pass/fail per named check, never file contents.
      new_values: {
        archive_intact: outcome.archiveIntact,
        restore_ready: outcome.restoreReady,
        coverage_complete: outcome.coverageComplete,
        checks: outcome.checks,
        warnings: outcome.warnings,
      },
      ...auditCtx,
    });

    return new Response(
      JSON.stringify({
        archiveFormat: 'zip',
        archiveIntact: outcome.archiveIntact,
        restoreReady: outcome.restoreReady,
        coverageComplete: outcome.coverageComplete,
        checks: outcome.checks,
        warnings: outcome.warnings,
        // Explicit so no caller can mistake archive integrity for proof
        // that a restore will succeed.
        disclaimer:
          'These checks verify the archive’s integrity and internal consistency. They do not prove a restore into this environment will succeed — only an isolated restore test can do that.',
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  const outcome = await runBackupValidation(adminClient, backup);

  await adminClient
    .from('system_backups')
    .update({
      verification_status: outcome.valid ? 'verified' : 'corrupted',
      verified_at: new Date().toISOString(),
    })
    .eq('backup_id', backupId);

  await adminClient.from('audit_logs').insert({
    profile_id: callerProfileId,
    action: outcome.valid ? 'BACKUP_VALIDATED' : 'BACKUP_INTEGRITY_FAILED',
    table_name: 'system_backups',
    record_id: backupId,
    // Metadata only — pass/fail per named check, never file contents.
    new_values: { valid: outcome.valid, checklist: outcome.checklist },
    ...auditCtx,
  });

  return new Response(
    JSON.stringify({ archiveFormat: 'json_gz', valid: outcome.valid, details: outcome.checklist, checklist: outcome.checklist }),
    { headers: { 'content-type': 'application/json' } }
  );
}

async function handleDownload(
  adminClient: SupabaseClient,
  backupId: string | undefined,
  callerProfileId: string | null,
  auditCtx: AuditCtx
): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });
  const { data: backup, error } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (error || !backup || backup.status !== 'completed' || !backup.storage_path) {
    return new Response(JSON.stringify({ error: 'Backup not available for download' }), { status: 404 });
  }

  const { data: signed, error: signErr } = await adminClient.storage.from('system-backups').createSignedUrl(backup.storage_path, 60);
  if (signErr || !signed) {
    return new Response(JSON.stringify({ error: 'Could not create a download link' }), { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    profile_id: callerProfileId,
    action: 'BACKUP_DOWNLOADED',
    table_name: 'system_backups',
    record_id: backupId,
    ...auditCtx,
  });

  return new Response(JSON.stringify({ url: signed.signedUrl, expiresInSeconds: 60 }), { headers: { 'content-type': 'application/json' } });
}

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

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createBackupExport, runBackupValidation } from '../_shared/backupCore.ts';

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
  if (!action || !['create', 'validate', 'download'].includes(action)) {
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
    if (!callerProfile || !['provincial_admin', 'super_admin'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Not authorized — technical administrator access required' }), { status: 403 });
    }
    callerProfileId = callerProfile.profile_id;
  }

  if (action === 'create') return handleCreate(adminClient, callerProfileId, isScheduledCaller);
  if (action === 'validate') return handleValidate(adminClient, body?.backupId, callerProfileId);
  return handleDownload(adminClient, body?.backupId, callerProfileId);
}

async function handleCreate(adminClient: SupabaseClient, callerProfileId: string | null, isScheduled: boolean): Promise<Response> {
  const result = await createBackupExport(adminClient, isScheduled ? 'scheduled' : 'manual', callerProfileId);
  if (!result.ok) {
    return new Response(JSON.stringify({ backupId: result.backupId, status: 'failed', error: result.error }), { status: 500 });
  }
  return new Response(
    JSON.stringify({ backupId: result.backupId, status: 'completed', sizeBytes: result.sizeBytes, durationMs: result.durationMs, rowCounts: result.rowCounts }),
    { headers: { 'content-type': 'application/json' } }
  );
}

async function handleValidate(adminClient: SupabaseClient, backupId: string | undefined, callerProfileId: string | null): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });
  const { data: backup, error } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (error || !backup) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });

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
  });

  return new Response(
    JSON.stringify({ valid: outcome.valid, details: outcome.checklist, checklist: outcome.checklist }),
    { headers: { 'content-type': 'application/json' } }
  );
}

async function handleDownload(adminClient: SupabaseClient, backupId: string | undefined, callerProfileId: string | null): Promise<Response> {
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
  });

  return new Response(JSON.stringify({ url: signed.signedUrl, expiresInSeconds: 60 }), { headers: { 'content-type': 'application/json' } });
}

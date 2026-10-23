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
import { createBackupExport, createZipBackupExport, runBackupValidation, runZipArchiveValidation } from '../_shared/backupCore.ts';
import { openArchiveTables, restoreStorageObjects } from '../_shared/archiveBuilder.ts';
import { auditContextFrom } from '../_shared/requestContext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// LEGACY (.json.gz, module16/23) restore scope: table -> primary key.
// Deliberately NOT `administrators` — see file header.
const RESTORABLE_TABLES: Record<string, string> = {
  municipalities: 'municipality_id',
  barangays: 'barangay_id',
  shelters: 'shelter_id',
};

// ZIP (module42) restore scope.
//
// Tables NEVER restored, regardless of being present in the archive.
// Each exclusion is a decision, not an oversight:
//
//   user_profiles  — reverting an administrator's role or is_active
//                    could silently reinstate access that was
//                    deliberately revoked after the backup was taken.
//                    That is an access-control regression, not a
//                    recovery. Individual account recovery is a
//                    reviewed action in Roles & Permissions. (This is
//                    module23's original reasoning, unchanged, now
//                    stated as data rather than prose.)
//   audit_logs     — the audit trail of what happened must not be
//                    rewritten by a restore. Overwriting it with an
//                    older snapshot would erase the record of the
//                    very incident being recovered from, and the
//                    restore's own audit rows along with it.
//   terms_acceptances — a legal attestation of what a specific person
//                    agreed to at a specific time. Re-asserting an old
//                    snapshot could claim consent that was since
//                    withdrawn.
const NEVER_RESTORED = new Set(['user_profiles', 'audit_logs', 'terms_acceptances']);

interface TableDependency {
  table_name: string;
  pk_columns: string[];
  depends_on: string[];
}

/**
 * Orders tables parents-first using the REAL foreign-key graph, so a
 * child row is never inserted before the row it references.
 *
 * Returns `cycles` separately rather than throwing: a genuine FK cycle
 * cannot be ordered, and silently appending those tables at the end
 * would produce a restore that fails deep into execution. Naming them
 * up front lets the plan preview disclose them before anything is
 * written.
 */
function topologicallyOrder(
  deps: TableDependency[],
  present: Set<string>
): { ordered: string[]; cycles: string[] } {
  const inScope = deps.filter((d) => present.has(d.table_name) && !NEVER_RESTORED.has(d.table_name));
  const byName = new Map(inScope.map((d) => [d.table_name, d]));
  const ordered: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles = new Set<string>();

  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      // Everything from where the cycle started is part of it.
      const start = trail.indexOf(name);
      trail.slice(start === -1 ? 0 : start).forEach((t) => cycles.add(t));
      return;
    }
    const node = byName.get(name);
    if (!node) return; // parent not in this restore's scope — fine, upsert-only
    state.set(name, 'visiting');
    for (const parent of node.depends_on) {
      if (byName.has(parent)) visit(parent, [...trail, name]);
    }
    state.set(name, 'done');
    ordered.push(name);
  };

  for (const d of inScope) visit(d.table_name, []);
  return { ordered: ordered.filter((t) => !cycles.has(t)), cycles: [...cycles] };
}

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
  callerClient: SupabaseClient;
  // The OPERATOR's request context, captured once in authorize().
  // audit_logs' database default cannot see it: this function reaches
  // PostgREST over its own HTTP call, so request.headers there
  // describes this function, not the operator's browser.
  auditCtx: { ip_address: string | null; user_agent: string | null }; // authenticated AS the human caller — needed so begin_restore_operation's internal is_provincial_technical_admin() check resolves auth.uid() correctly.
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
  return { profileId: callerProfile.profile_id, callerClient, auditCtx: auditContextFrom(req) };
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
  if (!action || !['plan', 'begin', 'confirm', 'execute'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }

  // Every action here is human-only — there is no internal-secret path
  // at all in this function. Restore is never triggered by anything but
  // an authenticated technical administrator.
  const caller = await authorize(req, supabaseUrl, serviceRoleKey);
  if (caller instanceof Response) return caller;

  // Module 42 — the dedicated password gates 'begin' and 'execute',
  // each with its OWN single-use grant. 'confirm' is not separately
  // gated because it only checks the typed phrase against the one this
  // function generated and changes nothing; the authorization that
  // matters is re-taken at 'execute', immediately before anything is
  // written, per §5's "revalidate authorization immediately before
  // executing a restore or destructive operation". A 'restore_begin'
  // grant therefore cannot be replayed to execute.
  // 'plan' is read-only — it writes nothing, creates no operation, and
  // takes no lock — so it is role-gated but not grant-gated: the
  // operator must be able to SEE what a restore would do before being
  // asked to authorize it. It is still audited.
  if (action === 'plan') return handlePlan(adminClient, caller, body?.backupId);

  if (action === 'begin') {
    const refusal = await consumeGrant(adminClient, body?.grantId, caller.profileId, 'restore_begin', body?.backupId ?? null);
    if (refusal) return refusal;
    return handleBegin(adminClient, caller, body?.backupId);
  }
  if (action === 'confirm') return handleConfirm(adminClient, caller, body?.operationId, body?.confirmationPhrase);

  const refusal = await consumeGrant(adminClient, body?.grantId, caller.profileId, 'restore_execute', body?.operationId ?? null);
  if (refusal) return refusal;
  // Conflict policy is an explicit caller decision, validated against a
  // closed set. An unrecognised value falls back to the SAFE option
  // ('skip'), never to overwrite — a typo must not become data loss.
  const conflictPolicy: 'skip' | 'overwrite' = body?.storageConflictPolicy === 'overwrite' ? 'overwrite' : 'skip';
  return handleExecute(adminClient, caller, body?.operationId, conflictPolicy);
}

/**
 * Spends a module42 authorization grant, same contract as
 * backup-create's copy: Response on refusal, null when consumed.
 * Intentionally duplicated in both functions rather than shared,
 * because _shared/ modules are imported by BOTH and an authorization
 * helper is the last place to introduce a cross-function import whose
 * failure mode is "the gate silently didn't run".
 */
async function consumeGrant(
  adminClient: SupabaseClient,
  grantId: unknown,
  profileId: string,
  operation: 'restore_begin' | 'restore_execute',
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
    console.error(`[backup-restore] consume_backup_grant failed (code=${error.code}): ${error.message}`);
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

/**
 * Format-aware pre-restore validation, so both archive generations are
 * validated by the logic actually written for them. Routed on the
 * RECORDED archive_format, never on the filename.
 *
 * For a ZIP, `valid` is deliberately tied to archiveIntact (the bytes
 * and contents are sound) and NOT to restoreReady (which additionally
 * demands complete coverage). An intentionally Phase-1 archive is a
 * legitimate restore source for the data it does contain; refusing to
 * restore it because it lacks storage binaries would make incomplete
 * backups useless rather than merely partial. Coverage is surfaced to
 * the operator in the plan and confirmation screens instead.
 */
async function validateForRestore(
  adminClient: SupabaseClient,
  backup: Record<string, any>
): Promise<{
  valid: boolean;
  checklist: unknown;
  // Carried through deliberately: handleBegin reports it in its
  // backupPreview. An earlier version of this wrapper dropped it, which
  // typed as an error AND would have serialized `schemaVersion:
  // undefined` into the response at run time — the preview would have
  // silently shown no schema version at all.
  schemaVersion: string | null;
  coverageComplete?: boolean | null;
  warnings?: string[];
}> {
  if (backup.archive_format === 'zip') {
    const outcome = await runZipArchiveValidation(adminClient, backup);
    const manifestVersion =
      outcome.manifest && typeof outcome.manifest.data_schema_version === 'string'
        ? outcome.manifest.data_schema_version
        : null;
    return {
      valid: outcome.archiveIntact,
      checklist: outcome.checks,
      // Prefer the version recorded INSIDE the archive over the catalog
      // row: the manifest is what a restore would actually be applying.
      schemaVersion: manifestVersion ?? backup.schema_version ?? null,
      coverageComplete: outcome.coverageComplete,
      warnings: outcome.warnings,
    };
  }
  const legacy = await runBackupValidation(adminClient, backup);
  return { valid: legacy.valid, checklist: legacy.checklist, schemaVersion: legacy.schemaVersion };
}

async function audit(adminClient: SupabaseClient, caller: Caller, action: string, operationId: string, values: Record<string, unknown>) {
  await adminClient.from('audit_logs').insert({
    profile_id: caller.profileId,
    action,
    table_name: 'system_restores',
    record_id: operationId,
    ...caller.auditCtx,
    new_values: values, // metadata only — operation/backup IDs, status, counts, sanitized errors. Never file contents.
  });
}

/**
 * Stage 3 — the restore plan. Every number here is measured, not
 * estimated: archive row counts come from the archive's own members,
 * live row counts from exact count queries against the target, and the
 * ordering from the target's real FK graph. Nothing is hardcoded.
 *
 * Reports `wouldOverwrite` per table — rows whose primary key exists in
 * BOTH the archive and the live table. Those are the rows an upsert
 * actually changes, and they are the real blast radius an operator needs
 * to see before authorizing anything.
 */
async function handlePlan(adminClient: SupabaseClient, caller: Caller, backupId: string | undefined): Promise<Response> {
  if (!backupId) return new Response(JSON.stringify({ error: 'backupId is required' }), { status: 400 });

  const { data: backup, error } = await adminClient.from('system_backups').select('*').eq('backup_id', backupId).single();
  if (error || !backup) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });
  if (backup.status !== 'completed' || !backup.storage_path) {
    return new Response(JSON.stringify({ error: 'This backup did not complete and cannot be planned against.' }), { status: 409 });
  }

  if (backup.archive_format !== 'zip') {
    // The legacy format's scope is fixed and tiny; its plan is the three
    // reference tables. Reported honestly rather than pretending the
    // richer plan below applies to it.
    return new Response(
      JSON.stringify({
        archiveFormat: 'json_gz',
        legacy: true,
        tables: Object.keys(RESTORABLE_TABLES).map((t) => ({ table: t, archiveRows: (backup.row_counts ?? {})[t] ?? 0 })),
        notes: ['This is a legacy administrative-configuration backup. Its restore scope is municipalities, barangays and shelters only.'],
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  const { data: blob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
  if (dlErr || !blob) return new Response(JSON.stringify({ error: 'The archive could not be read.' }), { status: 500 });

  const opened = await openArchiveTables(new Uint8Array(await blob.arrayBuffer()));
  if ('error' in opened) return new Response(JSON.stringify({ error: opened.error }), { status: 409 });

  const { data: depRows, error: depErr } = await adminClient.rpc('list_table_dependencies');
  if (depErr) return new Response(JSON.stringify({ error: `Could not read the dependency graph: ${depErr.message}` }), { status: 500 });
  const deps = (depRows ?? []) as TableDependency[];

  const present = new Set(Object.keys(opened.tables));
  const { ordered, cycles } = topologicallyOrder(deps, present);

  const tables: {
    table: string;
    order: number;
    archiveRows: number;
    liveRows: number;
    wouldOverwrite: number;
    wouldInsert: number;
    primaryKey: string[];
  }[] = [];

  for (const [i, table] of ordered.entries()) {
    const rows = opened.tables[table] ?? [];
    const pk = deps.find((d) => d.table_name === table)?.pk_columns ?? [];
    const { count: liveCount } = await adminClient.from(table).select('*', { count: 'exact', head: true });

    // Overlap is computed by actually asking the target which of the
    // archive's primary keys already exist — capped so a huge table
    // cannot turn a preview into a long scan. Single-column PKs only;
    // a composite key is reported as unknown rather than guessed at.
    let wouldOverwrite = 0;
    if (pk.length === 1 && rows.length > 0) {
      const ids = rows
        .map((r) => (r as Record<string, unknown>)[pk[0]])
        .filter((v) => v !== null && v !== undefined)
        .slice(0, 1000);
      if (ids.length > 0) {
        const { count: hitCount } = await adminClient
          .from(table)
          .select(pk[0], { count: 'exact', head: true })
          .in(pk[0], ids as never[]);
        wouldOverwrite = hitCount ?? 0;
      }
    }

    tables.push({
      table,
      order: i + 1,
      archiveRows: rows.length,
      liveRows: liveCount ?? 0,
      wouldOverwrite,
      wouldInsert: Math.max(rows.length - wouldOverwrite, 0),
      primaryKey: pk,
    });
  }

  const excludedByPolicy = [...present].filter((t) => NEVER_RESTORED.has(t));
  const noPrimaryKey = ordered.filter((t) => (deps.find((d) => d.table_name === t)?.pk_columns ?? []).length === 0);

  await audit(adminClient, caller, 'RESTORE_PLAN_GENERATED', backupId, {
    backup_id: backupId,
    tables_planned: tables.length,
    excluded_by_policy: excludedByPolicy,
    fk_cycles: cycles,
  });

  return new Response(
    JSON.stringify({
      archiveFormat: 'zip',
      backupId,
      sourceEnvironment: backup.project_ref,
      targetEnvironment: (Deno.env.get('SUPABASE_URL') ?? '').split('//')[1]?.split('.')[0] ?? 'unknown',
      crossEnvironment: !!backup.project_ref && backup.project_ref !== ((Deno.env.get('SUPABASE_URL') ?? '').split('//')[1]?.split('.')[0] ?? ''),
      coverageComplete: backup.is_complete,
      isEncrypted: backup.is_encrypted,
      strategy: 'controlled_upsert',
      tables,
      excludedByPolicy: excludedByPolicy.map((t) => ({
        table: t,
        reason:
          t === 'user_profiles'
            ? 'Reverting roles or active status could reinstate access that was deliberately revoked. Recover individual accounts via Roles & Permissions instead.'
            : t === 'audit_logs'
              ? 'The audit trail must not be rewritten by a restore — doing so would erase the record of the incident being recovered from.'
              : 'Legal attestation tied to a specific person and time; an older snapshot could assert consent that was since withdrawn.',
      })),
      foreignKeyCycles: cycles,
      tablesWithoutPrimaryKey: noPrimaryKey,
      willNotDelete: true,
      notes: [
        'Restore is upsert-only. No row is ever deleted or truncated, so anything created after this backup is left untouched.',
        'Schema objects in the archive (database/schema/) are NOT executed. Schema recovery is a separate operator-reviewed procedure.',
        'Supabase Auth identities are NOT restored. Profile rows may be restored without their matching login existing — see authentication/RESTORATION-INSTRUCTIONS.md in the archive.',
        'wouldOverwrite is sampled over the first 1,000 primary keys per table; it is a measured lower bound, not a full-table count.',
      ],
    }),
    { headers: { 'content-type': 'application/json' } }
  );
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

  await audit(adminClient, caller, 'RESTORE_REQUESTED', operationId, { backup_id: backupId, outcome: 'in_progress' });
  await audit(adminClient, caller, 'RESTORE_VALIDATION_STARTED', operationId, { backup_id: backupId });

  const validation = await validateForRestore(adminClient, backup);

  if (!validation.valid) {
    await adminClient
      .from('system_restores')
      .update({ status: 'validation_failed', validation_result: validation.checklist, completed_at: new Date().toISOString() })
      .eq('operation_id', operationId);
    await audit(adminClient, caller, 'RESTORE_VALIDATION_FAILED', operationId, { backup_id: backupId, checklist: validation.checklist, outcome: 'failed' });
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
  await audit(adminClient, caller, 'RESTORE_CONFIRMED', operationId, { backup_id: op.backup_id, outcome: 'confirmed' });

  return new Response(JSON.stringify({ operationId, status: 'confirmed' }), { headers: { 'content-type': 'application/json' } });
}

async function handleExecute(
  adminClient: SupabaseClient,
  caller: Caller,
  operationId: string | undefined,
  restoreStorageConflictPolicy: 'skip' | 'overwrite' = 'skip'
): Promise<Response> {
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
  const revalidation = await validateForRestore(adminClient, backup);
  if (!revalidation.valid) {
    await failOperation(adminClient, caller, operationId, 'restore_failed', 'Backup failed re-validation immediately before restore.', revalidation.checklist);
    return new Response(
      JSON.stringify({ error: 'Restore cannot continue — the backup failed re-validation immediately before execution.', checklist: revalidation.checklist }),
      { status: 409 }
    );
  }

  // --- Pre-restore safety backup — mandatory, not optional. ---
  // The checkpoint must be able to undo what this restore is about to
  // do, so it is taken in the SAME format/scope as the archive being
  // applied. A .json.gz checkpoint (admin-reference only) could not roll
  // back a ZIP restore that touched case data — it would look like a
  // rollback plan while silently covering a fraction of the blast radius.
  const safetyResult =
    backup.archive_format === 'zip'
      ? await createZipBackupExport(adminClient, 'pre_restore', caller.profileId, (backup.storage_object_count ?? 0) > 0)
      : await createBackupExport(adminClient, 'pre_restore', caller.profileId);
  if (!safetyResult.ok) {
    await adminClient
      .from('system_restores')
      .update({ status: 'safety_backup_failed', completed_at: new Date().toISOString(), error_message: 'Pre-restore safety backup could not be created.' })
      .eq('operation_id', operationId);
    await audit(adminClient, caller, 'RESTORE_FAILED', operationId, { backup_id: claimed.backup_id, stage: 'pre_restore_backup', outcome: 'failed' });
    return new Response(
      JSON.stringify({ error: 'Pre-restore safety backup could not be created. Restore cannot safely continue.' }),
      { status: 500 }
    );
  }
  await adminClient.from('system_restores').update({ safety_backup_id: safetyResult.backupId }).eq('operation_id', operationId);
  await audit(adminClient, caller, 'PRE_RESTORE_BACKUP_CREATED', operationId, { backup_id: claimed.backup_id, safety_backup_id: safetyResult.backupId, outcome: 'completed' });

  // --- Apply the restore (upsert-only — see file header for why). ---
  await adminClient.from('system_restores').update({ status: 'restoring' }).eq('operation_id', operationId);
  await audit(adminClient, caller, 'RESTORE_STARTED', operationId, { backup_id: claimed.backup_id, outcome: 'in_progress' });

  let restoredCounts: Record<string, number> = {};
  const skippedTables: { table: string; reason: string }[] = [];
  try {
    const { data: fileBlob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
    if (dlErr || !fileBlob) throw new Error('Backup file could not be retrieved for restore.');
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());

    if (backup.archive_format === 'zip') {
      // --- ZIP (module42): dependency-ordered, upsert-only. ---
      const opened = await openArchiveTables(bytes);
      if ('error' in opened) throw new Error(opened.error);

      const { data: depRows, error: depErr } = await adminClient.rpc('list_table_dependencies');
      if (depErr) throw new Error(`Could not read the table dependency graph: ${depErr.message}`);
      const deps = (depRows ?? []) as TableDependency[];

      const present = new Set(Object.keys(opened.tables));
      const { ordered, cycles } = topologicallyOrder(deps, present);

      for (const t of cycles) skippedTables.push({ table: t, reason: 'foreign_key_cycle' });
      for (const t of present) {
        if (NEVER_RESTORED.has(t)) skippedTables.push({ table: t, reason: 'excluded_by_policy' });
      }

      for (const table of ordered) {
        const rows = opened.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) {
          restoredCounts[table] = 0;
          continue;
        }
        const pk = deps.find((d) => d.table_name === table)?.pk_columns ?? [];
        if (pk.length === 0) {
          // No primary key means no safe conflict target — an upsert
          // would duplicate rows on every restore. Skipped loudly.
          skippedTables.push({ table, reason: 'no_primary_key' });
          continue;
        }
        // Chunked so one large table cannot exceed the request body
        // limit or hold the whole payload in a single statement.
        const CHUNK = 500;
        let applied = 0;
        let tableError: string | null = null;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error: upsertErr } = await adminClient.from(table).upsert(slice, { onConflict: pk.join(',') });
          if (upsertErr) {
            tableError = `rows ${i}-${i + slice.length - 1}: ${upsertErr.message}`;
            break;
          }
          applied += slice.length;
        }

        if (tableError) {
          // A PER-TABLE failure no longer aborts the whole restore.
          //
          // Several tables carry BEFORE-UPDATE guard triggers that
          // raise their own authorization exceptions (observed:
          // expert_support_requests -> "Not authorized to update this
          // expert support request"). service_role bypasses RLS but it
          // does NOT bypass a trigger that calls raise, and the Edge
          // Function has no end-user JWT for those guards to inspect.
          //
          // Previously the first such table threw and killed the run,
          // so everything ordered after it was never attempted — one
          // guarded table made the entire restore unusable. Now the
          // table is recorded as skipped with its real error and the
          // remaining tables still restore.
          //
          // This is deliberately NOT silent: every skip is returned to
          // the caller, shown in the result screen, and persisted in
          // system_restores.restored_row_counts, and the operation can
          // never be reported as a full recovery while any skip exists.
          console.error(`[backup-restore] skipping ${table}: ${tableError}`);
          skippedTables.push({ table, reason: `blocked: ${tableError}` });
          if (applied > 0) restoredCounts[table] = applied;
          continue;
        }

        restoredCounts[table] = applied;
      }
    } else {
      // --- LEGACY (.json.gz, module16/23) — unchanged. ---
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
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backup-restore] execute failed:', message);
    await failOperation(adminClient, caller, operationId, 'restore_failed', message);
    return new Response(JSON.stringify({ error: 'Restore failed while applying data. See Recovery Activity for details.' }), { status: 500 });
  }

  // --- Storage objects — after tables, before verification. ---
  //
  // Deliberately AFTER the database: a restored evidence row pointing at
  // a file is recoverable (the file can be re-restored), whereas a
  // restored file with no owning row is an orphan nobody can find. Order
  // chosen so a partial failure leaves the recoverable shape.
  //
  // Conflict policy defaults to 'skip' — a restore must not clobber
  // evidence uploaded after the backup was taken unless asked to.
  let storageResult: Awaited<ReturnType<typeof restoreStorageObjects>> | null = null;
  let storageError: string | null = null;
  if (backup.archive_format === 'zip' && (backup.storage_object_count ?? 0) > 0) {
    try {
      const { data: blob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? 'archive could not be re-read for storage restore');
      storageResult = await restoreStorageObjects(adminClient, new Uint8Array(await blob.arrayBuffer()), {
        conflictPolicy: restoreStorageConflictPolicy,
      });
      await audit(adminClient, caller, 'RESTORE_STORAGE_APPLIED', operationId, {
        backup_id: claimed.backup_id,
        restored: storageResult.restored,
        overwritten: storageResult.overwritten,
        skipped_existing: storageResult.skippedExisting,
        checksum_failures: storageResult.checksumFailures.length,
        failures: storageResult.failures.length,
        verified: storageResult.verified,
      });
    } catch (e) {
      // A storage failure does NOT silently pass: it is recorded and
      // reported, and the operation cannot be called a full recovery.
      storageError = e instanceof Error ? e.message : String(e);
      console.error('[backup-restore] storage restore failed:', storageError);
      await audit(adminClient, caller, 'RESTORE_STORAGE_FAILED', operationId, {
        backup_id: claimed.backup_id,
        error_message: storageError.slice(0, 500),
      });
    }
  }

  await adminClient
    .from('system_restores')
    .update({
      restored_row_counts: {
        tables: restoredCounts,
        skipped: skippedTables,
        storage: storageResult
          ? {
              restored: storageResult.restored,
              overwritten: storageResult.overwritten,
              skipped_existing: storageResult.skippedExisting,
              checksum_failures: storageResult.checksumFailures,
              failures: storageResult.failures,
              missing_buckets: storageResult.missingBuckets,
              verified: storageResult.verified,
            }
          : storageError
            ? { error: storageError }
            : null,
      },
    })
    .eq('operation_id', operationId);
  await audit(adminClient, caller, 'RESTORE_COMPLETED', operationId, { backup_id: claimed.backup_id, restored_row_counts: restoredCounts, outcome: 'completed' });

  // --- Post-restore verification — read-only health checks only. ---
  await adminClient.from('system_restores').update({ status: 'verifying' }).eq('operation_id', operationId);
  await audit(adminClient, caller, 'RESTORE_VERIFICATION_STARTED', operationId, { backup_id: claimed.backup_id });

  const verification = await verifyRestoredSystem(adminClient);

  if (!verification.ok) {
    await adminClient
      .from('system_restores')
      .update({ status: 'verification_failed', verification_result: verification.checks, completed_at: new Date().toISOString() })
      .eq('operation_id', operationId);
    await audit(adminClient, caller, 'RESTORE_VERIFICATION_FAILED', operationId, { backup_id: claimed.backup_id, checks: verification.checks, outcome: 'failed' });
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
  await audit(adminClient, caller, 'RESTORE_VERIFIED', operationId, { backup_id: claimed.backup_id, checks: verification.checks, outcome: 'verified' });

  // "Verified" means the data was applied and the post-restore health
  // checks passed — NOT that the system is fully recovered. Anything
  // skipped, and the auth reconciliation that this process structurally
  // cannot perform, is returned alongside so the caller cannot present
  // this as a complete recovery.
  return new Response(
    JSON.stringify({
      operationId,
      status: 'verified',
      message: 'Restore applied and post-restore verification passed.',
      restoredCounts,
      skippedTables,
      storage: storageResult
        ? {
            restored: storageResult.restored,
            overwritten: storageResult.overwritten,
            skippedExisting: storageResult.skippedExisting,
            verified: storageResult.verified,
            checksumFailures: storageResult.checksumFailures.length,
            failures: storageResult.failures.length,
            missingBuckets: storageResult.missingBuckets,
            conflictPolicy: restoreStorageConflictPolicy,
          }
        : storageError
          ? { error: storageError }
          : null,
      // A clean database restore with failed storage is NOT a clean
      // restore. This flag is what the UI reads, so the two cannot be
      // conflated into one green tick.
      storageFullyRestored:
        storageResult === null && storageError === null
          ? null
          : !!storageResult &&
            storageResult.checksumFailures.length === 0 &&
            storageResult.failures.length === 0 &&
            storageError === null,
      checks: verification.checks,
      manualActionsRequired: [
        'Reconcile Supabase Auth identities against user_profiles — recreated accounts get new ids and cannot reuse old ones.',
        'Administrator accounts (user_profiles) were deliberately not restored; review Roles & Permissions if an account is missing.',
        'If schema objects were lost, recover them from the archive\'s database/schema/ reference material as a separate reviewed procedure.',
      ],
      isFullSystemRecovery: false,
    }),
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
  await audit(adminClient, caller, 'RESTORE_FAILED', operationId, { error: errorMessage.slice(0, 200), outcome: 'failed' });
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

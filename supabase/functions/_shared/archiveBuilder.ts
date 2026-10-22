// supabase/functions/_shared/archiveBuilder.ts
//
// Module 42 — the versioned ZIP archive builder. Like backupCore.ts this
// has NO top-level serve(...) and no side effects, for the exact reason
// documented there (importing an index.ts re-registered its request
// handler and silently hijacked another function's routing).
//
// WHAT THIS PRODUCES
// A single .zip laid out per the governing spec, with a manifest, a
// per-member SHA-256 list, and — critically — a COVERAGE REPORT that
// names every data source that was NOT fully captured, with a reason.
// "The job finished" and "the archive holds everything" are reported as
// two different facts (status vs is_complete).
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM
//
// 1. Edge Function source is NOT in the archive. A Deno isolate can read
//    files from its OWN deployment, but each Supabase Edge Function is a
//    separate deployment — backup-create genuinely cannot read
//    backup-restore's, safeher-chatbot's, or any other function's source
//    at run time. There is no supported platform API to fetch another
//    function's source either. It is therefore reported as
//    `unsupported_by_platform`, with the honest recovery source named:
//    git. Writing a hardcoded copy of each function's source into this
//    file would be a lie that rots on the first edit.
//
// 2. Migration .sql files are NOT in the archive, for the same reason —
//    they live in the repository, not in the database or in this
//    function's deployment. The DATABASE's actual current schema IS
//    captured (via export_schema_ddl()), which is the thing a restore
//    would need to compare against; the migration history is git's job.
//
// 3. Supabase Auth is PARTIALLY captured. listUsers() gives identifiers,
//    emails, timestamps and metadata — enough to reconcile profile rows
//    against identities. Password hashes, MFA factors, identities and
//    sessions are not exposed by the supported Admin API and are NOT in
//    the archive. Restoring profile rows does not restore an auth user;
//    see the authentication/ folder's own instructions in the archive.
//
// 4. Secret-bearing tables are excluded by the DATABASE's own
//    list_backup_tables() (module42), not by a list kept here — so the
//    exclusion cannot drift away from the discovery that feeds it.
//    private.app_config's VALUES are never read; only its key names.
//
// 5. There is a hard size budget. If a table would push the archive past
//    it, that WHOLE table is excluded with reason size_budget_exceeded —
//    never silently truncated mid-table, because a half-exported table
//    looks restorable and is not. Exceeding the budget sets
//    is_complete=false.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

// Bump when the LAYOUT of the archive changes (a folder renamed, a
// manifest field's meaning changed). Independent of backupCore's
// SCHEMA_VERSION, which tracks the shape of the exported DATA.
export const ARCHIVE_FORMAT_VERSION = '2.0';
export const ARCHIVE_FORMAT = 'zip';

// Per-table page size for chunked reads — keeps one table's working set
// bounded regardless of how many rows it has.
const PAGE_SIZE = 1000;

// Default budget for total uncompressed member bytes held in memory.
// Deliberately conservative: a Supabase Edge Function isolate has a
// low-hundreds-of-MB ceiling and must also hold the compressed output.
// Override with BACKUP_SIZE_BUDGET_MB.
const DEFAULT_BUDGET_MB = 64;

export type ExclusionReason =
  | 'secret_bearing'
  | 'backup_catalog'
  | 'size_budget_exceeded'
  | 'unsupported_by_platform'
  | 'inaccessible'
  | 'not_in_selected_scope';

export interface CoverageEntry {
  source: string;
  category: 'database' | 'storage' | 'schema' | 'configuration' | 'authentication' | 'edge_functions' | 'migrations';
  status: 'included' | 'partial' | 'excluded';
  rows?: number;
  objects?: number;
  bytes?: number;
  reason?: ExclusionReason;
  note?: string;
}

export interface ArchiveResult {
  bytes: Uint8Array;
  /** SHA-256 over `bytes` exactly as they will be stored. */
  storedChecksum: string;
  manifestChecksum: string;
  coverage: CoverageEntry[];
  excluded: CoverageEntry[];
  isComplete: boolean;
  tableCount: number;
  storageObjectCount: number;
  isEncrypted: boolean;
  encryptionAlgorithm: string | null;
  fileName: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function budgetBytes(): number {
  const raw = Number(Deno.env.get('BACKUP_SIZE_BUDGET_MB'));
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MB;
  return Math.floor(mb * 1024 * 1024);
}

/**
 * Reads one table in bounded pages. Returns null (rather than throwing)
 * when the table is unreadable, so one inaccessible source degrades
 * coverage honestly instead of failing the whole backup.
 */
async function readTablePaged(
  adminClient: SupabaseClient,
  table: string
): Promise<{ rows: unknown[] } | { error: string }> {
  const rows: unknown[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await adminClient.from(table).select('*').range(offset, offset + PAGE_SIZE - 1);
    if (error) return { error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    // Defensive ceiling: a runaway loop on a table that keeps returning
    // full pages would otherwise exhaust the isolate.
    if (offset > 2_000_000) return { error: 'exceeded 2,000,000 row safety ceiling' };
  }
  return { rows };
}

/**
 * Builds the archive. `scope` selects Phase 1 (database + schema +
 * configuration + auth inventory) or Phase 2 (additionally storage
 * binaries), matching the staged rollout this module was authorized for.
 */
export async function buildArchive(
  adminClient: SupabaseClient,
  opts: {
    backupId: string;
    backupType: 'manual' | 'scheduled' | 'pre_restore';
    projectRef: string;
    schemaVersion: string;
    includeStorageBinaries: boolean;
    initiatedBy: string | null;
  }
): Promise<ArchiveResult> {
  const startedAt = new Date();
  const budget = budgetBytes();
  let used = 0;

  const files: Record<string, Uint8Array> = {};
  const coverage: CoverageEntry[] = [];
  const memberChecksums: { path: string; sha256: string; bytes: number }[] = [];

  // Headroom held back from the data budget so the manifest, coverage
  // report, checksums and README can ALWAYS be written. Without this, a
  // table that happens to fill the budget exactly would push the
  // metadata out, and the archive would then fail its own validation
  // with "manifest.json is missing" — reporting corruption for what is
  // really just a full budget.
  const METADATA_RESERVE = 2 * 1024 * 1024;

  // Adds a member, enforcing the budget. Returns false when refused, so
  // the caller can record an honest size_budget_exceeded exclusion.
  // `essential` members draw on the reserve; bulk data does not.
  const addFile = (path: string, content: Uint8Array | string, essential = false): boolean => {
    const bytes = typeof content === 'string' ? strToU8(content) : content;
    const ceiling = essential ? budget : budget - METADATA_RESERVE;
    if (used + bytes.byteLength > ceiling) return false;
    files[path] = bytes;
    used += bytes.byteLength;
    return true;
  };

  // ---- database/data -----------------------------------------------
  // Table list comes from the DATABASE (module42's list_backup_tables),
  // so a table added by a later migration is discovered, never missed.
  const { data: discovered, error: discoverErr } = await adminClient.rpc('list_backup_tables');
  if (discoverErr) {
    throw new Error(`Could not enumerate tables for backup: ${discoverErr.message}. ` + 'Is module42 applied to this project?');
  }
  const tables = (discovered ?? []) as {
    table_name: string;
    in_scope: boolean;
    exclusion_reason: string | null;
    estimated_rows: number;
  }[];

  let tableCount = 0;
  for (const t of tables) {
    if (!t.in_scope) {
      coverage.push({
        source: `public.${t.table_name}`,
        category: 'database',
        status: 'excluded',
        reason: (t.exclusion_reason as ExclusionReason) ?? 'not_in_selected_scope',
        note:
          t.exclusion_reason === 'secret_bearing'
            ? 'Holds credential verifiers or live tokens. Exporting it would put an offline cracking target inside a downloadable archive.'
            : t.exclusion_reason === 'backup_catalog'
              ? 'The backup/restore catalog itself. Restoring it would overwrite the true history of backups with a stale snapshot.'
              : undefined,
      });
      continue;
    }

    const result = await readTablePaged(adminClient, t.table_name);
    if ('error' in result) {
      coverage.push({
        source: `public.${t.table_name}`,
        category: 'database',
        status: 'excluded',
        reason: 'inaccessible',
        note: result.error,
      });
      continue;
    }

    const body = JSON.stringify({ table: t.table_name, row_count: result.rows.length, rows: result.rows });
    if (!addFile(`database/data/${t.table_name}.json`, body)) {
      coverage.push({
        source: `public.${t.table_name}`,
        category: 'database',
        status: 'excluded',
        reason: 'size_budget_exceeded',
        rows: result.rows.length,
        note: `Table read successfully (${result.rows.length} rows) but omitted whole rather than truncated, because a partially exported table appears restorable and is not. Raise BACKUP_SIZE_BUDGET_MB or move to the external worker.`,
      });
      continue;
    }
    tableCount += 1;
    coverage.push({ source: `public.${t.table_name}`, category: 'database', status: 'included', rows: result.rows.length });
  }

  // ---- database/schema ----------------------------------------------
  const { data: ddl, error: ddlErr } = await adminClient.rpc('export_schema_ddl');
  if (ddlErr) {
    coverage.push({ source: 'database schema/policies/functions/triggers', category: 'schema', status: 'excluded', reason: 'inaccessible', note: ddlErr.message });
  } else {
    const d = ddl as Record<string, unknown>;
    const written =
      addFile('database/schema/columns.json', JSON.stringify(d.columns ?? [])) &&
      addFile('database/schema/constraints.json', JSON.stringify(d.constraints ?? [])) &&
      addFile('database/schema/indexes.json', JSON.stringify(d.indexes ?? [])) &&
      addFile('database/schema/functions.json', JSON.stringify(d.functions ?? [])) &&
      addFile('database/schema/triggers.json', JSON.stringify(d.triggers ?? [])) &&
      addFile('database/schema/policies.json', JSON.stringify(d.policies ?? [])) &&
      addFile('database/schema/rls-enabled.json', JSON.stringify(d.rls_enabled ?? [])) &&
      addFile('database/schema/enums.json', JSON.stringify(d.enums ?? [])) &&
      addFile('database/schema/views.json', JSON.stringify(d.views ?? [])) &&
      addFile('database/schema/extensions.json', JSON.stringify(d.extensions ?? []));
    coverage.push({
      source: 'database schema/policies/functions/triggers',
      category: 'schema',
      status: written ? 'included' : 'excluded',
      reason: written ? undefined : 'size_budget_exceeded',
      note: written
        ? 'Catalog-sourced definitions for comparison and operator-reviewed reconstruction. Restore never executes these automatically — see README.txt.'
        : undefined,
    });
  }

  // Migration files live in git, not in the database or this deployment.
  coverage.push({
    source: 'supabase/*.sql migration files',
    category: 'migrations',
    status: 'excluded',
    reason: 'unsupported_by_platform',
    note: 'Migration scripts are repository artifacts; an Edge Function cannot read them. Recover them from version control. The database\'s ACTUAL current schema is captured under database/schema/.',
  });

  // ---- configuration -------------------------------------------------
  // storage.buckets is readable by service_role. Nothing secret here —
  // bucket names, public flags, size/MIME limits.
  const { data: buckets, error: bucketErr } = await adminClient.storage.listBuckets();
  if (bucketErr) {
    coverage.push({ source: 'storage bucket configuration', category: 'configuration', status: 'excluded', reason: 'inaccessible', note: bucketErr.message });
  } else {
    addFile(
      'configuration/storage-config.json',
      JSON.stringify(
        (buckets ?? []).map((b) => ({ id: b.id, name: b.name, public: b.public, created_at: b.created_at })),
        null,
        2
      )
    );
    coverage.push({ source: 'storage bucket configuration', category: 'configuration', status: 'included', objects: (buckets ?? []).length });
  }

  // Secret NAMES only — never values. Reading private.app_config's
  // values would place live dispatch secrets inside a downloadable
  // archive, which §4D forbids outright.
  addFile(
    'configuration/application-config.json',
    JSON.stringify(
      {
        note: 'Names and descriptions only. No secret VALUES are captured anywhere in this archive, by design.',
        required_edge_function_secrets: [
          { name: 'SUPABASE_URL', description: 'Injected automatically by the platform.' },
          { name: 'SUPABASE_SERVICE_ROLE_KEY', description: 'Injected automatically by the platform. Never leaves the server.' },
          { name: 'BACKUP_DISPATCH_SECRET', description: 'Shared secret pg_cron presents to backup-create for unattended runs (module16).' },
          { name: 'BACKUP_ENCRYPTION_KEY', description: 'base64 32-byte AES-256-GCM key for archive encryption (module42). MUST be escrowed outside Supabase — see README.txt.' },
          { name: 'PUSH_DISPATCH_SECRET', description: 'Shared secret for send-push-notification (module8).' },
        ],
        required_private_app_config_keys: [
          { key: 'backup_dispatch_url', description: 'Full URL of the backup-create function.' },
          { key: 'backup_dispatch_secret', description: 'Must match BACKUP_DISPATCH_SECRET. Value intentionally not captured.' },
          { key: 'push_dispatch_url', description: 'Full URL of send-push-notification.' },
          { key: 'push_dispatch_secret', description: 'Must match PUSH_DISPATCH_SECRET. Value intentionally not captured.' },
        ],
        edge_functions_expected: [
          'backup-create',
          'backup-restore',
          'backup-auth',
          'create-admin-user',
          'admin-user-metadata',
          'safeher-chatbot',
          'security-passcode',
          'send-push-notification',
        ],
      },
      null,
      2
    )
  );
  coverage.push({
    source: 'application configuration (names/metadata only)',
    category: 'configuration',
    status: 'included',
    note: 'Secret values deliberately absent. Re-enter them via `supabase secrets set` and private.app_config during recovery.',
  });

  // Scheduled jobs — the real cron.job rows, via a service-role read.
  const { data: cronJobs, error: cronErr } = await adminClient.rpc('list_backup_cron_jobs');
  if (cronErr) {
    coverage.push({
      source: 'scheduled jobs (pg_cron)',
      category: 'configuration',
      status: 'excluded',
      reason: 'inaccessible',
      note: `${cronErr.message} — if module42 is applied, confirm list_backup_cron_jobs() exists.`,
    });
  } else {
    addFile('configuration/scheduled-jobs.json', JSON.stringify(cronJobs ?? [], null, 2));
    coverage.push({ source: 'scheduled jobs (pg_cron)', category: 'configuration', status: 'included', objects: (cronJobs as unknown[] ?? []).length });
  }

  // Edge Function source — genuinely not obtainable here.
  coverage.push({
    source: 'Edge Function source code',
    category: 'edge_functions',
    status: 'excluded',
    reason: 'unsupported_by_platform',
    note: 'Each function is a separate deployment; a running isolate cannot read another function\'s source, and no supported API exposes it. configuration/application-config.json records the expected function inventory so a missing deployment is detectable. Source itself must come from version control.',
  });

  // ---- authentication -------------------------------------------------
  const authResult = await exportAuthInventory(adminClient);
  if (authResult.error) {
    coverage.push({ source: 'Supabase Auth identities', category: 'authentication', status: 'excluded', reason: 'inaccessible', note: authResult.error });
  } else {
    addFile('authentication/auth-users-inventory.json', JSON.stringify(authResult.users, null, 2));
    coverage.push({
      source: 'Supabase Auth identities',
      category: 'authentication',
      status: 'partial',
      objects: authResult.users.length,
      note: 'Identifiers, emails, timestamps and metadata only. Password hashes, MFA factors, linked identities and sessions are NOT exportable through the supported Admin API and are NOT here. Restoring user_profiles rows does NOT restore an auth identity.',
    });
  }
  addFile('authentication/RESTORATION-INSTRUCTIONS.md', AUTH_INSTRUCTIONS);

  // ---- storage binaries --------------------------------------------
  //
  // Buckets are DISCOVERED at run time from the same listBuckets() call
  // used for storage-config above — not from a hardcoded list, so a
  // bucket added by a future module is captured or explicitly reported
  // rather than silently missed. `system-backups` is excluded because
  // an archive must not contain the archive store itself.
  let storageObjectCount = 0;
  const allStorageRecords: StorageObjectRecord[] = [];
  const contentBuckets = (buckets ?? []).map((b) => b.id).filter((id) => id !== 'system-backups');

  if (bucketErr) {
    coverage.push({
      source: 'storage buckets (all)',
      category: 'storage',
      status: 'excluded',
      reason: 'inaccessible',
      note: `Buckets could not be enumerated, so NO storage object was captured and none can be listed as missing: ${bucketErr.message}`,
    });
  } else if (opts.includeStorageBinaries) {
    for (const bucket of contentBuckets) {
      const { records, listFailures } = await copyBucketObjects(adminClient, bucket, addFile);
      allStorageRecords.push(...records);

      const captured = records.filter((r) => r.captured);
      const missed = records.filter((r) => !r.captured);
      storageObjectCount += captured.length;

      // A failed LIST means an unknown number of objects were never even
      // enumerated — that can never be reported as a complete bucket,
      // regardless of how many objects were captured elsewhere in it.
      const subtreeLost = listFailures.length > 0;
      const status: CoverageEntry['status'] =
        subtreeLost || (missed.length > 0 && captured.length > 0)
          ? 'partial'
          : captured.length === 0 && (missed.length > 0 || subtreeLost)
            ? 'excluded'
            : 'included';

      coverage.push({
        source: `storage bucket: ${bucket}`,
        category: 'storage',
        status,
        objects: captured.length,
        bytes: captured.reduce((sum, r) => sum + r.bytes, 0),
        reason: subtreeLost
          ? 'inaccessible'
          : missed.length > 0
            ? (missed[0].reason ?? 'size_budget_exceeded')
            : undefined,
        note:
          [
            missed.length > 0 ? `${missed.length} object(s) not captured (each listed in storage/_manifest.json).` : '',
            subtreeLost
              ? `${listFailures.length} prefix(es) could not be listed, so an unknown number of objects were never enumerated: ${listFailures
                  .map((f) => f.prefix)
                  .slice(0, 3)
                  .join(', ')}.`
              : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined,
      });
    }

    // The per-object manifest: path, size, checksum, and the reason for
    // every object NOT captured. This is what makes "we skipped files"
    // an auditable list rather than a count.
    addFile(
      'storage/_manifest.json',
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          buckets: contentBuckets,
          total_attempted: allStorageRecords.length,
          total_captured: allStorageRecords.filter((r) => r.captured).length,
          total_not_captured: allStorageRecords.filter((r) => !r.captured).length,
          objects: allStorageRecords,
        },
        null,
        2
      ),
      true
    );
  } else {
    for (const bucket of contentBuckets) {
      coverage.push({
        source: `storage bucket: ${bucket}`,
        category: 'storage',
        status: 'excluded',
        reason: 'not_in_selected_scope',
        note: 'Storage binaries were not requested for this backup. Create a backup with storage objects included to capture them.',
      });
    }
  }

  // ---- metadata, manifest, checksums ----------------------------------
  const excluded = coverage.filter((c) => c.status === 'excluded');
  const partial = coverage.filter((c) => c.status === 'partial');
  const isComplete = excluded.every((e) => e.reason === 'secret_bearing' || e.reason === 'backup_catalog') && partial.length === 0;

  addFile(
    'metadata/backup-info.json',
    JSON.stringify(
      {
        backup_id: opts.backupId,
        backup_type: opts.backupType,
        created_at_utc: startedAt.toISOString(),
        source_environment: opts.projectRef,
        archive_format: ARCHIVE_FORMAT,
        archive_format_version: ARCHIVE_FORMAT_VERSION,
        data_schema_version: opts.schemaVersion,
        initiated_by_profile_id: opts.initiatedBy,
        size_budget_mb: Math.floor(budget / 1024 / 1024),
      },
      null,
      2
    ),
    true
  );
  addFile('metadata/coverage-report.json', JSON.stringify({ is_complete: isComplete, entries: coverage }, null, 2), true);
  addFile('metadata/schema-version.json', JSON.stringify({ data_schema_version: opts.schemaVersion, archive_format_version: ARCHIVE_FORMAT_VERSION }, null, 2), true);
  addFile(
    'metadata/compatibility.json',
    JSON.stringify(
      {
        source_project_ref: opts.projectRef,
        restorable_into: 'A project whose data_schema_version and archive_format_version match, after a compatibility assessment.',
        notes: [
          'Cross-environment restore requires explicit environment selection and a compatibility assessment.',
          'Schema objects under database/schema/ are reference material; restore does not execute them automatically.',
          'Auth identities are reconciled, never restored — see authentication/RESTORATION-INSTRUCTIONS.md.',
        ],
      },
      null,
      2
    ),
    true
  );
  addFile(
    'audit/backup-operation-summary.json',
    JSON.stringify(
      {
        backup_id: opts.backupId,
        initiated_by_profile_id: opts.initiatedBy,
        backup_type: opts.backupType,
        started_at_utc: startedAt.toISOString(),
        finished_at_utc: new Date().toISOString(),
        sources_included: coverage.filter((c) => c.status === 'included').length,
        sources_partial: partial.length,
        sources_excluded: excluded.length,
      },
      null,
      2
    ),
    true
  );

  // Per-member checksums, computed over exactly what is being zipped.
  for (const [path, bytes] of Object.entries(files)) {
    memberChecksums.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength });
  }
  const checksumFile = memberChecksums.map((m) => `${m.sha256}  ${m.path}`).join('\n') + '\n';
  files['checksums.sha256'] = strToU8(checksumFile);

  const manifest = {
    archive_format: ARCHIVE_FORMAT,
    archive_format_version: ARCHIVE_FORMAT_VERSION,
    data_schema_version: opts.schemaVersion,
    backup_id: opts.backupId,
    created_at_utc: startedAt.toISOString(),
    source_environment: opts.projectRef,
    is_complete: isComplete,
    table_count: tableCount,
    storage_object_count: storageObjectCount,
    members: memberChecksums.map((m) => ({
      path: m.path,
      bytes: m.bytes,
      sha256: m.sha256,
      category: m.path.split('/')[0],
      restorable: isMemberRestorable(m.path),
    })),
    coverage_summary: {
      included: coverage.filter((c) => c.status === 'included').map((c) => c.source),
      partial: partial.map((c) => ({ source: c.source, note: c.note })),
      excluded: excluded.map((c) => ({ source: c.source, reason: c.reason })),
    },
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  files['manifest.json'] = strToU8(manifestJson);
  const manifestChecksum = await sha256Hex(files['manifest.json']);
  files['README.txt'] = strToU8(readmeText(opts, isComplete, excluded, partial));

  // fflate's zipSync: deterministic, no streaming needed at these sizes,
  // and the budget above is what keeps this inside the isolate.
  let archiveBytes = zipSync(files, { level: 6 });

  // ---- encryption — MANDATORY, fail closed -----------------------------
  //
  // Every archive this function produces contains case, survivor,
  // evidence-reference and auth-inventory data, so encryption is not
  // optional and there is no "unencrypted is fine for this one" path.
  // resolveEncryptionKey() throws rather than returning null, and that
  // throw is deliberately NOT caught here — it propagates to
  // createZipBackupExport's catch, which marks the backup row 'failed'
  // with the reason and notifies the technical admins. A failed backup
  // is a recoverable operational problem; a silently-plaintext archive
  // of abuse-case records is not.
  const rawKey = resolveEncryptionKey();
  archiveBytes = await encryptAesGcm(archiveBytes, rawKey);
  const isEncrypted = true;
  const encryptionAlgorithm = 'AES-256-GCM';

  // Checksum of the bytes AS STORED, so storage-level corruption is
  // detectable without needing the decryption key.
  const storedChecksum = await sha256Hex(archiveBytes);

  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const shortId = opts.backupId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const prefix = opts.backupType === 'pre_restore' ? 'SafeSpace_PreRestoreBackup' : 'SafeSpace_Backup';
  const fileName = `${prefix}_${stamp}_${shortId}.zip${isEncrypted ? '.enc' : ''}`;

  return {
    bytes: archiveBytes,
    storedChecksum,
    manifestChecksum,
    coverage,
    excluded,
    isComplete,
    tableCount,
    storageObjectCount,
    isEncrypted,
    encryptionAlgorithm,
    fileName,
  };
}

// Members that a restore can actually apply, vs reference material.
function isMemberRestorable(path: string): boolean {
  return path.startsWith('database/data/');
}

async function exportAuthInventory(
  adminClient: SupabaseClient
): Promise<{ users: unknown[]; error?: string }> {
  try {
    const users: unknown[] = [];
    let page = 1;
    for (;;) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return { users: [], error: error.message };
      const batch = data?.users ?? [];
      for (const u of batch) {
        // Explicitly projected. Never spread the whole user object —
        // that risks carrying a future credential-adjacent field into
        // the archive silently.
        users.push({
          id: u.id,
          email: u.email,
          phone: u.phone,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          app_metadata: u.app_metadata,
          user_metadata: u.user_metadata,
        });
      }
      if (batch.length < 200) break;
      page += 1;
      if (page > 200) break; // 40k users ceiling; honest bound
    }
    return { users };
  } catch (e) {
    return { users: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** One row per storage object the archive attempted to capture. */
export interface StorageObjectRecord {
  bucket: string;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
  lastModified: string | null;
  captured: boolean;
  reason?: ExclusionReason;
  detail?: string;
}

const STORAGE_PAGE_SIZE = 100;

/**
 * Walks one bucket and packages real file BYTES (not just object
 * metadata), producing a per-object record with size and SHA-256 for
 * every object it attempted — captured or not.
 *
 * Differences from the first implementation, each a real defect it had:
 *  * PAGINATION. It passed `{ limit: 1000 }` and read one page, so any
 *    prefix with more than 1000 entries silently lost the remainder and
 *    reported nothing wrong. This pages with limit+offset until a short
 *    page arrives.
 *  * PER-OBJECT ACCOUNTING. It returned only counts, so an object
 *    skipped for being unreadable was indistinguishable from one
 *    skipped for budget, and neither was named. Every object now gets a
 *    record with its own reason.
 *  * CHECKSUMS. Restore had no way to verify a recovered file's bytes.
 *  * It conflated a failed LIST (a whole subtree lost) with one failed
 *    object by incrementing the same counter.
 *
 * Objects are not deduplicated by name: two different prefixes may hold
 * the same basename legitimately, and the full path is what is stored.
 */
async function copyBucketObjects(
  adminClient: SupabaseClient,
  bucket: string,
  addFile: (path: string, content: Uint8Array | string, essential?: boolean) => boolean
): Promise<{ records: StorageObjectRecord[]; listFailures: { prefix: string; detail: string }[] }> {
  const records: StorageObjectRecord[] = [];
  const listFailures: { prefix: string; detail: string }[] = [];
  const visited = new Set<string>();

  const walk = async (prefix: string): Promise<void> => {
    // Guards against a cyclic/self-referential prefix returned by a
    // misbehaving listing, which would otherwise recurse forever.
    if (visited.has(prefix)) return;
    visited.add(prefix);

    let offset = 0;
    for (;;) {
      const { data, error } = await adminClient.storage
        .from(bucket)
        .list(prefix, { limit: STORAGE_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) {
        // A failed LIST loses a whole subtree — recorded distinctly from
        // a single unreadable object, because the blast radius differs.
        listFailures.push({ prefix: prefix || '(root)', detail: error.message });
        return;
      }

      const page = data ?? [];
      for (const entry of page) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;

        // Supabase lists a "folder" as an entry with no id/metadata.
        if (!entry.id) {
          await walk(full);
          continue;
        }

        const { data: blob, error: dlErr } = await adminClient.storage.from(bucket).download(full);
        if (dlErr || !blob) {
          records.push({
            bucket,
            path: full,
            bytes: typeof entry.metadata?.size === 'number' ? entry.metadata.size : 0,
            sha256: '',
            contentType: (entry.metadata?.mimetype as string | undefined) ?? null,
            lastModified: entry.updated_at ?? null,
            captured: false,
            reason: 'inaccessible',
            detail: dlErr?.message ?? 'download returned no body',
          });
          continue;
        }

        const content = new Uint8Array(await blob.arrayBuffer());
        const digest = await sha256Hex(content);

        // Original relative path preserved under storage/<bucket>/.
        if (!addFile(`storage/${bucket}/${full}`, content)) {
          records.push({
            bucket,
            path: full,
            bytes: content.byteLength,
            sha256: digest,
            contentType: (entry.metadata?.mimetype as string | undefined) ?? null,
            lastModified: entry.updated_at ?? null,
            captured: false,
            reason: 'size_budget_exceeded',
            detail: 'Object read successfully but would exceed the archive size budget.',
          });
          continue;
        }

        records.push({
          bucket,
          path: full,
          bytes: content.byteLength,
          sha256: digest,
          contentType: (entry.metadata?.mimetype as string | undefined) ?? null,
          lastModified: entry.updated_at ?? null,
          captured: true,
        });
      }

      if (page.length < STORAGE_PAGE_SIZE) break;
      offset += STORAGE_PAGE_SIZE;
    }
  };

  await walk('');
  return { records, listFailures };
}

/** Thrown when the archive cannot be encrypted. Distinct type so callers can refuse to proceed rather than degrade. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

/**
 * Resolves and validates the archive encryption key, FAILING CLOSED.
 *
 * This is the single place the key is read. It never returns a
 * partially-validated key and never returns null to mean "skip
 * encryption" — a missing or malformed key is an error, not a
 * downgrade. The previous implementation did `if (keyB64) { encrypt }`,
 * which silently produced a PLAINTEXT archive of survivor and case data
 * whenever the secret was absent, misconfigured, or removed. That is
 * the exact failure mode this function exists to prevent.
 *
 * Error messages deliberately describe only the SHAPE of the problem
 * (missing / not base64 / wrong length) and never echo the value, a
 * prefix of it, or its length in characters.
 */
export function resolveEncryptionKey(): Uint8Array {
  const raw = Deno.env.get('BACKUP_ENCRYPTION_KEY');
  if (raw === undefined || raw === null || raw.trim() === '') {
    throw new EncryptionKeyError(
      'BACKUP_ENCRYPTION_KEY is not configured. Refusing to create a backup, because writing an unencrypted archive of case and survivor data is not an acceptable fallback. Set the secret (see module42 operator setup) and retry.'
    );
  }

  // Trimmed because a key pasted or piped into `supabase secrets set`
  // very commonly carries a trailing newline; without this, a correct
  // 32-byte key fails length validation for a reason nobody can see.
  const candidate = raw.trim();

  // Strict base64 shape check BEFORE atob, so a malformed value gives a
  // precise diagnosis instead of a bare InvalidCharacterError.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(candidate) || candidate.length % 4 !== 0) {
    throw new EncryptionKeyError(
      'BACKUP_ENCRYPTION_KEY is not valid base64. Generate it with `openssl rand -base64 32` and set it verbatim, with no quotes or line breaks.'
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(candidate), (c) => c.charCodeAt(0));
  } catch {
    throw new EncryptionKeyError('BACKUP_ENCRYPTION_KEY could not be base64-decoded.');
  }

  if (bytes.byteLength !== 32) {
    throw new EncryptionKeyError(
      `BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM, but decoded to ${bytes.byteLength}. Generate it with \`openssl rand -base64 32\`.`
    );
  }

  // An all-zero key is a real misconfiguration (e.g. base64 of 32 NUL
  // bytes from an empty buffer) and must not be accepted as valid.
  if (bytes.every((b) => b === 0)) {
    throw new EncryptionKeyError('BACKUP_ENCRYPTION_KEY decoded to 32 zero bytes, which is not a usable key.');
  }

  return bytes;
}

async function encryptAesGcm(plaintext: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

  // Layout: magic(8) | version(1) | iv(12) | ciphertext+tag
  // The magic/version prefix is what lets validation recognise an
  // encrypted archive and fail with "key required" instead of
  // "corrupt ZIP", which would be a misleading diagnosis.
  const magic = strToU8('SSBKENC1');
  const out = new Uint8Array(magic.byteLength + 1 + iv.byteLength + ct.byteLength);
  out.set(magic, 0);
  out[magic.byteLength] = 1;
  out.set(iv, magic.byteLength + 1);
  out.set(ct, magic.byteLength + 1 + iv.byteLength);
  return out;
}

export function isEncryptedArchive(bytes: Uint8Array): boolean {
  const magic = strToU8('SSBKENC1');
  if (bytes.byteLength < magic.byteLength + 13) return false;
  for (let i = 0; i < magic.byteLength; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

/**
 * Decrypts a stored archive, verifying the AES-GCM authentication tag
 * BEFORE any plaintext is returned.
 *
 * WebCrypto's decrypt() verifies the GCM tag as part of the operation
 * and throws if it does not match, so there is no code path here that
 * can hand back unauthenticated plaintext — a tampered ciphertext, a
 * tampered tag, a tampered IV, or a wrong key all reject. That is the
 * property the caller relies on; nothing downstream re-checks it.
 *
 * Key resolution goes through resolveEncryptionKey(), so a malformed
 * key is reported as a KEY problem rather than being conflated with
 * "this archive is corrupt" — a misdiagnosis that would send an
 * operator hunting for storage corruption during a recovery.
 */
export async function decryptAesGcm(stored: Uint8Array): Promise<Uint8Array> {
  const MAGIC_LEN = 8;
  const IV_LEN = 12;
  const HEADER_LEN = MAGIC_LEN + 1 + IV_LEN;

  // GCM output is ciphertext + a 16-byte tag, so anything at or below
  // header+16 cannot contain even an empty authenticated payload.
  if (stored.byteLength <= HEADER_LEN + 16) {
    throw new Error('Encrypted archive is truncated — it is too short to contain a complete authenticated payload.');
  }

  const version = stored[MAGIC_LEN];
  if (version !== 1) {
    throw new Error(`Unsupported encrypted archive version ${version}. This system understands version 1.`);
  }

  // Throws EncryptionKeyError on a missing/malformed key — propagated
  // unchanged so the caller can tell the two failure classes apart.
  const rawKey = resolveEncryptionKey();

  const iv = stored.slice(MAGIC_LEN + 1, HEADER_LEN);
  const ct = stored.slice(HEADER_LEN);
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);

  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(pt);
  } catch {
    // Intentionally one message for all authentication failures: the
    // key being wrong and the ciphertext being altered are not
    // distinguishable by design (that indistinguishability is what
    // stops an attacker using error text as an oracle), and saying
    // which it was would be a guess presented as a fact.
    throw new Error(
      'Archive authentication failed. Either the configured key is not the one this archive was encrypted with, or the stored bytes have been altered. The archive has NOT been decrypted and its contents must not be trusted.'
    );
  }
}

// =====================================================================
// Archive validation — inspects real CONTENTS, not the filename.
//
// A valid ZIP is not a restorable backup, so this returns BOTH a
// structural verdict and a separate restore-readiness verdict, and the
// caller must not collapse them into one "valid" boolean.
// =====================================================================

export interface ArchiveCheck {
  label: string;
  passed: boolean;
  blocking: boolean;
  detail?: string;
}

export interface ArchiveValidation {
  archiveIntact: boolean;
  restoreReady: boolean;
  checks: ArchiveCheck[];
  manifest: Record<string, unknown> | null;
  coverageComplete: boolean | null;
  warnings: string[];
}

// Rejects absolute paths, drive letters, traversal segments, and
// backslash-separated paths that a naive extractor would resolve outside
// the destination directory.
export function isUnsafeArchivePath(path: string): boolean {
  if (!path) return true;
  if (path.startsWith('/') || path.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(path)) return true;
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').some((seg) => seg === '..');
}

export async function validateArchiveBytes(
  stored: Uint8Array,
  expected: { storedChecksum?: string | null; schemaVersion: string; projectRef: string }
): Promise<ArchiveValidation> {
  const checks: ArchiveCheck[] = [];
  const warnings: string[] = [];
  const pass = (label: string, detail?: string, blocking = true) => checks.push({ label, passed: true, blocking, detail });
  const fail = (label: string, detail?: string, blocking = true) => checks.push({ label, passed: false, blocking, detail });
  const done = (manifest: Record<string, unknown> | null = null, coverageComplete: boolean | null = null): ArchiveValidation => ({
    archiveIntact: checks.filter((c) => c.blocking).every((c) => c.passed),
    restoreReady: checks.every((c) => c.passed) && coverageComplete === true,
    checks,
    manifest,
    coverageComplete,
    warnings,
  });

  // --- stored-byte integrity (works without the decryption key) ------
  if (expected.storedChecksum) {
    const actual = await sha256Hex(stored);
    if (actual !== expected.storedChecksum) {
      fail('Stored file matches its recorded SHA-256', 'The object in storage differs from the checksum recorded at backup time.');
      return done();
    }
    pass('Stored file matches its recorded SHA-256');
  } else {
    fail('Stored file matches its recorded SHA-256', 'No checksum was recorded for this backup.');
  }

  // --- decrypt if needed ---------------------------------------------
  let zipBytes = stored;
  if (isEncryptedArchive(stored)) {
    try {
      zipBytes = await decryptAesGcm(stored);
      pass('Archive decrypted and AES-256-GCM authentication tag verified');
    } catch (e) {
      // A key problem and a data problem are reported as different
      // findings. Collapsing them would send an operator to investigate
      // storage corruption when the real cause is an unset secret.
      const isKeyProblem = e instanceof EncryptionKeyError;
      fail(
        isKeyProblem ? 'Decryption key is configured and usable' : 'Archive decrypted and authentication tag verified',
        e instanceof Error ? e.message : String(e)
      );
      return done();
    }
  } else {
    // A legacy unencrypted archive is reported as exactly that — never
    // as "encrypted" and never as "fully protected". This is a blocking
    // failure for a NEW archive (encryption is mandatory now) but must
    // stay non-blocking for pre-module42 archives, which legitimately
    // predate the requirement and are still the only recovery source
    // for that period.
    fail(
      'Archive is encrypted',
      'LEGACY UNENCRYPTED ARCHIVE. This file predates mandatory encryption. It is readable by anyone who obtains it and is not protected at rest. Treat it as sensitive material, and replace it with a freshly created encrypted backup.',
      false
    );
    warnings.push(
      'Legacy unencrypted archive: contents are in plaintext. Not classified as protected. Create a new backup to obtain an encrypted copy.'
    );
  }

  // --- open and enumerate --------------------------------------------
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
    pass('Archive opens and can be enumerated');
  } catch {
    fail('Archive opens and can be enumerated', 'The file is not a readable ZIP archive.');
    return done();
  }

  const paths = Object.keys(entries);
  const unsafe = paths.filter(isUnsafeArchivePath);
  if (unsafe.length > 0) {
    fail('All member paths are safe to extract', `Unsafe path(s): ${unsafe.slice(0, 5).join(', ')}`);
    return done();
  }
  pass('All member paths are safe to extract');

  // --- manifest -------------------------------------------------------
  if (!entries['manifest.json']) {
    fail('manifest.json is present');
    return done();
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
    pass('manifest.json is present and parseable');
  } catch {
    fail('manifest.json is present and parseable', 'manifest.json is not valid JSON.');
    return done();
  }

  // --- format/version compatibility -----------------------------------
  if (manifest.archive_format !== ARCHIVE_FORMAT) {
    fail('Archive format supported', `Found '${String(manifest.archive_format)}', expected '${ARCHIVE_FORMAT}'.`);
  } else {
    pass('Archive format supported');
  }
  if (manifest.archive_format_version !== ARCHIVE_FORMAT_VERSION) {
    fail('Archive layout version supported', `Archive is v${String(manifest.archive_format_version)}, this system understands v${ARCHIVE_FORMAT_VERSION}.`);
  } else {
    pass('Archive layout version supported');
  }
  if (manifest.data_schema_version !== expected.schemaVersion) {
    fail('Data schema version compatible', `Archive data is v${String(manifest.data_schema_version)}, current is v${expected.schemaVersion}.`);
  } else {
    pass('Data schema version compatible');
  }
  if (manifest.source_environment && manifest.source_environment !== expected.projectRef) {
    // Non-blocking: a cross-environment restore is legitimate, but only
    // deliberately and with an explicit environment selection.
    fail(
      'Archive originates from this environment',
      `Archive came from '${String(manifest.source_environment)}', this project is '${expected.projectRef}'. A cross-environment restore requires explicit confirmation.`,
      false
    );
  } else {
    pass('Archive originates from this environment');
  }

  // --- declared members all exist, and their checksums match ----------
  const members = Array.isArray(manifest.members) ? (manifest.members as { path: string; sha256: string; bytes: number }[]) : [];
  if (members.length === 0) {
    fail('Manifest declares at least one member');
    return done(manifest);
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  const truncated: string[] = [];
  for (const m of members) {
    const content = entries[m.path];
    if (!content) {
      missing.push(m.path);
      continue;
    }
    if (content.byteLength !== m.bytes) truncated.push(`${m.path} (${content.byteLength} vs ${m.bytes} bytes)`);
    const digest = await sha256Hex(content);
    if (digest !== m.sha256) mismatched.push(m.path);
  }

  if (missing.length > 0) fail('Every member declared in the manifest exists', `Missing: ${missing.slice(0, 5).join(', ')}`);
  else pass('Every member declared in the manifest exists');

  if (truncated.length > 0) fail('No member is truncated', truncated.slice(0, 5).join('; '));
  else pass('No member is truncated');

  if (mismatched.length > 0) fail('Every member matches its SHA-256', `Mismatched: ${mismatched.slice(0, 5).join(', ')}`);
  else pass('Every member matches its SHA-256');

  // --- checksums.sha256 cross-check -----------------------------------
  if (entries['checksums.sha256']) {
    pass('checksums.sha256 is present', undefined, false);
  } else {
    fail('checksums.sha256 is present', 'The standalone checksum list is missing.', false);
  }

  // --- data files are structurally valid -------------------------------
  const dataFiles = paths.filter((p) => p.startsWith('database/data/') && p.endsWith('.json'));
  if (dataFiles.length === 0) {
    fail('Archive contains at least one restorable table export');
  } else {
    const badData: string[] = [];
    for (const p of dataFiles) {
      try {
        const parsed = JSON.parse(strFromU8(entries[p]));
        if (!Array.isArray(parsed?.rows) || typeof parsed?.row_count !== 'number' || parsed.rows.length !== parsed.row_count) {
          badData.push(p);
        }
      } catch {
        badData.push(p);
      }
    }
    if (badData.length > 0) fail('Every table export is readable and self-consistent', `Problem files: ${badData.slice(0, 5).join(', ')}`);
    else pass(`Every table export is readable and self-consistent (${dataFiles.length} table${dataFiles.length === 1 ? '' : 's'})`);
  }

  // --- required metadata ------------------------------------------------
  for (const required of ['metadata/backup-info.json', 'metadata/coverage-report.json', 'README.txt']) {
    if (entries[required]) pass(`${required} is present`, undefined, false);
    else fail(`${required} is present`, undefined, false);
  }

  // --- coverage ---------------------------------------------------------
  let coverageComplete: boolean | null = null;
  if (entries['metadata/coverage-report.json']) {
    try {
      const report = JSON.parse(strFromU8(entries['metadata/coverage-report.json']));
      coverageComplete = report?.is_complete === true;
      const notCaptured = (report?.entries ?? []).filter(
        (e: CoverageEntry) => e.status !== 'included' && e.reason !== 'secret_bearing' && e.reason !== 'backup_catalog'
      );
      for (const e of notCaptured) warnings.push(`${e.source}: ${e.status}${e.reason ? ` (${e.reason})` : ''}`);
      if (coverageComplete) pass('Coverage report declares a complete archive');
      else
        fail(
          'Coverage report declares a complete archive',
          `${notCaptured.length} data source(s) were not fully captured. This archive can be restored, but it does not contain everything.`,
          false
        );
    } catch {
      fail('Coverage report is parseable', undefined, false);
    }
  }

  return done(manifest, coverageComplete);
}

/**
 * Opens a stored archive and returns the table exports a restore can
 * actually apply. Decrypts when needed. Deliberately returns an error
 * string rather than throwing, so the restore state machine can record
 * a precise failure reason instead of a stack trace.
 *
 * Only `database/data/*.json` members are surfaced. Schema, config and
 * auth members are intentionally NOT returned here — nothing in the
 * restore path should be able to execute them by accident.
 */
export async function openArchiveTables(
  stored: Uint8Array
): Promise<{ tables: Record<string, unknown[]>; manifest: Record<string, unknown> | null } | { error: string }> {
  let zipBytes = stored;
  if (isEncryptedArchive(stored)) {
    try {
      zipBytes = await decryptAesGcm(stored);
    } catch (e) {
      // Surfaced verbatim: these messages already distinguish a key
      // misconfiguration from an authentication failure, and a restore
      // operator needs that distinction to act.
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    return { error: 'The archive is not a readable ZIP.' };
  }

  const unsafe = Object.keys(entries).filter(isUnsafeArchivePath);
  if (unsafe.length > 0) return { error: `Archive contains unsafe member path(s): ${unsafe.slice(0, 3).join(', ')}` };

  let manifest: Record<string, unknown> | null = null;
  if (entries['manifest.json']) {
    try {
      manifest = JSON.parse(strFromU8(entries['manifest.json']));
    } catch {
      return { error: 'manifest.json is not valid JSON.' };
    }
  }

  const tables: Record<string, unknown[]> = {};
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith('database/data/') || !path.endsWith('.json')) continue;
    const name = path.slice('database/data/'.length, -'.json'.length);
    try {
      const parsed = JSON.parse(strFromU8(bytes));
      if (!Array.isArray(parsed?.rows)) return { error: `${path} does not contain a rows array.` };
      if (parsed.rows.length !== parsed.row_count) {
        return { error: `${path} is internally inconsistent (row_count ${parsed.row_count} vs ${parsed.rows.length} rows).` };
      }
      tables[name] = parsed.rows;
    } catch {
      return { error: `${path} could not be parsed.` };
    }
  }

  return { tables, manifest };
}

/**
 * Restores storage objects from an archive into their original buckets
 * and paths, verifying each file's bytes against the checksum recorded
 * at backup time.
 *
 * CONFLICT POLICY is explicit and defaults to the non-destructive
 * option — §3's "do not overwrite existing objects without an explicit
 * conflict policy":
 *   'skip'      (default) leave an existing object untouched, report it
 *   'overwrite' replace it (upsert), report it as replaced
 * There is deliberately no "merge" or silent-overwrite mode.
 *
 * Buckets are never created and never have their visibility changed. If
 * a target bucket does not exist the objects are reported as failed
 * rather than being written into a newly-invented public bucket — the
 * privacy of `evidence` and `identity-documents` depends on the bucket's
 * existing configuration, which a restore must not author.
 */
export async function restoreStorageObjects(
  adminClient: SupabaseClient,
  stored: Uint8Array,
  options: { conflictPolicy: 'skip' | 'overwrite' }
): Promise<{
  restored: number;
  skippedExisting: number;
  overwritten: number;
  checksumFailures: { bucket: string; path: string; expected: string; actual: string }[];
  failures: { bucket: string; path: string; detail: string }[];
  missingBuckets: string[];
  verified: number;
}> {
  const result = {
    restored: 0,
    skippedExisting: 0,
    overwritten: 0,
    checksumFailures: [] as { bucket: string; path: string; expected: string; actual: string }[],
    failures: [] as { bucket: string; path: string; detail: string }[],
    missingBuckets: [] as string[],
    verified: 0,
  };

  let zipBytes = stored;
  if (isEncryptedArchive(stored)) {
    zipBytes = await decryptAesGcm(stored);
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error('The archive is not a readable ZIP.');
  }

  const unsafe = Object.keys(entries).filter(isUnsafeArchivePath);
  if (unsafe.length > 0) {
    throw new Error(`Archive contains unsafe member path(s), refusing to extract: ${unsafe.slice(0, 3).join(', ')}`);
  }

  // The manifest is the authority on expected checksums. Without it a
  // restore could write bytes it cannot verify, so that is refused
  // rather than performed unverified.
  if (!entries['storage/_manifest.json']) {
    return result; // nothing to do: archive carries no storage objects
  }
  let manifest: { objects?: StorageObjectRecord[] };
  try {
    manifest = JSON.parse(strFromU8(entries['storage/_manifest.json']));
  } catch {
    throw new Error('storage/_manifest.json is unreadable; storage objects cannot be verified and will not be restored.');
  }
  const expected = new Map<string, StorageObjectRecord>();
  for (const rec of manifest.objects ?? []) {
    if (rec.captured) expected.set(`storage/${rec.bucket}/${rec.path}`, rec);
  }

  const { data: liveBuckets } = await adminClient.storage.listBuckets();
  const existingBucketIds = new Set((liveBuckets ?? []).map((b) => b.id));

  for (const [member, bytes] of Object.entries(entries)) {
    if (!member.startsWith('storage/') || member === 'storage/_manifest.json') continue;

    const rec = expected.get(member);
    const rest = member.slice('storage/'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue;
    const bucket = rest.slice(0, slash);
    const objectPath = rest.slice(slash + 1);

    if (!existingBucketIds.has(bucket)) {
      if (!result.missingBuckets.includes(bucket)) result.missingBuckets.push(bucket);
      result.failures.push({
        bucket,
        path: objectPath,
        detail: 'Target bucket does not exist. Not created automatically — bucket privacy settings must be configured deliberately, not by a restore.',
      });
      continue;
    }

    // Verify the archived bytes BEFORE writing them anywhere.
    if (rec?.sha256) {
      const actual = await sha256Hex(bytes);
      if (actual !== rec.sha256) {
        result.checksumFailures.push({ bucket, path: objectPath, expected: rec.sha256, actual });
        continue; // never write bytes that failed verification
      }
      result.verified += 1;
    }

    // Conflict detection: list the exact object by name within its
    // prefix. `download` would also reveal existence but transfers the
    // whole body for no reason.
    const lastSlash = objectPath.lastIndexOf('/');
    const parent = lastSlash === -1 ? '' : objectPath.slice(0, lastSlash);
    const basename = lastSlash === -1 ? objectPath : objectPath.slice(lastSlash + 1);
    const { data: siblings } = await adminClient.storage.from(bucket).list(parent, { limit: 100, search: basename });
    const alreadyExists = (siblings ?? []).some((s) => s.name === basename && !!s.id);

    if (alreadyExists && options.conflictPolicy === 'skip') {
      result.skippedExisting += 1;
      continue;
    }

    const { error: upErr } = await adminClient.storage.from(bucket).upload(objectPath, bytes, {
      contentType: rec?.contentType ?? 'application/octet-stream',
      upsert: options.conflictPolicy === 'overwrite',
    });
    if (upErr) {
      result.failures.push({ bucket, path: objectPath, detail: upErr.message });
      continue;
    }

    if (alreadyExists) result.overwritten += 1;
    else result.restored += 1;
  }

  return result;
}

const AUTH_INSTRUCTIONS = `# Restoring authentication — read this before assuming users are recoverable

## What this archive contains
\`auth-users-inventory.json\` — one entry per Supabase Auth user, with:
id, email, phone, created_at, last_sign_in_at, email_confirmed_at,
app_metadata, user_metadata.

## What it does NOT contain, and cannot
* password hashes
* MFA / TOTP factors and their secrets
* linked OAuth identities
* active sessions or refresh tokens
* password-recovery tokens

These are not exposed by the supported Supabase Admin API. They were not
omitted by oversight — there is no supported way to export them from a
hosted project, and exporting them would in any case put a credential
database inside a downloadable file.

## Therefore
Restoring \`database/data/user_profiles.json\` does **NOT** restore login
ability. A \`user_profiles\` row whose \`auth_user_id\` points at an auth
user that no longer exists is an orphan: the person cannot sign in, and
the admin portal will not resolve their profile.

## Recovery procedure (manual, operator-reviewed)
1. Compare \`auth-users-inventory.json\` against the target project's
   current users (\`auth.admin.listUsers()\`).
2. For each missing user, create the account fresh (Admin API
   \`createUser\`, or the project's own create-admin-user function so
   role/jurisdiction metadata is set the way the app expects).
3. The new account will have a NEW \`id\`. Update the corresponding
   \`user_profiles.auth_user_id\` to that new value — do not assume the
   old id can be reused.
4. Require a password reset for every recreated account. Do not attempt
   to transplant a hash.
5. Re-enrol MFA per user. It cannot be migrated.
6. Reconcile before declaring success: every non-orphan profile row
   should resolve to exactly one auth user, and every intended
   administrator should be able to sign in.

Until steps 1-6 are done and checked, the restore is NOT complete,
regardless of what the database row counts say.
`;

function readmeText(
  opts: { backupId: string; backupType: string; projectRef: string },
  isComplete: boolean,
  excluded: CoverageEntry[],
  partial: CoverageEntry[]
): string {
  return `SafeSpace backup archive
========================

Backup ID        : ${opts.backupId}
Type             : ${opts.backupType}
Source project   : ${opts.projectRef}
Archive format   : ${ARCHIVE_FORMAT} v${ARCHIVE_FORMAT_VERSION}
Complete archive : ${isComplete ? 'YES — every in-scope source captured in full' : 'NO — see metadata/coverage-report.json'}

READ THIS FIRST
---------------
This archive is NOT a full copy of the live SafeSpace system, and a
valid ZIP is not the same thing as a restorable backup. Verify
metadata/coverage-report.json before relying on it for recovery.

What IS here
------------
  database/data/        One JSON file per in-scope table, with row counts.
                        These are the only members a restore applies.
  database/schema/      The database's ACTUAL current schema, pulled from
                        the catalog: columns, constraints, indexes,
                        functions, triggers, RLS policies, enums, views,
                        extensions. Reference material for comparison and
                        operator-reviewed reconstruction. The restore
                        process does NOT execute these automatically —
                        ordering 40+ interdependent modules' objects
                        correctly is an operator procedure, not a button.
  configuration/        Bucket config, cron jobs, and the NAMES of
                        required secrets. No secret VALUES, anywhere.
  authentication/       Auth user inventory + the manual reconciliation
                        procedure. Read RESTORATION-INSTRUCTIONS.md.
  metadata/             Format versions, compatibility notes, and the
                        coverage report.
  manifest.json         Every member, its size, its SHA-256, and whether
                        a restore can apply it.
  checksums.sha256      Standard sha256sum-format list of every member.

What is NOT here
----------------
${excluded.map((e) => `  - ${e.source}  [${e.reason}]`).join('\n') || '  (nothing excluded)'}

Partially captured
------------------
${partial.map((p) => `  - ${p.source}`).join('\n') || '  (nothing partial)'}

Encryption and the key
----------------------
If this file ends in .enc it is AES-256-GCM encrypted and is NOT a
readable ZIP until decrypted. Layout: magic "SSBKENC1" (8 bytes),
version (1 byte), IV (12 bytes), then ciphertext+tag.

The key is NOT in this archive and NOT in the database — deliberately,
since storing it alongside the data it protects would defeat the point.
It lives in the BACKUP_ENCRYPTION_KEY Edge Function secret and MUST also
be escrowed outside Supabase. If the project is lost and the key was only
ever held there, every encrypted archive becomes permanently unreadable.

Verifying this archive
----------------------
  sha256sum -c checksums.sha256      # after decrypting, from the archive root

Restoring
---------
Use the admin portal's guided restore (Backup & Restore -> Restore). It
validates, previews the plan, takes a verified pre-restore checkpoint,
requires the dedicated authorization password and a typed confirmation
phrase, and verifies afterwards. Do not hand database/data/*.json to a
bulk import tool directly — it bypasses every one of those safeguards.
`;
}

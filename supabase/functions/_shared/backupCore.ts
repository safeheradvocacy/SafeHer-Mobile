// supabase/functions/_shared/backupCore.ts
//
// The real export + validation logic, shared between backup-create and
// backup-restore. Deliberately has NO top-level serve(...) call and no
// side effects — importing this module must never start an HTTP
// listener. (It originally lived inside backup-create/index.ts; moved
// here after discovering that backup-restore importing
// backup-create/index.ts directly also re-ran backup-create's own
// serve(...) registration as a side effect, which silently hijacked
// backup-restore's request handling — every request was being answered
// by backup-create's action dispatcher instead of backup-restore's.)

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  buildArchive,
  validateArchiveBytes,
  type ArchiveValidation,
} from './archiveBuilder.ts';

// Administrative/reference data ONLY — never survivors, case_reports,
// case_*, user_verifications, case_access_tokens/case_client_links,
// audit_logs, notifications, or saved_reports.
export const EXPORT_TABLES = ['municipalities', 'barangays', 'shelters'] as const;

// Bump this ONLY when the shape of the exported payload actually
// changes (a table added/removed from EXPORT_TABLES, the administrators
// projection's column list changing, etc.) — it is what lets
// backup-restore mark an older backup INCOMPATIBLE instead of silently
// attempting to apply a payload shape the current restore logic was
// never written to understand.
export const SCHEMA_VERSION = '1.0';

export function projectRefFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return url;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export async function pruneExpired(adminClient: SupabaseClient) {
  const { data: expired } = await adminClient
    .from('system_backups')
    .select('backup_id, storage_path')
    .eq('status', 'completed')
    .lt('expires_at', new Date().toISOString());
  if (!expired || expired.length === 0) return;

  // A backup that was ever used in a restore operation (module23) —
  // either as the backup being restored, or as the pre-restore safety
  // backup created for one — has genuine audit/recovery significance
  // and is excluded from automatic pruning regardless of its normal
  // retention window. This isn't just a policy choice: system_restores
  // is a foreign key against system_backups, so deleting a still-
  // referenced row would fail at the database level anyway — this
  // check is what keeps that from happening as an unchecked, silently
  // swallowed error (which would otherwise remove the storage FILE
  // successfully, then fail the row delete, leaving a dangling catalog
  // row pointing at a file that no longer exists).
  const { data: referenced } = await adminClient
    .from('system_restores')
    .select('backup_id, safety_backup_id')
    .or(
      `backup_id.in.(${expired.map((r) => r.backup_id).join(',')}),safety_backup_id.in.(${expired.map((r) => r.backup_id).join(',')})`
    );
  const protectedIds = new Set((referenced ?? []).flatMap((r) => [r.backup_id, r.safety_backup_id]).filter(Boolean));

  for (const row of expired) {
    if (protectedIds.has(row.backup_id)) continue;

    if (row.storage_path) {
      await adminClient.storage.from('system-backups').remove([row.storage_path]);
    }
    // Real retention enforcement — the row and the file are both
    // actually removed server-side, not just hidden by a frontend
    // filter. The generic audit_row_change trigger (module3) still
    // captures this DELETE in audit_logs. Error checked (not awaited
    // and ignored) specifically because of the dangling-row failure
    // mode above — if this somehow still fails, the storage remove
    // above already ran, so logging loudly here is what prevents that
    // from going unnoticed again.
    const { error: deleteErr } = await adminClient.from('system_backups').delete().eq('backup_id', row.backup_id);
    if (deleteErr) console.error(`[backupCore] pruneExpired: failed to delete backup row ${row.backup_id}:`, deleteErr.message);
  }
}

export interface BackupExportResult {
  ok: boolean;
  backupId: string;
  status: 'completed' | 'failed';
  sizeBytes?: number;
  durationMs?: number;
  rowCounts?: Record<string, number>;
  error?: string;
}

// The one real export routine — inserts the running row, exports
// EXPORT_TABLES + administrator accounts, gzips, checksums, uploads,
// marks completed/failed, audits, and (on failure) notifies technical
// admins. Called by backup-create's handleCreate for manual/scheduled
// runs, AND by backup-restore for the mandatory pre-restore safety
// backup — the EXACT same code path, not a second, divergent copy of
// it. `backupType` is the only thing that changes what gets recorded.
export async function createBackupExport(
  adminClient: SupabaseClient,
  backupType: 'manual' | 'scheduled' | 'pre_restore',
  callerProfileId: string | null
): Promise<BackupExportResult> {
  const startedAt = Date.now();

  const { data: scheduleRow } = await adminClient
    .from('backup_schedule')
    .select('retention_days')
    .eq('schedule_id', '00000000-0000-0000-0000-000000000001')
    .single();
  const retentionDays = scheduleRow?.retention_days ?? 30;

  const { data: backupRow, error: insertErr } = await adminClient
    .from('system_backups')
    .insert({
      backup_type: backupType,
      status: 'running',
      initiated_by: callerProfileId,
      retention_days: retentionDays,
    })
    .select()
    .single();
  if (insertErr || !backupRow) {
    return { ok: false, backupId: '', status: 'failed', error: insertErr?.message ?? 'Could not start backup' };
  }

  try {
    const rowCounts: Record<string, number> = {};
    const payload: Record<string, unknown[]> = {};

    for (const table of EXPORT_TABLES) {
      const { data, error } = await adminClient.from(table).select('*');
      if (error) throw new Error(`Failed to export ${table}: ${error.message}`);
      payload[table] = data ?? [];
      rowCounts[table] = data?.length ?? 0;
    }

    // Administrator accounts only — role <> 'survivor' — never survivor
    // profile rows.
    const { data: admins, error: adminErr } = await adminClient
      .from('user_profiles')
      .select('profile_id, municipality_id, barangay_id, shelter_id, role, first_name, last_name, phone_number, is_active, created_at, updated_at')
      .neq('role', 'survivor');
    if (adminErr) throw new Error(`Failed to export administrators: ${adminErr.message}`);
    payload.administrators = admins ?? [];
    rowCounts.administrators = admins?.length ?? 0;

    const json = JSON.stringify({ exported_at: new Date().toISOString(), tables: payload });
    const gzipped = await gzip(json);
    // Computed over the exact bytes actually stored — this is what lets
    // a later validate/restore detect even a single flipped byte of
    // storage-level corruption, which the row-count check below cannot:
    // a corrupted file can still happen to decompress to JSON with the
    // right array lengths.
    const checksum = await sha256Hex(gzipped);

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    const prefix = backupType === 'pre_restore' ? 'SafeSpace_PreRestoreBackup_' : 'SafeSpace_Backup_';
    const storagePath = `${prefix}${timestamp}.json.gz`;

    const { error: uploadErr } = await adminClient.storage
      .from('system-backups')
      .upload(storagePath, gzipped, { contentType: 'application/gzip' });
    if (uploadErr) throw new Error(`Failed to store backup: ${uploadErr.message}`);

    const durationMs = Date.now() - startedAt;
    const expiresAt = new Date(Date.now() + retentionDays * 86_400_000).toISOString();

    await adminClient
      .from('system_backups')
      .update({
        status: 'completed',
        storage_path: storagePath,
        size_bytes: gzipped.byteLength,
        row_counts: rowCounts,
        completed_at: new Date().toISOString(),
        expires_at: expiresAt,
        checksum_sha256: checksum,
        // A safety backup is created and consumed within the same
        // restore operation, seconds apart — validating it against
        // itself adds no real assurance, so it's recorded as already
        // verified rather than needing a human to separately click
        // Validate on a backup that only exists because of this restore.
        verification_status: backupType === 'pre_restore' ? 'verified' : 'unverified',
        verified_at: backupType === 'pre_restore' ? new Date().toISOString() : null,
        schema_version: SCHEMA_VERSION,
        project_ref: projectRefFromUrl(Deno.env.get('SUPABASE_URL') ?? ''),
      })
      .eq('backup_id', backupRow.backup_id);

    await adminClient.from('audit_logs').insert({
      profile_id: callerProfileId,
      action: 'BACKUP_CREATED',
      table_name: 'system_backups',
      record_id: backupRow.backup_id,
      new_values: { backup_type: backupType, status: 'completed', size_bytes: gzipped.byteLength, duration_ms: durationMs, row_counts: rowCounts },
    });

    if (backupType !== 'pre_restore') await pruneExpired(adminClient);

    return { ok: true, backupId: backupRow.backup_id, status: 'completed', sizeBytes: gzipped.byteLength, durationMs, rowCounts };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backupCore] export failed:', message);
    await adminClient
      .from('system_backups')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: message.slice(0, 500) })
      .eq('backup_id', backupRow.backup_id);

    await adminClient.from('audit_logs').insert({
      profile_id: callerProfileId,
      action: 'BACKUP_FAILED',
      table_name: 'system_backups',
      record_id: backupRow.backup_id,
      new_values: { backup_type: backupType, status: 'failed', error_message: message.slice(0, 500) },
    });

    // Real, non-fabricated notification — sent only because a real
    // failure occurred, per module16's added 'System' notification_type.
    const { data: techAdmins } = await adminClient
      .from('user_profiles')
      .select('profile_id')
      .in('role', ['provincial_admin', 'super_admin'])
      .eq('is_active', true);
    for (const admin of techAdmins ?? []) {
      await adminClient.from('notifications').insert({
        profile_id: admin.profile_id,
        notification_type: 'System',
        title: backupType === 'pre_restore' ? 'Pre-Restore Safety Backup Failed' : 'Backup Failed',
        message: `The ${backupType} system backup failed: ${message.slice(0, 200)}`,
        is_read: false,
      });
    }

    return { ok: false, backupId: backupRow.backup_id, status: 'failed', error: message };
  }
}

// =====================================================================
// Module 42 — the ZIP export path.
//
// Deliberately a SEPARATE function from createBackupExport above rather
// than a rewrite of it: module16/23 backups already in the bucket are
// .json.gz and must stay readable/validatable/restorable exactly as they
// are. Which path a backup took is recorded in system_backups.
// archive_format, so nothing has to be inferred from a filename.
// =====================================================================
export async function createZipBackupExport(
  adminClient: SupabaseClient,
  backupType: 'manual' | 'scheduled' | 'pre_restore',
  callerProfileId: string | null,
  includeStorageBinaries: boolean,
  /**
   * module43 — for a scheduled run, the backup row already claimed by
   * claim_scheduled_backup_occurrence(). Passing it makes this function
   * REUSE that row instead of inserting another, which is what keeps the
   * duplicate-occurrence guard meaningful: if this inserted its own row
   * the claimed one would be orphaned in 'running' forever.
   */
  existingBackupId?: string
): Promise<BackupExportResult & { isComplete?: boolean; coverage?: unknown }> {
  const startedAt = Date.now();

  const { data: scheduleRow } = await adminClient
    .from('backup_schedule')
    .select('retention_days')
    .eq('schedule_id', '00000000-0000-0000-0000-000000000001')
    .single();
  const retentionDays = scheduleRow?.retention_days ?? 30;

  // Resolved to a definite id before anything else runs, so the catch
  // block below (which must always be able to mark the row 'failed')
  // never has to deal with a nullable binding.
  let resolvedBackupId: string;
  if (existingBackupId) {
    resolvedBackupId = existingBackupId;
    // The claimed row was created by the RPC without an initiator (cron
    // has no human caller); stamp the retention actually in force.
    await adminClient
      .from('system_backups')
      .update({ initiated_by: callerProfileId, retention_days: retentionDays })
      .eq('backup_id', existingBackupId);
  } else {
    const { data: inserted, error: insertErr } = await adminClient
      .from('system_backups')
      .insert({ backup_type: backupType, status: 'running', initiated_by: callerProfileId, retention_days: retentionDays })
      .select('backup_id')
      .single();
    if (insertErr || !inserted) {
      return { ok: false, backupId: '', status: 'failed', error: insertErr?.message ?? 'Could not start backup' };
    }
    resolvedBackupId = inserted.backup_id;
  }
  const backupRow = { backup_id: resolvedBackupId };

  const projectRef = projectRefFromUrl(Deno.env.get('SUPABASE_URL') ?? '');

  try {
    const archive = await buildArchive(adminClient, {
      backupId: backupRow.backup_id,
      backupType,
      projectRef,
      schemaVersion: SCHEMA_VERSION,
      includeStorageBinaries,
      initiatedBy: callerProfileId,
    });

    const { error: uploadErr } = await adminClient.storage
      .from('system-backups')
      .upload(archive.fileName, archive.bytes, {
        contentType: archive.isEncrypted ? 'application/octet-stream' : 'application/zip',
      });
    if (uploadErr) throw new Error(`Failed to store backup archive: ${uploadErr.message}`);

    // Read the object back and re-digest it before declaring success —
    // this is what catches a truncated or partially-written upload.
    // Without it, "upload returned no error" would be the only evidence
    // the bytes actually landed intact.
    const { data: verifyBlob, error: verifyErr } = await adminClient.storage.from('system-backups').download(archive.fileName);
    if (verifyErr || !verifyBlob) throw new Error(`Stored archive could not be read back for verification: ${verifyErr?.message ?? 'unknown error'}`);
    const storedBack = await sha256Hex(new Uint8Array(await verifyBlob.arrayBuffer()));
    if (storedBack !== archive.storedChecksum) {
      throw new Error('Stored archive failed read-back verification — the uploaded bytes do not match what was generated (incomplete or corrupt upload).');
    }

    const rowCounts: Record<string, number> = {};
    for (const entry of archive.coverage) {
      if (entry.category === 'database' && entry.status === 'included' && typeof entry.rows === 'number') {
        rowCounts[entry.source.replace(/^public\./, '')] = entry.rows;
      }
    }

    const durationMs = Date.now() - startedAt;
    await adminClient
      .from('system_backups')
      .update({
        status: 'completed',
        storage_path: archive.fileName,
        size_bytes: archive.bytes.byteLength,
        row_counts: rowCounts,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + retentionDays * 86_400_000).toISOString(),
        checksum_sha256: archive.storedChecksum,
        manifest_sha256: archive.manifestChecksum,
        archive_format: ARCHIVE_FORMAT,
        format_version: ARCHIVE_FORMAT_VERSION,
        coverage: archive.coverage,
        excluded: archive.excluded,
        table_count: archive.tableCount,
        storage_object_count: archive.storageObjectCount,
        is_encrypted: archive.isEncrypted,
        encryption_algorithm: archive.encryptionAlgorithm,
        is_complete: archive.isComplete,
        // A fresh archive has been read back and digest-matched, but it
        // has NOT had its internal manifest/member checksums walked yet
        // — that is what the Validate action does. Marking it 'verified'
        // here would claim a check that has not run. The pre_restore
        // exception from module16 is kept for the same reason stated
        // there (created and consumed seconds apart inside one restore).
        verification_status: backupType === 'pre_restore' ? 'verified' : 'unverified',
        verified_at: backupType === 'pre_restore' ? new Date().toISOString() : null,
        schema_version: SCHEMA_VERSION,
        project_ref: projectRef,
      })
      .eq('backup_id', backupRow.backup_id);

    await adminClient.from('audit_logs').insert({
      profile_id: callerProfileId,
      action: archive.isComplete ? 'BACKUP_CREATED' : 'BACKUP_CREATED_INCOMPLETE',
      table_name: 'system_backups',
      record_id: backupRow.backup_id,
      new_values: {
        backup_type: backupType,
        archive_format: ARCHIVE_FORMAT,
        size_bytes: archive.bytes.byteLength,
        duration_ms: durationMs,
        table_count: archive.tableCount,
        storage_object_count: archive.storageObjectCount,
        is_complete: archive.isComplete,
        encrypted: archive.isEncrypted,
        excluded: archive.excluded.map((e) => ({ source: e.source, reason: e.reason })),
      },
    });

    // An incomplete archive is a real operational problem even though
    // the run itself finished — the technical admins are told, per §7.
    if (!archive.isComplete && backupType !== 'pre_restore') {
      await notifyTechnicalAdmins(
        adminClient,
        'Backup Completed With Incomplete Coverage',
        `A ${backupType} backup finished but did not capture everything: ${archive.excluded
          .filter((e) => e.reason !== 'secret_bearing' && e.reason !== 'backup_catalog')
          .map((e) => e.source)
          .slice(0, 5)
          .join(', ')}. Open Backup & Restore to review the coverage report.`
      );
    }

    if (backupType !== 'pre_restore') await pruneExpired(adminClient);

    return {
      ok: true,
      backupId: backupRow.backup_id,
      status: 'completed',
      sizeBytes: archive.bytes.byteLength,
      durationMs,
      rowCounts,
      isComplete: archive.isComplete,
      coverage: archive.coverage,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backupCore] ZIP export failed:', message);
    await adminClient
      .from('system_backups')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: message.slice(0, 500) })
      .eq('backup_id', backupRow.backup_id);
    await adminClient.from('audit_logs').insert({
      profile_id: callerProfileId,
      action: 'BACKUP_FAILED',
      table_name: 'system_backups',
      record_id: backupRow.backup_id,
      new_values: { backup_type: backupType, archive_format: ARCHIVE_FORMAT, error_message: message.slice(0, 500) },
    });
    await notifyTechnicalAdmins(
      adminClient,
      backupType === 'pre_restore' ? 'Pre-Restore Safety Backup Failed' : 'Backup Failed',
      `The ${backupType} system backup failed: ${message.slice(0, 200)}`
    );
    return { ok: false, backupId: backupRow.backup_id, status: 'failed', error: message };
  }
}

async function notifyTechnicalAdmins(adminClient: SupabaseClient, title: string, message: string): Promise<void> {
  const { data: techAdmins } = await adminClient
    .from('user_profiles')
    .select('profile_id')
    .in('role', ['provincial_admin', 'super_admin'])
    .eq('is_active', true);
  for (const admin of techAdmins ?? []) {
    await adminClient.from('notifications').insert({
      profile_id: admin.profile_id,
      notification_type: 'System',
      title,
      message,
      is_read: false,
    });
  }
}

/**
 * Module 42 — content validation for a ZIP archive. Kept separate from
 * runBackupValidation below (which validates the legacy .json.gz shape)
 * and routed by system_backups.archive_format, never by filename.
 */
export async function runZipArchiveValidation(
  adminClient: SupabaseClient,
  backup: Record<string, any>
): Promise<ArchiveValidation | { archiveIntact: false; restoreReady: false; checks: { label: string; passed: boolean; blocking: boolean; detail?: string }[]; manifest: null; coverageComplete: null; warnings: string[] }> {
  if (backup.status !== 'completed' || !backup.storage_path) {
    return {
      archiveIntact: false,
      restoreReady: false,
      checks: [{ label: 'Backup completed successfully', passed: false, blocking: true, detail: `status: ${backup.status}` }],
      manifest: null,
      coverageComplete: null,
      warnings: [],
    };
  }

  const { data: blob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
  if (dlErr || !blob) {
    return {
      archiveIntact: false,
      restoreReady: false,
      checks: [{ label: 'Archive is accessible in storage', passed: false, blocking: true, detail: dlErr?.message }],
      manifest: null,
      coverageComplete: null,
      warnings: [],
    };
  }

  return await validateArchiveBytes(new Uint8Array(await blob.arrayBuffer()), {
    storedChecksum: backup.checksum_sha256,
    schemaVersion: SCHEMA_VERSION,
    projectRef: projectRefFromUrl(Deno.env.get('SUPABASE_URL') ?? ''),
  });
}

// Shared by backup-create's handleValidate (Backup History's own
// "Validate" button) and by backup-restore (which calls this same logic
// one more time, immediately before actually applying a restore — never
// trusting a validation result that might be minutes/hours old). Every
// check is real: nothing here is reported SAFE TO PROCEED without
// actually having been checked, per the brief's explicit "never say
// safe if validation did not actually verify it."
export interface ValidationCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface ValidationOutcome {
  valid: boolean;
  checklist: ValidationCheck[];
  schemaVersion: string | null;
  projectRef: string | null;
}

export async function runBackupValidation(adminClient: SupabaseClient, backup: Record<string, any>): Promise<ValidationOutcome> {
  const checklist: ValidationCheck[] = [];
  const pass = (label: string, detail?: string) => checklist.push({ label, passed: true, detail });
  const fail = (label: string, detail?: string) => checklist.push({ label, passed: false, detail });

  pass('Backup record exists');

  if (backup.status !== 'completed' || !backup.storage_path) {
    fail('Backup completed successfully', `status: ${backup.status}`);
    return { valid: false, checklist, schemaVersion: backup.schema_version ?? null, projectRef: backup.project_ref ?? null };
  }
  pass('Backup completed successfully');

  if (backup.verification_status === 'corrupted') {
    fail('Not previously marked corrupted', 'This backup failed a prior integrity check.');
    return { valid: false, checklist, schemaVersion: backup.schema_version ?? null, projectRef: backup.project_ref ?? null };
  }
  pass('Not previously marked corrupted');

  if (backup.expires_at && new Date(backup.expires_at).getTime() < Date.now()) {
    fail('Backup has not expired', `Expired ${backup.expires_at}`);
  } else {
    pass('Backup has not expired');
  }

  const currentProjectRef = projectRefFromUrl(Deno.env.get('SUPABASE_URL') ?? '');
  if (backup.project_ref && backup.project_ref !== currentProjectRef) {
    fail('Backup belongs to this environment', `Backup project: ${backup.project_ref}, current: ${currentProjectRef}`);
  } else {
    pass('Backup belongs to this environment', backup.project_ref ? undefined : 'No project marker recorded (pre-dates this check)');
  }

  if (backup.schema_version && backup.schema_version !== SCHEMA_VERSION) {
    fail('Schema version compatible', `Backup: ${backup.schema_version}, current: ${SCHEMA_VERSION}`);
  } else {
    pass('Schema version compatible', backup.schema_version ? undefined : 'No schema version recorded (pre-dates this check)');
  }

  const { data: fileBlob, error: dlErr } = await adminClient.storage.from('system-backups').download(backup.storage_path);
  if (dlErr || !fileBlob) {
    fail('Backup file is accessible in storage', dlErr?.message);
    return { valid: false, checklist, schemaVersion: backup.schema_version ?? null, projectRef: backup.project_ref ?? null };
  }
  pass('Backup file is accessible in storage');

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());

  if (backup.checksum_sha256) {
    const actualChecksum = await sha256Hex(bytes);
    if (actualChecksum !== backup.checksum_sha256) {
      fail('Checksum (SHA-256) verified', 'Stored file does not match the checksum recorded at backup time.');
      return { valid: false, checklist, schemaVersion: backup.schema_version ?? null, projectRef: backup.project_ref ?? null };
    }
    pass('Checksum (SHA-256) verified');
  } else {
    fail('Checksum (SHA-256) verified', 'No checksum was recorded for this backup (created before integrity verification was added).');
  }

  try {
    const json = await gunzip(bytes);
    const parsed = JSON.parse(json);
    const mismatches: string[] = [];
    for (const [table, expectedCount] of Object.entries((backup.row_counts as Record<string, number>) ?? {})) {
      const actual = Array.isArray(parsed?.tables?.[table]) ? parsed.tables[table].length : -1;
      if (actual !== expectedCount) mismatches.push(`${table}: recorded ${expectedCount}, file contains ${actual}`);
    }
    if (mismatches.length > 0) {
      fail('File contents match recorded row counts', mismatches.join('; '));
    } else {
      pass('File contents match recorded row counts');
    }
  } catch {
    fail('Backup file is readable and parseable');
  }

  const valid = checklist.every((c) => c.passed);
  return { valid, checklist, schemaVersion: backup.schema_version ?? null, projectRef: backup.project_ref ?? null };
}

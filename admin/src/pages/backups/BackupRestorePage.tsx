import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  History,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmDialog, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { BackupSecurityPanel, useBackupAuthorization } from '../../components/backups/BackupAuthorization';
// Non-2xx responses from an Edge Function put the real body on
// error.context, NOT on error.message — which is just the generic
// "Edge Function returned a non-2xx status code". Reading error.message
// here is why a precise server-side refusal (a missing authorization
// grant, an unusable encryption key) reached the operator as an
// unactionable toast.
import { extractInvokeError } from '../../lib/adminUserHelpers';
import type { BackupFrequency, RestoreValidationCheck, SystemBackup, SystemRestore } from '../../types/database.types';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A restore in any of these statuses is still "in progress" and holds
// the real backend lock (see begin_restore_operation in module23) — the
// UI mirrors that same list rather than inventing its own notion of
// what counts as active.
const TERMINAL_RESTORE_STATUSES = [
  'validation_failed',
  'safety_backup_failed',
  'restore_failed',
  'verification_failed',
  'verified',
  // module44 — must be here, or a cancelled operation still shows the
  // "RECOVERY IN PROGRESS" banner and still blocks every action.
  'cancelled',
];

const BACKUP_TYPE_LABEL: Record<string, string> = { manual: 'Manual', scheduled: 'Scheduled', pre_restore: 'Pre-Restore Safety Backup' };
const BACKUP_STATUS_LABEL: Record<string, string> = { running: 'Running', completed: 'Completed', failed: 'Failed' };
const VERIFICATION_LABEL: Record<string, string> = { verified: 'Verified', unverified: 'Unverified', corrupted: 'Corrupted' };
const RESTORE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  validation_failed: 'Validation Failed',
  awaiting_confirmation: 'Awaiting Confirmation',
  confirmed: 'Confirmed',
  creating_safety_backup: 'Creating Safety Backup',
  safety_backup_failed: 'Safety Backup Failed',
  restoring: 'Restoring',
  restore_failed: 'Restore Failed',
  verifying: 'Verifying',
  verification_failed: 'Verification Failed',
  verified: 'Verified',
  cancelled: 'Cancelled',
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Not available';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return 'Not available';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUtc(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.slice(0, 8).toUpperCase();
}

function ValidationChecklist({ checklist }: { checklist: RestoreValidationCheck[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {checklist.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
          {c.passed ? (
            <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-success)' }} />
          ) : (
            <XCircle size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-danger)' }} />
          )}
          <div>
            <span>{c.label}</span>
            {c.detail && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{c.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

type WizardStep = 'validating' | 'preview' | 'confirm' | 'ready' | 'executing' | 'result';

/** Shape of the measured restore plan returned by backup-restore's 'plan' action. */
interface RestorePlan {
  archiveFormat?: string;
  legacy?: boolean;
  sourceEnvironment?: string | null;
  targetEnvironment?: string;
  crossEnvironment?: boolean;
  coverageComplete?: boolean | null;
  isEncrypted?: boolean;
  tables?: { table: string; order: number; archiveRows: number; liveRows: number; wouldOverwrite: number; wouldInsert: number }[];
  excludedByPolicy?: { table: string; reason: string }[];
  foreignKeyCycles?: string[];
  tablesWithoutPrimaryKey?: string[];
  notes?: string[];
}

interface WizardState {
  step: WizardStep;
  backup: SystemBackup;
  operationId?: string;
  confirmationPhrase?: string;
  checklist?: RestoreValidationCheck[];
  valid?: boolean;
  typedPhrase: string;
  plan?: RestorePlan;
  planError?: string;
  result?: {
    status: string;
    message: string;
    checks?: RestoreValidationCheck[];
    skippedTables?: { table: string; reason: string }[];
    manualActionsRequired?: string[];
  };
}

/**
 * Provincial Administrator — Backup & Restore (module16 + module23).
 *
 * Three panels that stay deliberately separate, never blurred together:
 *  1. Platform Recovery Infrastructure — a real, verified, dated fact
 *     about this Supabase project's PITR status (unchanged from before).
 *  2. Administrative Configuration Backup — the existing, unchanged
 *     create/schedule feature (module16).
 *  3. Recovery (module23) — the new, controlled, multi-step Restore
 *     capability: select -> validate -> preview -> confirm -> execute
 *     -> post-restore verify, never a single destructive click. Every
 *     status shown here comes from a real system_backups/system_restores
 *     row — nothing is fabricated to make a badge look green.
 */
export function BackupRestorePage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [backups, setBackups] = useState<SystemBackup[]>([]);
  const [restores, setRestores] = useState<SystemRestore[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<BackupFrequency>('daily');
  const [hourUtc, setHourUtc] = useState(2);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [retentionDays, setRetentionDays] = useState(30);
  const [scheduleUpdatedAt, setScheduleUpdatedAt] = useState<string | null>(null);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastRunStatus, setLastRunStatus] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [busyBackupId, setBusyBackupId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    backup: SystemBackup;
    valid: boolean;
    checklist: RestoreValidationCheck[];
    // ZIP archives only — deliberately separate from `valid`, which
    // means "the bytes and contents are sound". An archive can be
    // perfectly intact and still not be a complete recovery source.
    restoreReady?: boolean;
    coverageComplete?: boolean | null;
    warnings?: string[];
    disclaimer?: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SystemBackup | null>(null);
  const [coverageBackup, setCoverageBackup] = useState<SystemBackup | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [scheduleExists, setScheduleExists] = useState(false);
  const [confirmCancelRestore, setConfirmCancelRestore] = useState(false);
  const [cancellingRestore, setCancellingRestore] = useState(false);

  const { requestAuthorization, authElement } = useBackupAuthorization();

  const load = useCallback(async () => {
    const [backupsRes, scheduleRes, restoresRes] = await Promise.all([
      supabase.from('system_backups').select('*').order('started_at', { ascending: false }).limit(50),
      supabase.from('backup_schedule').select('*').eq('schedule_id', '00000000-0000-0000-0000-000000000001').single(),
      supabase.from('system_restores').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setBackups(backupsRes.data ?? []);
    setRestores(restoresRes.data ?? []);
    if (scheduleRes.data) {
      setEnabled(scheduleRes.data.enabled);
      setFrequency(scheduleRes.data.frequency);
      setDayOfMonth(scheduleRes.data.day_of_month ?? 1);
      setHourUtc(scheduleRes.data.hour_utc);
      setDayOfWeek(scheduleRes.data.day_of_week ?? 0);
      setRetentionDays(scheduleRes.data.retention_days);
      setScheduleUpdatedAt(scheduleRes.data.updated_at);
      setNextRunAt(scheduleRes.data.next_run_at ?? null);
      setLastRunAt(scheduleRes.data.last_run_at ?? null);
      setLastRunStatus(scheduleRes.data.last_run_status ?? null);
      // A schedule that has never been configured still has its seed
      // row (module16 inserts one), so "exists" means it has actually
      // been set up — which is what decides whether this is a
      // schedule_create or a schedule_modify authorization.
      setScheduleExists(!!scheduleRes.data.updated_by);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  const lastSuccessful = backups.find((b) => b.status === 'completed');
  const activeRestore = useMemo(() => restores.find((r) => !TERMINAL_RESTORE_STATUSES.includes(r.status)), [restores]);

  // Every status below is computed from real rows already loaded above —
  // never a hardcoded "green because the UI says so".
  const integrityStatus: 'verified' | 'unverified' | 'corrupted' = !lastSuccessful ? 'unverified' : lastSuccessful.verification_status;
  const availabilityOk = enabled && !!lastSuccessful && !activeRestore;

  const createBackup = async () => {
    setConfirmCreate(false);
    // Module 42 — every protected operation gets its own single-use
    // grant. A null return means the operator cancelled or the password
    // was wrong; the Edge Function would refuse anyway, so we simply
    // stop here rather than calling it and showing a second error.
    const grantId = await requestAuthorization('create');
    if (!grantId) return;

    setCreating(true);
    const { data, error } = await supabase.functions.invoke('backup-create', {
      body: { action: 'create', grantId },
    });
    setCreating(false);
    const createError = await extractInvokeError(data, error);
    if (createError) {
      showToast('error', createError, 9000);
      load();
      return;
    }
    // "Completed" and "complete" are different claims — an archive can
    // finish successfully and still not contain everything.
    if (data.isComplete === false) {
      showToast(
        'error',
        `Backup finished (${formatBytes(data.sizeBytes)}) but coverage is incomplete. Open the backup's details to see what was not captured.`,
        9000
      );
    } else {
      showToast('success', `Backup completed (${formatBytes(data.sizeBytes)}).`);
    }
    load();
  };

  const saveSchedule = async () => {
    if (!profile) return;
    const grantId = await requestAuthorization(scheduleExists ? 'schedule_modify' : 'schedule_create');
    if (!grantId) return;

    setSavingSchedule(true);
    // module42's wrapper spends the grant and then delegates to
    // module16's unchanged set_backup_schedule(), which is what keeps
    // the backup_schedule row and the real pg_cron job in sync.
    const { error } = await supabase.rpc('set_backup_schedule_authorized', {
      p_grant_id: grantId,
      p_operation: scheduleExists ? 'schedule_modify' : 'schedule_create',
      p_enabled: enabled,
      p_frequency: frequency,
      p_hour_utc: hourUtc,
      p_day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      p_retention_days: retentionDays,
      p_day_of_month: frequency === 'monthly' ? dayOfMonth : null,
    });
    setSavingSchedule(false);
    if (error) {
      showToast(
        'error',
        error.message?.includes('BACKUP_AUTH_REQUIRED')
          ? 'That backup authorization is no longer valid. Please authorize again.'
          : error.message || 'Could not update the backup schedule.'
      );
      return;
    }
    showToast('success', enabled ? 'Scheduled backups enabled.' : 'Scheduled backups disabled.');
    load();
  };

  const validateBackup = async (backup: SystemBackup) => {
    const grantId = await requestAuthorization('validate', backup.backup_id, `Backup ${shortId(backup.backup_id)}`);
    if (!grantId) return;

    setBusyBackupId(backup.backup_id);
    const { data, error } = await supabase.functions.invoke('backup-create', {
      body: { action: 'validate', backupId: backup.backup_id, grantId },
    });
    setBusyBackupId(null);
    const validateError = await extractInvokeError(data, error);
    if (validateError) {
      showToast('error', validateError, 9000);
      return;
    }
    // ZIP archives report archiveIntact/restoreReady separately; the
    // legacy format reports a single `valid`. Both are surfaced without
    // collapsing the ZIP's two distinct verdicts into one.
    setValidationResult({
      backup,
      valid: data.archiveFormat === 'zip' ? !!data.archiveIntact : !!data.valid,
      checklist: data.checks ?? data.checklist ?? [],
      restoreReady: data.archiveFormat === 'zip' ? !!data.restoreReady : undefined,
      coverageComplete: data.archiveFormat === 'zip' ? data.coverageComplete : undefined,
      warnings: data.warnings ?? [],
      disclaimer: data.disclaimer,
    });
    load();
  };

  const downloadBackup = async (backup: SystemBackup) => {
    const grantId = await requestAuthorization('download', backup.backup_id, `Backup ${shortId(backup.backup_id)}`);
    if (!grantId) return;

    setBusyBackupId(backup.backup_id);
    const { data, error } = await supabase.functions.invoke('backup-create', {
      body: { action: 'download', backupId: backup.backup_id, grantId },
    });
    setBusyBackupId(null);
    const downloadError = await extractInvokeError(data, error);
    if (downloadError || !data?.url) {
      showToast('error', downloadError ?? 'Could not create a download link.', 9000);
      return;
    }
    if (backup.is_encrypted) {
      showToast(
        'success',
        'Download link opened. This archive is encrypted — it is not a readable ZIP until decrypted with the escrowed key.',
        9000
      );
    }
    window.open(data.url, '_blank');
  };

  const deleteBackup = async (backup: SystemBackup) => {
    setConfirmDelete(null);
    const grantId = await requestAuthorization('delete', backup.backup_id, `Backup ${shortId(backup.backup_id)}`);
    if (!grantId) return;

    setBusyBackupId(backup.backup_id);
    const { data, error } = await supabase.functions.invoke('backup-create', {
      body: { action: 'delete', backupId: backup.backup_id, grantId },
    });
    setBusyBackupId(null);
    const deleteError = await extractInvokeError(data, error);
    if (deleteError) {
      showToast('error', deleteError, 9000);
      return;
    }
    showToast('success', 'Backup deleted.');
    load();
  };

  // --- Restore wizard -------------------------------------------------

  const startRestore = async (backup: SystemBackup) => {
    if (activeRestore) {
      showToast('error', 'Another recovery operation is currently in progress.');
      return;
    }
    const grantId = await requestAuthorization('restore_begin', backup.backup_id, `Backup ${shortId(backup.backup_id)}`);
    if (!grantId) return;

    setWizard({ step: 'validating', backup, typedPhrase: '' });

    // The plan is fetched first and separately: it is read-only, it
    // writes nothing, and the operator should see the real blast radius
    // before an operation row or a lock exists.
    const planRes = await supabase.functions.invoke('backup-restore', {
      body: { action: 'plan', backupId: backup.backup_id },
    });

    const { data, error } = await supabase.functions.invoke('backup-restore', {
      body: { action: 'begin', backupId: backup.backup_id, grantId },
    });
    const beginError = await extractInvokeError(data, error);
    if (beginError) {
      showToast('error', beginError, 9000);
      setWizard(null);
      load();
      return;
    }
    setWizard({
      step: data.valid ? 'preview' : 'result',
      backup,
      operationId: data.operationId,
      confirmationPhrase: data.confirmationPhrase,
      checklist: data.checklist,
      valid: data.valid,
      typedPhrase: '',
      plan: planRes.error ? undefined : planRes.data,
      planError: planRes.error ? planRes.error.message : (planRes.data?.error as string | undefined),
      result: data.valid ? undefined : { status: data.status, message: data.message, checks: data.checklist },
    });
    load();
  };

  const confirmRestore = async () => {
    if (!wizard?.operationId) return;
    const { data, error } = await supabase.functions.invoke('backup-restore', {
      body: { action: 'confirm', operationId: wizard.operationId, confirmationPhrase: wizard.typedPhrase },
    });
    const confirmError = await extractInvokeError(data, error);
    if (confirmError) {
      showToast('error', confirmError, 9000);
      return;
    }
    setWizard((w) => (w ? { ...w, step: 'ready' } : w));
  };

  const executeRestore = async () => {
    if (!wizard?.operationId) return;

    // A SECOND, separate authorization immediately before anything is
    // written. The restore_begin grant was already spent and cannot be
    // replayed here — this is the "revalidate authorization immediately
    // before executing a destructive operation" requirement, enforced
    // by the Edge Function consuming a distinct restore_execute grant.
    const grantId = await requestAuthorization(
      'restore_execute',
      wizard.operationId,
      `Restore operation ${shortId(wizard.operationId)} into this environment`
    );
    if (!grantId) return;

    setWizard((w) => (w ? { ...w, step: 'executing' } : w));
    const { data, error } = await supabase.functions.invoke('backup-restore', {
      body: { action: 'execute', operationId: wizard.operationId, grantId },
    });
    load();
    if (error) {
      setWizard((w) => (w ? { ...w, step: 'result', result: { status: 'restore_failed', message: error.message || 'Restore failed.' } } : w));
      return;
    }
    if (data?.error) {
      setWizard((w) => (w ? { ...w, step: 'result', result: { status: 'restore_failed', message: data.error, checks: data.checklist } } : w));
      return;
    }
    setWizard((w) =>
      w
        ? {
            ...w,
            step: 'result',
            result: {
              status: data.status,
              message: data.message,
              checks: data.checks,
              skippedTables: data.skippedTables,
              manualActionsRequired: data.manualActionsRequired,
            },
          }
        : w
    );
  };

  /**
   * Closes the wizard AND releases the operation row.
   *
   * This previously only cleared local state, which orphaned the
   * system_restores row that begin_restore_operation() had already
   * inserted — holding the restore lock forever and leaving a permanent
   * "RECOVERY IN PROGRESS" banner. Cancelling in the UI now actually
   * cancels the operation server-side (module44).
   *
   * An operation that has reached a terminal status (the 'result' step)
   * needs no cancelling, so that case just closes.
   */
  const closeWizard = async () => {
    const operationId = wizard?.operationId;
    const alreadyFinished = wizard?.step === 'result';
    setWizard(null);

    if (operationId && !alreadyFinished) {
      const { data, error } = await supabase.rpc('cancel_restore_operation', {
        p_operation_id: operationId,
        p_force: false,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || (row && !row.ok && row.reason !== 'already_finished')) {
        // Surfaced rather than swallowed: if the release failed, the
        // operator needs to know the lock is still held.
        showToast(
          'error',
          'The recovery operation could not be released. It may still be holding the restore lock — reopen this page and use "Cancel recovery".'
        );
      }
    }
    load();
  };

  /** Cancels the stuck operation shown in the banner. */
  const cancelActiveRestore = async (force: boolean) => {
    if (!activeRestore) return;
    setCancellingRestore(true);
    const { data, error } = await supabase.rpc('cancel_restore_operation', {
      p_operation_id: activeRestore.operation_id,
      p_force: force,
    });
    setCancellingRestore(false);
    setConfirmCancelRestore(false);

    const row = Array.isArray(data) ? data[0] : data;
    if (error) {
      showToast('error', error.message || 'Could not cancel this recovery operation.');
      return;
    }
    if (row && !row.ok) {
      const messages: Record<string, string> = {
        not_found: 'That recovery operation no longer exists.',
        already_finished: 'That recovery operation has already finished.',
        in_flight:
          'This restore may still be writing data, so it was not cancelled. If it is genuinely stalled, wait until 30 minutes have passed since it started and then force-cancel it.',
        too_recent_to_force:
          'This restore started less than 30 minutes ago and may still be running. Force-cancel is refused until then.',
      };
      showToast('error', messages[row.reason] ?? 'Could not cancel this recovery operation.');
      load();
      return;
    }
    showToast(
      'success',
      row?.reason === 'force_cancelled'
        ? 'Recovery force-cancelled. Review the restore details — partially applied changes were NOT rolled back.'
        : 'Recovery cancelled. No data was modified.'
    );
    load();
  };

  return (
    <div>
      <PageHeader
        title="Backup &amp; Restore"
        subtitle="System recovery infrastructure — technical administration only"
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* Placed first deliberately: until this password exists, every
          protected operation on this page is refused by the server, so
          an operator needs to see that before trying anything else. */}
      <div style={{ marginBottom: 20 }}>
        <BackupSecurityPanel />
      </div>

      {activeRestore && (
        <div className="card" style={{ marginBottom: 20, background: 'var(--color-danger)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Lock size={18} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>SAFESPACE RECOVERY IN PROGRESS</strong>
              <div style={{ fontSize: 12.5, opacity: 0.9 }}>
                A restore operation is active ({RESTORE_STATUS_LABEL[activeRestore.status] ?? activeRestore.status}). Normal
                backup/restore actions are unavailable until it finishes. Other application services are not affected by this
                restore scope.
              </div>
              {/* Nothing has been written in these states, so say so —
                  an operator staring at a red banner needs to know
                  whether cancelling is safe. */}
              {['pending', 'awaiting_confirmation', 'confirmed'].includes(activeRestore.status) && (
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 5 }}>
                  This operation has not written any data yet — it is safe to cancel. Started {formatUtc(activeRestore.created_at)}.
                </div>
              )}
            </div>
            <button
              className="btn btn-outline btn-sm"
              style={{ background: '#fff', flexShrink: 0 }}
              onClick={() => setConfirmCancelRestore(true)}
              disabled={cancellingRestore}
            >
              {cancellingRestore ? 'Cancelling…' : 'Cancel recovery'}
            </button>
          </div>
        </div>
      )}

      {/* Panel 1 — real, verified, dated platform fact. Not live-polled. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Platform Recovery Infrastructure</h3>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 14 }}>
          <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-warning)' }} />
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>Point-in-Time Recovery: Not Enabled.</strong> Verified directly against this project's Supabase
            infrastructure (<code>supabase backups list</code>): no physical/PITR backups are currently active. PITR
            provides continuous, full-database recovery to any point within a retention window, but enabling it is a
            Supabase plan/billing action taken in the Supabase Dashboard (Settings → Add-ons) — it cannot be toggled
            from this application. This status is a point-in-time verification, not a live monitor.
          </div>
        </div>
      </div>

      {/* CIA status — every value below is computed from real rows loaded above. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Information Security</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <span className="label">Confidentiality</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <StatusBadge label="Protected" />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Private storage bucket, no public listing/URLs, restricted to technical administrators, downloads via
              60-second signed links only.
            </p>
          </div>
          <div>
            <span className="label">Integrity</span>
            <div style={{ marginTop: 4 }}>
              <StatusBadge label={VERIFICATION_LABEL[integrityStatus]} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
              {integrityStatus === 'verified'
                ? 'The last successful backup’s SHA-256 checksum has been verified against its stored file.'
                : integrityStatus === 'corrupted'
                ? 'The last successful backup failed checksum verification. It cannot be used for restore.'
                : 'The last successful backup has not yet been checksum-verified. Use Validate below.'}
            </p>
          </div>
          <div>
            <span className="label">Availability</span>
            <div style={{ marginTop: 4 }}>
              <StatusBadge label={availabilityOk ? 'Protected' : activeRestore ? 'Recovery In Progress' : 'Attention Needed'} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
              {activeRestore
                ? 'A restore operation is currently active — see the banner above.'
                : availabilityOk
                ? 'A recent successful backup exists and the schedule is active.'
                : 'No recent successful backup, or the schedule is disabled — recovery capability is reduced.'}
            </p>
          </div>
        </div>
      </div>

      {/* Panel 2 — real, working, interactive feature. Unchanged logic. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <h3>Administrative Configuration Backup</h3>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4, maxWidth: 560 }}>
              Exports municipalities, barangays, shelters, and administrator accounts only. This does not include
              survivor records, case data, identity documents, or access credentials — full database recovery is the
              Point-in-Time Recovery capability described above, once enabled.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setConfirmCreate(true)} disabled={creating || !!activeRestore}>
            <Database size={14} /> {creating ? 'Creating…' : 'Create Backup Now'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 16 }}>
          <div>
            <span className="label">Last Successful Backup</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{lastSuccessful ? formatUtc(lastSuccessful.completed_at) : 'No backups yet'}</div>
          </div>
          <div>
            <span className="label">Scheduled Backups</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {enabled
                ? `${
                    frequency === 'daily'
                      ? 'Daily'
                      : frequency === 'weekly'
                        ? `Weekly (${DAY_LABELS[dayOfWeek]})`
                        : `Monthly (day ${dayOfMonth})`
                  } at ${String(hourUtc).padStart(2, '0')}:00 UTC`
                : 'Disabled'}
            </div>
            {/* Real run state from backup_schedule, not inferred from the
                backup list. "Never run" is shown as exactly that. */}
            {enabled && (
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 3 }}>
                Next: {nextRunAt ? formatUtc(nextRunAt) : 'not computed'} · Last:{' '}
                {lastRunAt ? (
                  <>
                    {formatUtc(lastRunAt)}
                    {lastRunStatus && (
                      <span style={{ color: lastRunStatus === 'failed' ? 'var(--color-danger)' : undefined }}>
                        {' '}
                        ({lastRunStatus.replace(/_/g, ' ')})
                      </span>
                    )}
                  </>
                ) : (
                  'never run'
                )}
              </div>
            )}
          </div>
          <div>
            <span className="label">Retention</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{retentionDays} days</div>
          </div>
          <div>
            <span className="label">Storage</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>system-backups bucket</div>
          </div>
        </div>
      </div>

      {/* Schedule configuration — real, server-side (pg_cron), not a browser timer. Unchanged. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 4 }}>Backup Schedule</h3>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          Runs server-side via a scheduled database job — this continues to operate even if no administrator has the
          dashboard open.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Frequency</label>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as BackupFrequency)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {frequency === 'weekly' && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Day of week</label>
              <select className="input" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
                {DAY_LABELS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}
          {frequency === 'monthly' && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Day of month</label>
              <select className="input" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {/* Stated rather than silently enforced: an operator who
                  wants the 31st deserves to know why it is absent. */}
              <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '5px 0 0' }}>
                Only 1–28 are offered. Cron does not fire on a day a month does not have, so a schedule set for the 29th,
                30th or 31st would silently skip shorter months with nothing in any log to show a run was due.
              </p>
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Time (UTC)</label>
            <select className="input" value={hourUtc} onChange={(e) => setHourUtc(Number(e.target.value))}>
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Retention</label>
            <select className="input" value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value))}>
              {[7, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
          <button className="btn btn-outline" onClick={saveSchedule} disabled={savingSchedule}>
            {savingSchedule ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
        {scheduleUpdatedAt && (
          <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 10 }}>Last changed: {formatUtc(scheduleUpdatedAt)}</p>
        )}
      </div>

      {/* Recovery — the new, controlled restore capability. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Recovery</h3>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 14, marginBottom: 4 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-danger)' }} />
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            Restore applies a selected backup's <strong>municipalities, barangays, and shelters</strong> rows back
            into the live database by inserting/updating them (an <strong>upsert</strong>) — it never deletes rows
            created after the backup, and it never touches administrator accounts, survivor records, case data, or
            credentials. Use <strong>Restore</strong> on a specific backup in Backup History below to begin — it is a
            several-step, confirmed process, never a single click.
          </div>
        </div>
      </div>

      {/* Backup history — real rows only, now with integrity + restore trigger. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Backup History</h3>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : backups.length === 0 ? (
          <EmptyState title="No backups yet" subtitle="Create one now, or enable a schedule above." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Date / Time (UTC)</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Format</th>
                  <th>Size</th>
                  <th>Coverage</th>
                  <th>Integrity</th>
                  <th>Retention</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => {
                  const expired = b.expires_at ? new Date(b.expires_at).getTime() < Date.now() : false;
                  const corrupted = b.verification_status === 'corrupted';
                  // Integrity and Retention are two separate facts about a
                  // backup, not one — a backup can be expired AND still
                  // show whether it was ever verified/corrupted. Integrity
                  // must never be overwritten with "Expired"; that status
                  // belongs to the Retention column alone.
                  const restoreDisabled = !!activeRestore || expired || corrupted;
                  const restoreDisabledReason = corrupted
                    ? 'Corrupted backups cannot be restored'
                    : expired
                    ? 'Expired backups cannot be restored'
                    : activeRestore
                    ? 'Another recovery operation is currently in progress'
                    : undefined;
                  return (
                    <tr key={b.backup_id}>
                      <td>{formatUtc(b.started_at)}</td>
                      <td>{BACKUP_TYPE_LABEL[b.backup_type] ?? b.backup_type}</td>
                      <td><StatusBadge label={BACKUP_STATUS_LABEL[b.status] ?? b.status} /></td>
                      <td style={{ fontSize: 12 }}>
                        {/* Legacy rows have no archive_format and must not be
                            displayed as ZIP archives they are not. */}
                        {b.archive_format === 'zip' ? 'ZIP' : b.archive_format === 'json_gz' ? 'Legacy' : 'Legacy'}
                        {b.is_encrypted && (
                          <span title={`Encrypted (${b.encryption_algorithm ?? 'AES-256-GCM'})`} style={{ marginLeft: 5, verticalAlign: 'middle' }}>
                            <Lock size={11} />
                          </span>
                        )}
                      </td>
                      <td>{formatBytes(b.size_bytes)}</td>
                      <td style={{ fontSize: 12 }}>
                        {/* Three genuinely different states, never collapsed:
                            complete, finished-but-incomplete, and "this
                            format never recorded coverage at all". */}
                        {b.status !== 'completed' ? (
                          '—'
                        ) : b.is_complete === true ? (
                          <span style={{ color: 'var(--color-success)' }}>Complete</span>
                        ) : b.is_complete === false ? (
                          <button
                            className="btn-link"
                            style={{ color: 'var(--color-warning)', font: 'inherit', padding: 0, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setCoverageBackup(b)}
                          >
                            Incomplete
                          </button>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }} title="This backup predates coverage reporting.">
                            Not recorded
                          </span>
                        )}
                      </td>
                      <td><StatusBadge label={VERIFICATION_LABEL[b.verification_status]} /></td>
                      <td style={{ fontSize: 12 }}>{expired ? 'Expired' : `${b.retention_days}d`}</td>
                      <td className="table-actions-cell" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {b.status === 'completed' && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => validateBackup(b)} disabled={busyBackupId === b.backup_id}>
                              <RefreshCw size={12} /> Validate
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => downloadBackup(b)} disabled={busyBackupId === b.backup_id}>
                              <Download size={12} /> Download
                            </button>
                            {b.backup_type !== 'pre_restore' && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => startRestore(b)}
                                disabled={restoreDisabled}
                                title={restoreDisabledReason}
                              >
                                <RotateCcw size={12} /> Restore
                              </button>
                            )}
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => setConfirmDelete(b)}
                              disabled={busyBackupId === b.backup_id || !!activeRestore}
                              title={activeRestore ? 'A recovery operation is currently in progress' : 'Permanently delete this archive'}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </>
                        )}
                        {b.status === 'failed' && b.error_message && (
                          <span style={{ fontSize: 11.5, color: 'var(--color-danger)' }} title={b.error_message}>
                            <HardDrive size={12} /> {b.error_message.slice(0, 40)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recovery Activity — restore history. */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recovery Activity</h3>
        {restores.length === 0 ? (
          <EmptyState title="No restore operations yet" subtitle="Restore history will appear here once a recovery is attempted." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Backup</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Safety Backup</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {restores.map((r) => (
                  <tr key={r.operation_id}>
                    <td title={r.operation_id}>REC-{shortId(r.operation_id)}</td>
                    <td title={r.backup_id}>BAK-{shortId(r.backup_id)}</td>
                    <td>{formatUtc(r.created_at)}</td>
                    <td><StatusBadge label={RESTORE_STATUS_LABEL[r.status] ?? r.status} /></td>
                    <td>
                      {r.safety_backup_id ? (
                        <span title={`BAK-${shortId(r.safety_backup_id)}`}>
                          <History size={12} />
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{formatDuration(r.started_at, r.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmCreate && (
        <ConfirmDialog
          title="Create Backup"
          body="This creates a new ZIP archive of this environment: all in-scope database tables, the current schema, configuration metadata, and the Supabase Auth user inventory. Credential-bearing tables and secret values are never included. You will be asked for the backup authorization password next."
          confirmLabel="Create Backup"
          onConfirm={createBackup}
          onCancel={() => setConfirmCreate(false)}
        />
      )}

      {confirmCancelRestore && activeRestore && (
        <ConfirmModal
          open
          icon={<XCircle size={18} />}
          danger={!['pending', 'awaiting_confirmation', 'confirmed'].includes(activeRestore.status)}
          title="Cancel this recovery operation?"
          description={
            ['pending', 'awaiting_confirmation', 'confirmed'].includes(activeRestore.status) ? (
              <>
                <p style={{ marginTop: 0 }}>
                  Operation <strong>{shortId(activeRestore.operation_id)}</strong> is at{' '}
                  <strong>{RESTORE_STATUS_LABEL[activeRestore.status] ?? activeRestore.status}</strong> and has{' '}
                  <strong>not written any data</strong>.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Cancelling releases the recovery lock so backups and restores work normally again. Nothing in the database
                  changes.
                </p>
              </>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  Operation <strong>{shortId(activeRestore.operation_id)}</strong> is at{' '}
                  <strong>{RESTORE_STATUS_LABEL[activeRestore.status] ?? activeRestore.status}</strong>, which means it may
                  still be <strong>actively writing data</strong>.
                </p>
                <p style={{ marginBottom: 0 }}>
                  It will only be force-cancelled if it has been stalled for over 30 minutes. Partially applied changes are{' '}
                  <strong>not rolled back</strong> — check the pre-restore safety backup before retrying.
                </p>
              </>
            )
          }
          confirmLabel="Cancel Recovery"
          loadingLabel="Cancelling…"
          cancelLabel="Keep waiting"
          loading={cancellingRestore}
          onCancel={() => setConfirmCancelRestore(false)}
          onConfirm={() =>
            void cancelActiveRestore(!['pending', 'awaiting_confirmation', 'confirmed'].includes(activeRestore.status))
          }
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          open
          icon={<Trash2 size={18} />}
          danger
          title="Delete this backup permanently?"
          description={
            <>
              <p style={{ marginTop: 0 }}>
                Archive <strong>{shortId(confirmDelete.backup_id)}</strong> from {formatUtc(confirmDelete.started_at)} (
                {formatBytes(confirmDelete.size_bytes)}) will be removed from storage and from the backup catalog.
              </p>
              <p style={{ marginBottom: 0 }}>
                <strong>This cannot be undone.</strong> The server will refuse if this archive is referenced by a restore
                operation, or if it is the only verified backup you have left. You will be asked for the backup
                authorization password next.
              </p>
            </>
          }
          confirmLabel="Delete Backup"
          loadingLabel="Deleting…"
          requirePhrase={`DELETE ${shortId(confirmDelete.backup_id)}`}
          loading={busyBackupId === confirmDelete.backup_id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteBackup(confirmDelete)}
        />
      )}

      {coverageBackup && (
        <Modal
          title="Backup Coverage Report"
          onClose={() => setCoverageBackup(null)}
          footer={<button className="btn btn-primary" onClick={() => setCoverageBackup(null)}>Close</button>}
        >
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Archive <strong>{shortId(coverageBackup.backup_id)}</strong> finished successfully, but it does not contain
            everything. Each source below was recorded from what actually happened during the run.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(coverageBackup.coverage ?? []).map((entry, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 12.5,
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                {entry.status === 'included' ? (
                  <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-success)' }} />
                ) : entry.status === 'partial' ? (
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-warning)' }} />
                ) : (
                  <XCircle size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-text-muted)' }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong>{entry.source}</strong>
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      {' — '}
                      {entry.status}
                      {entry.reason ? ` (${entry.reason.replace(/_/g, ' ')})` : ''}
                      {typeof entry.rows === 'number' ? `, ${entry.rows.toLocaleString()} rows` : ''}
                      {typeof entry.objects === 'number' ? `, ${entry.objects.toLocaleString()} objects` : ''}
                    </span>
                  </div>
                  {entry.note && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 0, marginTop: 12 }}>
            Sources excluded as <em>secret bearing</em> or <em>backup catalog</em> are deliberate and permanent — they are
            not counted against completeness.
          </p>
        </Modal>
      )}

      {validationResult && (
        <Modal title="Backup Validation Result" onClose={() => setValidationResult(null)} footer={<button className="btn btn-primary" onClick={() => setValidationResult(null)}>Close</button>}>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            <strong>{formatUtc(validationResult.backup.started_at)}</strong> —{' '}
            {validationResult.valid ? (
              <span style={{ color: 'var(--color-success)' }}>Archive integrity verified</span>
            ) : (
              <span style={{ color: 'var(--color-danger)' }}>Failed integrity checks</span>
            )}
          </p>

          {/* Two separate verdicts, never merged: an archive can be
              byte-perfect and still be an incomplete recovery source.
              The old single "SAFE TO PROCEED" line overstated the
              first as if it proved the second. */}
          {validationResult.restoreReady !== undefined && (
            <p style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
              Restore readiness:{' '}
              {validationResult.restoreReady ? (
                <span style={{ color: 'var(--color-success)' }}>complete archive, every source captured</span>
              ) : (
                <span style={{ color: 'var(--color-warning)' }}>
                  restorable, but this archive does not contain everything
                </span>
              )}
            </p>
          )}

          <ValidationChecklist checklist={validationResult.checklist} />

          {(validationResult.warnings ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h5 style={{ margin: '0 0 6px', fontSize: 12.5 }}>Warnings</h5>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {(validationResult.warnings ?? []).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {validationResult.disclaimer && (
            <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 12, marginBottom: 0 }}>
              {validationResult.disclaimer}
            </p>
          )}
        </Modal>
      )}

      {wizard && (
        <Modal title="Restore" onClose={wizard.step === 'executing' ? () => {} : closeWizard}>
          {wizard.step === 'validating' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <RefreshCw size={22} className="spin" />
              <p style={{ marginTop: 10, fontSize: 13 }}>Validating backup…</p>
            </div>
          )}

          {wizard.step === 'preview' && wizard.checklist && (
            <div>
              <h4 style={{ marginBottom: 10 }}>Restore Preview</h4>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 4 }}>Selected Backup</p>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>BAK-{shortId(wizard.backup.backup_id)} — {formatUtc(wizard.backup.completed_at)}</p>
              <ValidationChecklist checklist={wizard.checklist} />

              {/* The measured plan. Every number is read from the actual
                  archive and the actual target — never an estimate. */}
              {wizard.planError && (
                <p style={{ fontSize: 12.5, color: 'var(--color-danger)', marginTop: 14 }}>
                  The restore plan could not be generated: {wizard.planError}. Do not proceed without it.
                </p>
              )}

              {wizard.plan?.legacy && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 14 }}>
                  This is a legacy administrative-configuration backup. Its restore scope is municipalities, barangays and
                  shelters only.
                </p>
              )}

              {wizard.plan && !wizard.plan.legacy && (
                <div style={{ marginTop: 16 }}>
                  <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>Restore Plan</h5>

                  {wizard.plan.crossEnvironment && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--color-surface-muted)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                      <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-danger)' }} />
                      <div style={{ fontSize: 12.5 }}>
                        <strong>Cross-environment restore.</strong> This archive came from{' '}
                        <code>{wizard.plan.sourceEnvironment}</code> but the target is <code>{wizard.plan.targetEnvironment}</code>.
                      </div>
                    </div>
                  )}

                  {wizard.plan.coverageComplete === false && (
                    <p style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 0 }}>
                      This archive's coverage is incomplete — it will restore only what it actually contains.
                    </p>
                  )}

                  <div className="table-responsive" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Table</th>
                          <th>In archive</th>
                          <th>Live now</th>
                          <th>Overwrites</th>
                          <th>Inserts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(wizard.plan.tables ?? []).map((t) => (
                          <tr key={t.table}>
                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.order}</td>
                            <td style={{ fontSize: 12 }}>{t.table}</td>
                            <td style={{ fontSize: 12 }}>{t.archiveRows.toLocaleString()}</td>
                            <td style={{ fontSize: 12 }}>{t.liveRows.toLocaleString()}</td>
                            <td style={{ fontSize: 12, color: t.wouldOverwrite > 0 ? 'var(--color-danger)' : undefined }}>
                              {t.wouldOverwrite.toLocaleString()}
                            </td>
                            <td style={{ fontSize: 12 }}>{t.wouldInsert.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>
                    Tables are applied in the order shown, derived from the live foreign-key graph so parents precede
                    children. "Overwrites" is sampled over the first 1,000 identifiers per table — a measured lower bound.
                  </p>

                  {(wizard.plan.excludedByPolicy ?? []).length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <h5 style={{ margin: '0 0 6px', fontSize: 12.5 }}>Present in the archive but never restored</h5>
                      {(wizard.plan.excludedByPolicy ?? []).map((x) => (
                        <div key={x.table} style={{ fontSize: 12, marginBottom: 5 }}>
                          <strong>{x.table}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>{x.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(wizard.plan.foreignKeyCycles ?? []).length > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 10 }}>
                      Skipped due to a foreign-key cycle that cannot be safely ordered:{' '}
                      {(wizard.plan.foreignKeyCycles ?? []).join(', ')}
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, marginTop: 16 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-danger)' }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <strong>How this restore behaves:</strong> rows are inserted or updated by primary key. Nothing is ever
                  deleted or truncated, so anything created since the backup stays. Administrator accounts, the audit log
                  and terms acceptances are never restored. A verified safety backup of the current state is taken first,
                  and the restore is abandoned if that fails. Supabase Auth logins are <em>not</em> restored and must be
                  reconciled manually afterwards.
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button className="btn btn-outline" onClick={closeWizard}>Cancel</button>
                <button className="btn btn-danger" onClick={() => setWizard((w) => (w ? { ...w, step: 'confirm' } : w))}>Continue to Confirmation</button>
              </div>
            </div>
          )}

          {wizard.step === 'confirm' && (
            <div>
              <h4 style={{ marginBottom: 10 }}>Confirm Restore</h4>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Type the phrase below exactly to confirm. This prevents an accidental restore.
              </p>
              <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                {wizard.confirmationPhrase}
              </p>
              <input
                className="input"
                placeholder="Type the phrase above"
                value={wizard.typedPhrase}
                onChange={(e) => setWizard((w) => (w ? { ...w, typedPhrase: e.target.value } : w))}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button className="btn btn-outline" onClick={closeWizard}>Cancel</button>
                <button className="btn btn-danger" disabled={wizard.typedPhrase.trim() !== wizard.confirmationPhrase} onClick={confirmRestore}>
                  Confirm Restore
                </button>
              </div>
            </div>
          )}

          {wizard.step === 'ready' && (
            <div>
              <h4 style={{ marginBottom: 10 }}>Ready to Restore</h4>
              <p style={{ fontSize: 13, marginBottom: 16 }}>
                Confirmation accepted. This is the final step — pressing <strong>Restore Backup Now</strong> will
                create a pre-restore safety backup, apply the selected backup, and run post-restore verification.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-outline" onClick={closeWizard}>Cancel</button>
                <button className="btn btn-danger" onClick={executeRestore}>
                  <ShieldCheck size={14} /> Restore Backup Now
                </button>
              </div>
            </div>
          )}

          {wizard.step === 'executing' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Lock size={24} style={{ color: 'var(--color-danger)' }} />
              <h4 style={{ marginTop: 10 }}>SAFESPACE RECOVERY IN PROGRESS</h4>
              <p style={{ marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)' }}>
                Creating a safety backup, applying the restore, and verifying the result. Do not close this window.
              </p>
            </div>
          )}

          {wizard.step === 'result' && wizard.result && (
            <div>
              {wizard.result.status === 'verified' ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={20} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                  <div>
                    {/* Deliberately NOT "fully restored". The data was
                        applied and the health checks passed — auth
                        identities and any skipped tables are separate,
                        and are listed below so this cannot be read as a
                        complete system recovery. */}
                    <strong>Restore applied and verified.</strong>
                    <p style={{ fontSize: 13, marginTop: 6 }}>{wizard.result.message}</p>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <XCircle size={20} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                  <div>
                    <strong>{RESTORE_STATUS_LABEL[wizard.result.status] ?? 'Restore did not complete'}</strong>
                    <p style={{ fontSize: 13, marginTop: 6 }}>{wizard.result.message}</p>
                  </div>
                </div>
              )}
              {wizard.result.checks && (
                <div style={{ marginTop: 14 }}>
                  <ValidationChecklist checklist={wizard.result.checks} />
                </div>
              )}

              {(wizard.result.skippedTables ?? []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h5 style={{ margin: '0 0 6px', fontSize: 12.5 }}>Not applied</h5>
                  {(wizard.result.skippedTables ?? []).map((s) => (
                    <div key={`${s.table}-${s.reason}`} style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      <strong>{s.table}</strong> — {s.reason.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              )}

              {(wizard.result.manualActionsRequired ?? []).length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    background: 'var(--color-surface-muted)',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <h5 style={{ margin: '0 0 6px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
                    Still required — this restore is not a complete recovery on its own
                  </h5>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
                    {(wizard.result.manualActionsRequired ?? []).map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-primary" onClick={closeWizard}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* The dedicated-password prompt. Rendered once; every protected
          operation above routes through its promise. This is a UI
          affordance only — the enforcement is server-side. */}
      {authElement}
    </div>
  );
}

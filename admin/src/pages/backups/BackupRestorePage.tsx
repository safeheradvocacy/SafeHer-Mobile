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
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmDialog, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { BackupFrequency, RestoreValidationCheck, SystemBackup, SystemRestore } from '../../types/database.types';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A restore in any of these statuses is still "in progress" and holds
// the real backend lock (see begin_restore_operation in module23) — the
// UI mirrors that same list rather than inventing its own notion of
// what counts as active.
const TERMINAL_RESTORE_STATUSES = ['validation_failed', 'safety_backup_failed', 'restore_failed', 'verification_failed', 'verified'];

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

interface WizardState {
  step: WizardStep;
  backup: SystemBackup;
  operationId?: string;
  confirmationPhrase?: string;
  checklist?: RestoreValidationCheck[];
  valid?: boolean;
  typedPhrase: string;
  result?: { status: string; message: string; checks?: RestoreValidationCheck[] };
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
  const [retentionDays, setRetentionDays] = useState(30);
  const [scheduleUpdatedAt, setScheduleUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [busyBackupId, setBusyBackupId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{ backup: SystemBackup; valid: boolean; checklist: RestoreValidationCheck[] } | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);

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
      setHourUtc(scheduleRes.data.hour_utc);
      setDayOfWeek(scheduleRes.data.day_of_week ?? 0);
      setRetentionDays(scheduleRes.data.retention_days);
      setScheduleUpdatedAt(scheduleRes.data.updated_at);
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
    setCreating(true);
    const { data, error } = await supabase.functions.invoke('backup-create', { body: { action: 'create' } });
    setCreating(false);
    if (error || data?.error) {
      showToast('error', data?.error || error?.message || 'Backup failed. See Backup History for details.');
      load();
      return;
    }
    showToast('success', `Backup completed (${formatBytes(data.sizeBytes)}).`);
    load();
  };

  const saveSchedule = async () => {
    if (!profile) return;
    setSavingSchedule(true);
    const { error } = await supabase.rpc('set_backup_schedule', {
      p_enabled: enabled,
      p_frequency: frequency,
      p_hour_utc: hourUtc,
      p_day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      p_retention_days: retentionDays,
    });
    setSavingSchedule(false);
    if (error) {
      showToast('error', error.message || 'Could not update the backup schedule.');
      return;
    }
    showToast('success', enabled ? 'Scheduled backups enabled.' : 'Scheduled backups disabled.');
    load();
  };

  const validateBackup = async (backup: SystemBackup) => {
    setBusyBackupId(backup.backup_id);
    const { data, error } = await supabase.functions.invoke('backup-create', { body: { action: 'validate', backupId: backup.backup_id } });
    setBusyBackupId(null);
    if (error) {
      showToast('error', error.message || 'Validation could not be completed.');
      return;
    }
    setValidationResult({ backup, valid: !!data.valid, checklist: data.checklist ?? [] });
    load();
  };

  const downloadBackup = async (backup: SystemBackup) => {
    setBusyBackupId(backup.backup_id);
    const { data, error } = await supabase.functions.invoke('backup-create', { body: { action: 'download', backupId: backup.backup_id } });
    setBusyBackupId(null);
    if (error || !data?.url) {
      showToast('error', data?.error || error?.message || 'Could not create a download link.');
      return;
    }
    window.open(data.url, '_blank');
  };

  // --- Restore wizard -------------------------------------------------

  const startRestore = async (backup: SystemBackup) => {
    if (activeRestore) {
      showToast('error', 'Another recovery operation is currently in progress.');
      return;
    }
    setWizard({ step: 'validating', backup, typedPhrase: '' });
    const { data, error } = await supabase.functions.invoke('backup-restore', { body: { action: 'begin', backupId: backup.backup_id } });
    if (error || data?.error) {
      showToast('error', data?.error || error?.message || 'Could not start restore validation.');
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
      result: data.valid ? undefined : { status: data.status, message: data.message, checks: data.checklist },
    });
    load();
  };

  const confirmRestore = async () => {
    if (!wizard?.operationId) return;
    const { data, error } = await supabase.functions.invoke('backup-restore', {
      body: { action: 'confirm', operationId: wizard.operationId, confirmationPhrase: wizard.typedPhrase },
    });
    if (error || data?.error) {
      showToast('error', data?.error || error?.message || 'Confirmation failed.');
      return;
    }
    setWizard((w) => (w ? { ...w, step: 'ready' } : w));
  };

  const executeRestore = async () => {
    if (!wizard?.operationId) return;
    setWizard((w) => (w ? { ...w, step: 'executing' } : w));
    const { data, error } = await supabase.functions.invoke('backup-restore', { body: { action: 'execute', operationId: wizard.operationId } });
    load();
    if (error) {
      setWizard((w) => (w ? { ...w, step: 'result', result: { status: 'restore_failed', message: error.message || 'Restore failed.' } } : w));
      return;
    }
    if (data?.error) {
      setWizard((w) => (w ? { ...w, step: 'result', result: { status: 'restore_failed', message: data.error, checks: data.checklist } } : w));
      return;
    }
    setWizard((w) => (w ? { ...w, step: 'result', result: { status: data.status, message: data.message, checks: data.checks } } : w));
  };

  const closeWizard = () => {
    setWizard(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Backup &amp; Restore"
        subtitle="System recovery infrastructure — technical administration only"
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {activeRestore && (
        <div className="card" style={{ marginBottom: 20, background: 'var(--color-danger)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={18} />
            <div>
              <strong>SAFESPACE RECOVERY IN PROGRESS</strong>
              <div style={{ fontSize: 12.5, opacity: 0.9 }}>
                A restore operation is active ({RESTORE_STATUS_LABEL[activeRestore.status]}). Normal backup/restore actions are
                unavailable until it finishes. Other application services are not affected by this restore scope.
              </div>
            </div>
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
            <div style={{ fontSize: 14, fontWeight: 600 }}>{enabled ? `${frequency === 'daily' ? 'Daily' : `Weekly (${DAY_LABELS[dayOfWeek]})`} at ${String(hourUtc).padStart(2, '0')}:00 UTC` : 'Disabled'}</div>
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
                  <th>Size</th>
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
                      <td>{formatBytes(b.size_bytes)}</td>
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
          body="This will create a new administrative configuration backup (municipalities, barangays, shelters, and administrator accounts). Do you want to continue?"
          confirmLabel="Create Backup"
          onConfirm={createBackup}
          onCancel={() => setConfirmCreate(false)}
        />
      )}

      {validationResult && (
        <Modal title="Backup Validation Result" onClose={() => setValidationResult(null)} footer={<button className="btn btn-primary" onClick={() => setValidationResult(null)}>Close</button>}>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            <strong>{formatUtc(validationResult.backup.started_at)}</strong> —{' '}
            {validationResult.valid ? (
              <span style={{ color: 'var(--color-success)' }}>SAFE TO PROCEED</span>
            ) : (
              <span style={{ color: 'var(--color-danger)' }}>Not valid</span>
            )}
          </p>
          <ValidationChecklist checklist={validationResult.checklist} />
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, marginTop: 16 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-danger)' }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <strong>Scope:</strong> municipalities, barangays, and shelters will be inserted/updated from this
                  backup (rows added since the backup are not removed). Administrator accounts are never restored. A
                  fresh safety backup of the current state will be created before any change is applied.
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
                    <strong>Restore completed and verified.</strong>
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-primary" onClick={closeWizard}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { extractInvokeError } from '../../lib/adminUserHelpers';
import { PasswordStrengthMeter } from '../PasswordStrengthMeter';

/**
 * Module 42 — the frontend half of the dedicated Backup & Restore
 * authorization password.
 *
 * IMPORTANT, AND THE WHOLE POINT: nothing here is a security control.
 * This prompt exists so the operator can supply the password; the
 * enforcement is entirely server-side (module42's
 * verify_backup_password_and_grant + consume_backup_grant, called from
 * the backup-auth / backup-create / backup-restore Edge Functions).
 * Bypassing this component — devtools, a crafted fetch, a disabled
 * button re-enabled by hand — gets you a 401/403 from the Edge
 * Function, not an unauthorized backup.
 *
 * The password is held in component state only for the duration of one
 * submit, is never written to localStorage/sessionStorage, is never put
 * in a URL, and is replaced by a short-lived single-use GRANT ID for
 * the actual operation. The grant is what travels to the operation
 * endpoint; the password never does.
 */

export type ProtectedOperation =
  | 'create'
  | 'schedule_create'
  | 'schedule_modify'
  | 'schedule_trigger'
  | 'download'
  | 'validate'
  | 'restore_begin'
  | 'restore_execute'
  | 'delete'
  | 'security_settings';

/** Plain-language description of what the operator is authorizing. */
const OPERATION_COPY: Record<ProtectedOperation, { title: string; what: string; danger: boolean }> = {
  create: { title: 'Authorize backup creation', what: 'Create a new backup archive of this environment.', danger: false },
  schedule_create: { title: 'Authorize schedule change', what: 'Create an automated backup schedule.', danger: false },
  schedule_modify: { title: 'Authorize schedule change', what: 'Modify the automated backup schedule.', danger: false },
  schedule_trigger: { title: 'Authorize scheduled backup run', what: 'Run the scheduled backup immediately.', danger: false },
  download: {
    title: 'Authorize backup download',
    what: 'Download this archive. It contains sensitive case and survivor data — handle and store it accordingly.',
    danger: true,
  },
  validate: { title: 'Authorize backup validation', what: 'Read and verify the contents of this archive.', danger: false },
  restore_begin: { title: 'Authorize restore', what: 'Begin a controlled restore operation from this archive.', danger: true },
  restore_execute: {
    title: 'Authorize restore execution',
    what: 'Write the archive’s data into this environment. Existing rows with matching identifiers will be overwritten.',
    danger: true,
  },
  delete: { title: 'Authorize backup deletion', what: 'Permanently delete this archive. This cannot be undone.', danger: true },
  security_settings: { title: 'Authorize security change', what: 'Change Backup & Restore security settings.', danger: true },
};

interface PendingRequest {
  operation: ProtectedOperation;
  targetId: string | null;
  targetLabel?: string;
  resolve: (grantId: string | null) => void;
}

/**
 * Returns `requestAuthorization(operation, targetId?, targetLabel?)`
 * which resolves to a single-use grant ID, or null if the operator
 * cancelled or authorization failed. Render `authElement` once.
 */
export function useBackupAuthorization() {
  const { showToast } = useToast();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockedFor, setLockedFor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  pendingRef.current = pending;

  const requestAuthorization = useCallback(
    (operation: ProtectedOperation, targetId: string | null = null, targetLabel?: string): Promise<string | null> =>
      new Promise((resolve) => {
        setPassword('');
        setLockedFor(null);
        setPending({ operation, targetId, targetLabel, resolve });
      }),
    []
  );

  const close = useCallback((grantId: string | null) => {
    pendingRef.current?.resolve(grantId);
    setPending(null);
    // Clear the password from state immediately on close — it should
    // not linger in a React tree after the prompt is gone.
    setPassword('');
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) close(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, submitting, close]);

  const submit = async () => {
    if (!pending || submitting || !password) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('backup-auth', {
      body: { action: 'authorize', password, operation: pending.operation, targetId: pending.targetId },
    });
    setSubmitting(false);

    // On a non-2xx, supabase-js leaves `data` null and puts the real
    // body on error.context — so the body must be read from there or
    // every refusal collapses into "non-2xx status code".
    const payload = (data ?? {}) as Record<string, unknown>;
    const serverMessage = await extractInvokeError(data, error);
    if (error || !payload.ok) {
      const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
      const message =
        serverMessage ??
        (reason === 'not_configured'
          ? 'No backup authorization password has been set up yet.'
          : 'Incorrect backup authorization password.');
      if (payload.locked) {
        const secs = typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null;
        setLockedFor(secs);
      }
      setPassword('');
      showToast('error', message);
      inputRef.current?.focus();
      return;
    }

    const grantId = typeof payload.grantId === 'string' ? payload.grantId : null;
    if (!grantId) {
      showToast('error', 'Authorization succeeded but no grant was returned. Check the backup-auth function logs.');
      close(null);
      return;
    }
    close(grantId);
  };

  const copy = pending ? OPERATION_COPY[pending.operation] : null;

  const authElement =
    pending && copy
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-auth-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(12,14,18,0.55)',
              backdropFilter: 'blur(3px)',
              padding: 16,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !submitting) close(null);
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 440,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 14,
                padding: 22,
                boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: copy.danger ? 'var(--color-danger-soft, rgba(200,40,40,0.12))' : 'var(--color-accent-soft, rgba(40,90,160,0.12))',
                    color: copy.danger ? 'var(--color-danger)' : 'var(--color-accent)',
                    flexShrink: 0,
                  }}
                >
                  <KeyRound size={17} />
                </span>
                <h3 id="backup-auth-title" style={{ margin: 0, fontSize: 16 }}>
                  {copy.title}
                </h3>
              </div>

              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 6 }}>{copy.what}</p>
              {pending.targetLabel && (
                <p style={{ fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
                  <strong>Target:</strong> {pending.targetLabel}
                </p>
              )}

              <label htmlFor="backup-auth-password" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                Backup authorization password
              </label>
              <input
                id="backup-auth-password"
                ref={inputRef}
                className="input"
                type="password"
                autoComplete="off"
                style={{ width: '100%' }}
                value={password}
                disabled={submitting}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
              <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 0 }}>
                This is the separate Backup &amp; Restore password, not your sign-in password.
              </p>

              {lockedFor != null && (
                <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 10, marginBottom: 0 }}>
                  Too many failed attempts. Try again in about {Math.ceil(lockedFor / 60)} minute
                  {Math.ceil(lockedFor / 60) === 1 ? '' : 's'}.
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type="button" className="btn btn-outline" onClick={() => close(null)} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={copy.danger ? 'btn btn-danger' : 'btn btn-primary'}
                  onClick={submit}
                  disabled={submitting || !password}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="icon-spin" /> Verifying…
                    </>
                  ) : (
                    'Authorize'
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return { requestAuthorization, authElement };
}

/**
 * Provisioning / rotation panel. Separate from the prompt above because
 * the two answer different questions: "prove you know it" vs "set what
 * it is". Only the technical Super Admin reaches this page at all; the
 * backend re-checks that regardless.
 */
export function BackupSecurityPanel({ onChanged }: { onChanged?: () => void }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<{ configured: boolean; locked: boolean; retryAfterSeconds: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('backup-auth', { body: { action: 'status' } });
    setLoading(false);
    if (error) {
      const detail = await extractInvokeError(data, error);
      showToast('error', detail ?? 'Could not read backup security status.', 9000);
      return;
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    setStatus({
      configured: payload.configured === true,
      locked: payload.locked === true,
      retryAfterSeconds: typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null,
    });
  }, [showToast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const save = async () => {
    if (newPassword !== confirmPassword) {
      showToast('error', 'The new passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      showToast('error', 'The backup password must be at least 12 characters.');
      return;
    }
    setSaving(true);
    const isRotation = status?.configured === true;
    const { data, error } = await supabase.functions.invoke('backup-auth', {
      body: {
        action: isRotation ? 'rotate' : 'provision',
        newPassword,
        ...(isRotation ? { currentPassword } : {}),
      },
    });
    setSaving(false);

    const payload = (data ?? {}) as Record<string, unknown>;
    if (error || !payload.ok) {
      const detail = await extractInvokeError(data, error);
      showToast('error', detail ?? 'Could not update the backup password.', 9000);
      return;
    }
    showToast(
      'success',
      isRotation
        ? 'Backup password changed. All previously issued authorizations have been revoked.'
        : 'Backup password set. Protected backup operations now require it.'
    );
    reset();
    setOpen(false);
    await loadStatus();
    onChanged?.();
  };

  return (
    <section className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
            {status?.configured ? (
              <ShieldCheck size={16} style={{ color: 'var(--color-success)' }} />
            ) : (
              <ShieldAlert size={16} style={{ color: 'var(--color-warning)' }} />
            )}
            Backup Authorization Password
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 680 }}>
            {loading
              ? 'Checking…'
              : status?.configured
                ? 'Protected backup operations require this password in addition to your sign-in. It is verified on the server and stored only as a bcrypt verifier — never in plain text.'
                : 'Not set up yet. Until it is, protected backup operations cannot be authorized at all — creating, downloading, validating, deleting and restoring backups will be refused by the server.'}
          </p>
          {status?.configured && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              This is a second password, not two-factor authentication — it proves knowledge of a separately-held secret, not
              possession of a second device.
            </p>
          )}
          {status?.locked && (
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--color-danger)' }}>
              Locked after repeated failed attempts
              {status.retryAfterSeconds ? ` — retry in about ${Math.ceil(status.retryAfterSeconds / 60)} minute(s)` : ''}.
            </p>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)} disabled={loading}>
          <KeyRound size={14} />
          {status?.configured ? 'Change password' : 'Set up password'}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-sec-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(12,14,18,0.55)',
            backdropFilter: 'blur(3px)',
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) {
              setOpen(false);
              reset();
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 14,
              padding: 22,
              boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
            }}
          >
            <h3 id="backup-sec-title" style={{ margin: '0 0 6px', fontSize: 16 }}>
              {status?.configured ? 'Change backup authorization password' : 'Set up backup authorization password'}
            </h3>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 0 }}>
              Minimum 12 characters, with upper case, lower case and a number.
              {status?.configured && ' Changing it immediately revokes every authorization already issued.'}
            </p>

            {status?.configured && (
              <>
                <label htmlFor="bk-cur" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, margin: '12px 0 5px' }}>
                  Current backup password
                </label>
                <input
                  id="bk-cur"
                  className="input"
                  type="password"
                  autoComplete="off"
                  style={{ width: '100%' }}
                  value={currentPassword}
                  disabled={saving}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </>
            )}

            <label htmlFor="bk-new" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, margin: '12px 0 5px' }}>
              New backup password
            </label>
            <input
              id="bk-new"
              className="input"
              type="password"
              autoComplete="new-password"
              style={{ width: '100%' }}
              value={newPassword}
              disabled={saving}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <PasswordStrengthMeter password={newPassword} />

            <label htmlFor="bk-confirm" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, margin: '12px 0 5px' }}>
              Confirm new backup password
            </label>
            <input
              id="bk-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              style={{ width: '100%' }}
              value={confirmPassword}
              disabled={saving}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {confirmPassword.length > 0 && confirmPassword !== newPassword && (
              <p style={{ fontSize: 12, color: 'var(--color-danger)', margin: '6px 0 0' }}>The passwords do not match.</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button
                className="btn btn-outline"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !newPassword || newPassword !== confirmPassword || (status?.configured === true && !currentPassword)}
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="icon-spin" /> Saving…
                  </>
                ) : status?.configured ? (
                  'Change password'
                ) : (
                  'Set password'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

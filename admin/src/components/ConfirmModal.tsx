import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

/**
 * Polished confirmation dialog — same fade+scale+blur language as the
 * login screen's "Are you sure you want to log in?" modal (see
 * admin/src/pages/auth/AuthPages.tsx), generalized with a neutral icon
 * slot so it can back other confirmations throughout the admin app
 * without duplicating the whole component. Deliberately separate from
 * the plain <ConfirmDialog> in components/ui.tsx, which many other admin
 * screens already use for lower-stakes confirmations (deletes, status
 * changes) — changing that shared, widely-used component wasn't part of
 * this pass.
 *
 * `requirePhrase` adds a type-to-confirm gate for the small set of
 * genuinely high-risk actions (danger zone) — the Confirm button stays
 * disabled until the input exactly matches. Reserve this for actions
 * that are hard/impossible to undo; ordinary confirmations should not
 * use it (extra typing for a low-risk action just trains people to type
 * without reading).
 */
export function ConfirmModal({
  open,
  icon,
  title,
  description,
  confirmLabel,
  loadingLabel,
  cancelLabel = 'Cancel',
  loading = false,
  danger = false,
  requirePhrase,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  loadingLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  danger?: boolean;
  requirePhrase?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const phraseInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [typedPhrase, setTypedPhrase] = useState('');

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setTypedPhrase('');
      // Focus the phrase input when present (so typing can start right
      // away); otherwise the primary action, matching the plain variant.
      (requirePhrase ? phraseInputRef.current : confirmBtnRef.current)?.focus();
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const phraseSatisfied = !requirePhrase || typedPhrase === requirePhrase;

  // Portaled to <body> for the same reason as the shared <Modal> in
  // components/ui.tsx: callers on route pages render this inside
  // .page-transition, whose entrance animation leaves a non-`none`
  // `transform` on the element at rest — which makes it (not the real
  // viewport) the containing block for this dialog's `position: fixed`.
  return createPortal(
    <div className="confirm-modal-backdrop" onMouseDown={() => !loading && onCancel()}>
      <div
        ref={modalRef}
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="confirm-modal-icon" aria-hidden="true">
          {icon}
        </div>
        <h3 id="confirm-modal-title" className="confirm-modal-title">
          {title}
        </h3>
        <p id="confirm-modal-desc" className="confirm-modal-desc">
          {description}
        </p>
        {requirePhrase && (
          <div className="type-confirm-wrap">
            <label htmlFor="confirm-modal-phrase">
              Type <code>{requirePhrase}</code> to continue
            </label>
            <input
              ref={phraseInputRef}
              id="confirm-modal-phrase"
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              disabled={loading}
            />
          </div>
        )}
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={loading || !phraseSatisfied}
            aria-busy={loading}
          >
            {loading && <Loader2 size={15} className="icon-spin" aria-hidden="true" />}
            {loading ? (loadingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

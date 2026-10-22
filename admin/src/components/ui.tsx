import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_COLORS } from '../theme/statusColors';

export function StatusBadge({ label }: { label: string }) {
  const color = STATUS_COLORS[label] ?? '#526070';
  return (
    <span className="badge" style={{ color, borderColor: color, background: color + '1A' }}>
      {label}
    </span>
  );
}

export function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional action row pinned below the scrollable body, separated by a
   * top border — e.g. Cancel + a primary submit button. Falls back to no
   * footer for modals that put their own actions inline in the body. */
  footer?: React.ReactNode;
}) {
  // Lock background scroll while a modal is open — without this, the page
  // behind the overlay can still scroll (mouse wheel / touch), which reads
  // as broken since the backdrop visually implies the page is "frozen".
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  // Rendered via a portal straight into <body>, deliberately bypassing
  // wherever in the component tree this Modal was called from. Every page
  // route renders inside .page-transition (see theme.css), which has a
  // CSS animation ending on `transform: translateY(0)` — a *non-`none`*
  // transform value, even at rest, which per spec makes that element the
  // containing block for any `position: fixed` descendant instead of the
  // real viewport. Without the portal, the modal's centering math would
  // run against .page-transition's box (offset below the top bar, not
  // spanning the sidebar) instead of the actual screen — which is exactly
  // why it rendered high/off-center despite the flexbox centering CSS
  // being correct. Portaling out from under that ancestor is the durable
  // fix (also protects against any future transformed/filtered ancestor,
  // not just this one).
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--color-text-muted)' }}>{body}</p>
    </Modal>
  );
}

export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
        Loading...
      </td>
    </tr>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24 }}>
      <div>
        <h2>{title}</h2>
        {subtitle && <p style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>{subtitle}</p>}
      </div>
      {/* marginLeft: 'auto' is load-bearing, not decorative — the
          parent's justify-content: space-between only distributes space
          between 2+ items *on the same flex line*. On a page whose
          title+subtitle is long enough to push this actions block onto
          its own wrapped line (flexWrap: wrap, above), that block
          becomes the ONLY item on that line, and space-between then has
          nothing to space it apart FROM — it renders at the line's
          start, not its end (a well-known flexbox gotcha). marginLeft:
          auto fixes that unconditionally, whether this block shares the
          title's line or has one of its own. Confirmed live: pages with
          a longer subtitle (Verifications, Case Access, FAQ Management,
          the new Police/Support Reports & Analytics pages) were
          rendering this block flush-left with a large empty gap to its
          right until this was added.
          minWidth: 0 / maxWidth: 100% is the separate fix for the
          narrow-viewport overflow this used to have — without
          minWidth: 0, a nested flex-grow child deep inside `actions`
          (the search field inside DashboardHeaderActions, which gets
          flex-basis: 100% once it wraps to its own row under 900px) can
          report an oversized "intrinsic" width that pushes this whole
          wrapper past the actual viewport. maxWidth: 100% is the hard
          backstop. flexShrink: 0 is kept — while title+actions still
          share one row, the actions group must not get squeezed by a
          long page title. */}
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minWidth: 0, maxWidth: '100%', marginLeft: 'auto' }}>{actions}</div>}
    </div>
  );
}

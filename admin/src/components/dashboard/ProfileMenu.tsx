import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ConfirmModal } from '../ConfirmModal';
import { ROLE_LABEL } from '../../lib/roleLabels';

// Settings lives here (Account settings) rather than as its own header
// icon — every dashboard already has it in the sidebar too, so this is
// a second, equally-standard entry point, not a missing one.
export function ProfileMenu() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const roleLabel = profile ? ROLE_LABEL[profile.role] : '';

  const confirmLogout = async () => {
    setLoggingOut(true);
    await signOut();
    setLoggingOut(false);
    setConfirming(false);
    navigate('/admin/login', { replace: true });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="dash-icon-btn"
        style={{ width: 'auto', padding: '0 10px 0 8px', gap: 6 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Administrator menu"
        aria-expanded={open}
      >
        <span
          style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary-light)',
            color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}
        >
          {profile?.first_name?.[0]?.toUpperCase() ?? <User size={13} />}
        </span>
        <ChevronDown size={14} style={{ transition: 'transform 180ms ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="dash-dropdown" style={{ width: 240 }} role="menu" aria-label="Administrator menu">
          <div className="dash-dropdown-header" style={{ display: 'block' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
              {profile?.first_name} {profile?.last_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{roleLabel}</div>
          </div>
          <div style={{ padding: '6px 0' }}>
            <button type="button" className="dash-profile-item" onClick={() => { setOpen(false); navigate('/admin/settings'); }}>
              <Settings size={15} /> Account settings
            </button>
            <button
              type="button"
              className="dash-profile-item danger"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
            >
              <LogOut size={15} /> Log out
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirming}
        icon={<LogOut size={20} strokeWidth={2} />}
        title="Are you sure you want to log out?"
        description="You'll need to sign in again to access the SafeSpace Administrative Portal."
        confirmLabel="Yes, Log Out"
        loadingLabel="Logging out..."
        loading={loggingOut}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmLogout}
      />
    </div>
  );
}

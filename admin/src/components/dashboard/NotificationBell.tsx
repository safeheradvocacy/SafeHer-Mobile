import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Notification } from '../../types/database.types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Self-contained (fetches and subscribes to its own data, scoped to the
// signed-in administrator's own profile_id via RLS) so every dashboard
// can mount this one component instead of each re-implementing its own
// notifications fetch — this is what actually makes "standardized
// notifications across all admin roles" true rather than six lookalike
// copies. The unread badge only pulses for a genuinely urgent unread
// alert (SOS) — routine unread counts stay still.
export function NotificationBell() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data, error: err } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .order('created_at', { ascending: false })
      .limit(8);
    if (err) {
      console.error('[NotificationBell] load:', err.message);
      setError(true);
    } else {
      setError(false);
      setNotifications(data ?? []);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`notification-bell-${profile.profile_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.profile_id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, load]);

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

  const unread = notifications.filter((n) => !n.is_read);
  const hasUrgentUnread = unread.some((n) => n.notification_type === 'SOS');

  const markRead = async (n: Notification) => {
    if (n.is_read) return;
    setNotifications((prev) => prev.map((i) => (i.notification_id === n.notification_id ? { ...i, is_read: true } : i)));
    await supabase.from('notifications').update({ is_read: true }).eq('notification_id', n.notification_id);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="dash-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread.length > 0 ? ` (${unread.length} unread)` : ''}`}
        aria-expanded={open}
      >
        <Bell size={17} strokeWidth={2} />
        {unread.length > 0 && <span className={`dash-notif-dot${hasUrgentUnread ? ' urgent' : ''}`} aria-hidden="true" />}
      </button>
      {open && (
        <div className="dash-dropdown" role="menu" aria-label="Notifications">
          <div className="dash-dropdown-header">
            <h4>Notifications</h4>
            {unread.length > 0 && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{unread.length} unread</span>}
          </div>
          <div className="dash-dropdown-list">
            {loading ? (
              <div className="dash-dropdown-empty" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={14} className="spin" /> Loading…
              </div>
            ) : error ? (
              <div className="dash-dropdown-empty" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <AlertTriangle size={14} color="var(--color-danger)" /> Unable to load notifications.
              </div>
            ) : notifications.length === 0 ? (
              <div className="dash-dropdown-empty">You're all caught up.</div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.notification_id}
                  type="button"
                  className={`dash-dropdown-item${!n.is_read ? ' unread' : ''}`}
                  onClick={() => markRead(n)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: n.notification_type === 'SOS' ? 'var(--color-danger)' : 'var(--color-primary)', textTransform: 'uppercase' }}>
                      {n.notification_type}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatDate(n.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.message}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

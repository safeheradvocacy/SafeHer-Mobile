import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, PageHeader } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { hasPermission } from '../../lib/permissions';
import type { Notification } from '../../types/database.types';

const TYPE_LABEL: Record<string, string> = {
  'Case Update': 'Case update',
  SOS: 'Emergency',
  Assignment: 'Assignment',
  Referral: 'Referral',
  Announcement: 'Announcement',
  Support: 'Support',
};

export function NotificationsPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  const markRead = async (n: Notification) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((i) => (i.notification_id === n.notification_id ? { ...i, is_read: true } : i)));
    await supabase.from('notifications').update({ is_read: true }).eq('notification_id', n.notification_id);
  };

  return (
    <div>
      <PageHeader title="Notifications" actions={<DashboardHeaderActions showSearch={hasPermission(profile?.role, 'cases.view')} lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />} />
      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : items.length === 0 ? (
          <EmptyState title="No notifications" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((n) => (
              <div
                key={n.notification_id}
                onClick={() => markRead(n)}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${n.is_read ? 'var(--color-border)' : 'var(--color-primary)'}`,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-primary)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {TYPE_LABEL[n.notification_type] ?? n.notification_type}
                  </span>
                  {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--color-danger)' }} />}
                </div>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{n.title}</div>
                <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{n.message}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

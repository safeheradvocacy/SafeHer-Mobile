import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { SOS_STATUS_FLOW, type SosAlert, type SosStatus, type UserProfile } from '../../types/database.types';

type SosWithUser = SosAlert & { user_profiles?: UserProfile };

export function SosMonitoringPage() {
  const { profile } = useAuth();
  const isProvincial = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  const [alerts, setAlerts] = useState<SosWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    let query = supabase
      .from('sos_alerts')
      .select('*, user_profiles(*)')
      .order('triggered_at', { ascending: false });

    if (!isProvincial && profile?.municipality_id) {
      query = query.eq('user_profiles.municipality_id', profile.municipality_id);
    }

    const { data } = await query;
    setAlerts((data as any) ?? []);
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('sos-monitoring')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const updateStatus = async (alert: SosWithUser, status: SosStatus) => {
    if (!profile) return;
    const update: Partial<SosAlert> = { status };
    if (status === 'Resolved') update.resolved_at = new Date().toISOString();
    await supabase.from('sos_alerts').update(update).eq('sos_id', alert.sos_id);

    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'sos_alerts',
      recordId: alert.sos_id,
      oldValues: { status: alert.status },
      newValues: { status },
    });

    await supabase.from('notifications').insert({
      profile_id: alert.profile_id,
      sos_id: alert.sos_id,
      notification_type: 'SOS',
      title: status === 'Resolved' ? 'Your SOS alert has been resolved' : 'A responder is on your alert',
      message: status === 'Resolved' ? 'Your emergency alert has been marked resolved.' : 'A municipal responder is now handling your alert.',
      is_read: false,
    });
    load();
  };

  const visible = alerts.filter((a) => (showResolved ? true : a.status !== 'Resolved'));

  return (
    <div>
      <PageHeader
        title="SOS Monitoring"
        actions={
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        }
      />

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Location</th>
              <th>Status</th>
              <th>Triggered</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No active SOS alerts" />
                </td>
              </tr>
            )}
            {visible.map((a) => {
              const next = SOS_STATUS_FLOW[a.status] ?? [];
              return (
                <tr key={a.sos_id}>
                  <td>
                    {a.user_profiles ? `${a.user_profiles.first_name} ${a.user_profiles.last_name}` : 'Unknown'}
                    {a.user_profiles?.phone_number && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{a.user_profiles.phone_number}</div>
                    )}
                  </td>
                  <td>
                    {a.location_address || `${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}`}
                    <div>
                      <a
                        href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12 }}
                      >
                        View on map
                      </a>
                    </div>
                  </td>
                  <td>
                    <StatusBadge label={a.status} />
                  </td>
                  <td>{new Date(a.triggered_at).toLocaleString()}</td>
                  <td>
                    {next.map((s) => (
                      <button key={s} className="btn btn-outline btn-sm" style={{ marginRight: 6 }} onClick={() => updateStatus(a, s)}>
                        Mark {s}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

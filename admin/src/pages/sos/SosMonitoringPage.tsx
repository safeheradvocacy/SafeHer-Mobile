import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { locationQuality } from '../../lib/geo';
import { SOS_STATUS_FLOW, type SosAlert, type SosStatus, type UserProfile } from '../../types/database.types';

type SosWithUser = SosAlert & { user_profiles?: UserProfile };

// module19: SOS alerts no longer route through law_enforcement_referrals
// at all — every active police officer already has direct, unconditional
// access (see usePoliceSosAlerts.ts, the Police Dashboard's own data
// layer), so there is nothing left for this page to "refer". The
// Acknowledged-by column below reads sos_alerts.acknowledged_by/at
// directly, the same columns the police side writes to.
export function SosMonitoringPage() {
  const { profile, roleTier } = useAuth();
  const { showToast } = useToast();
  const isProvincial = roleTier === 'province';
  const [alerts, setAlerts] = useState<SosWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [officerNames, setOfficerNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    // Explicit FK hint required (not just defense-in-depth) — sos_alerts
    // now has two FKs into user_profiles (profile_id, and acknowledged_by
    // added by module19), so a bare `user_profiles(*)` embed is ambiguous
    // and PostgREST rejects it outright (PGRST201).
    let query = supabase
      .from('sos_alerts')
      .select('*, user_profiles!sos_alerts_profile_id_fkey(*)')
      .order('triggered_at', { ascending: false });

    if (!isProvincial && profile?.municipality_id) {
      query = query.eq('user_profiles.municipality_id', profile.municipality_id);
    }

    const { data } = await query;
    const rows = (data as any) ?? [];
    setAlerts(rows);

    const officerIds = Array.from(new Set(rows.map((a: SosWithUser) => a.acknowledged_by).filter((id: string | null): id is string => !!id)));
    if (officerIds.length > 0) {
      const { data: officers } = await supabase.from('user_profiles').select('profile_id,first_name,last_name').in('profile_id', officerIds);
      const names: Record<string, string> = {};
      (officers ?? []).forEach((o: any) => {
        names[o.profile_id] = `${o.first_name} ${o.last_name}`;
      });
      setOfficerNames(names);
    } else {
      setOfficerNames({});
    }

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

  // Checks the update actually applied before telling the survivor help
  // is on the way — this used to be unconditional, which meant a status
  // change the database silently rejected (e.g. the provincial_staff
  // trigger gap fixed alongside this page, module19) still sent a false
  // "a responder is on your alert" notification. Never do that again:
  // only notify, and only log an audit entry, once the row actually
  // reflects the change.
  const updateStatus = async (alert: SosWithUser, status: SosStatus) => {
    if (!profile) return;
    const update: Partial<SosAlert> = { status };
    if (status === 'Resolved') update.resolved_at = new Date().toISOString();

    const { data, error } = await supabase.from('sos_alerts').update(update).eq('sos_id', alert.sos_id).select().single();

    if (error || !data) {
      console.error('[SosMonitoringPage] updateStatus:', error?.message);
      showToast('error', 'Could not update this alert — the change was not saved.');
      return;
    }

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
      message: status === 'Resolved' ? 'Your emergency alert has been marked resolved.' : 'A responder is now handling your alert.',
      is_read: false,
    });
    load();
  };

  const visible = alerts.filter((a) => (showResolved ? true : a.status !== 'Resolved'));
  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="SOS Monitoring"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show resolved
            </label>
            <DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
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
              <th>Acknowledged by</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6}>
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
                    {a.latitude != null && a.longitude != null ? (
                      <>
                        {a.location_address || `${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}`}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                          <a href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                            View on map
                          </a>
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                            {locationQuality(a.location_accuracy)}
                            {a.location_accuracy != null ? ` (~${Math.round(a.location_accuracy)}m)` : ''}
                            {a.location_source === 'LAST_KNOWN' ? ' · last known' : ''}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Location unavailable</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge label={a.status} />
                  </td>
                  <td>{new Date(a.triggered_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {a.acknowledged_by ? (
                      <>
                        {officerNames[a.acknowledged_by] ?? '—'}
                        {a.acknowledged_at && (
                          <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{new Date(a.acknowledged_at).toLocaleString()}</div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Not yet acknowledged</span>
                    )}
                  </td>
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

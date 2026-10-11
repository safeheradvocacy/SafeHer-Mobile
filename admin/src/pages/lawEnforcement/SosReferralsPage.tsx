import React, { useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { locationQuality } from '../../lib/geo';
import { SOS_STATUS_FLOW, type SosAlert, type SosStatus } from '../../types/database.types';
import { bucketOf, isCriticalSos, sosElapsedMinutes, sosUrgencyScore, usePoliceSosAlerts } from '../../hooks/usePoliceSosAlerts';

type Tab = 'new' | 'active' | 'completed' | 'all';

function sosReference(a: SosAlert): string {
  return `SOS-${a.sos_id.slice(0, 8).toUpperCase()}`;
}

function elapsedLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, gap: 16 }}>
      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// Direct SOS access (module19) — every active police officer sees every
// SOS alert immediately, no referral or assignment step. No severity/
// priority field is shown anywhere on this page — sos_alerts has no such
// column, so none is fabricated (see usePoliceSosAlerts's own header for
// the exact, real signals used for urgency instead). Survivor identity/
// contact fields are also deliberately absent: a police officer has no
// RLS access to user_profiles beyond its own row, and this page never
// embeds that table (see the hook's header for why).
export function SosReferralsPage() {
  const { showToast } = useToast();
  const { alerts, officerNames, loading, refreshing, lastUpdated, error, reload, acknowledge, setStatus } = usePoliceSosAlerts();
  const [tab, setTab] = useState<Tab>('new');
  const [selected, setSelected] = useState<SosAlert | null>(null);
  const [saving, setSaving] = useState(false);

  const buckets = useMemo(
    () => ({
      new: alerts.filter((a) => bucketOf(a) === 'new'),
      active: alerts.filter((a) => bucketOf(a) === 'active'),
      completed: alerts.filter((a) => bucketOf(a) === 'completed'),
    }),
    [alerts]
  );

  const visible = useMemo(() => {
    const list = tab === 'all' ? alerts : buckets[tab];
    return list.slice().sort((a, b) => sosUrgencyScore(b) - sosUrgencyScore(a));
  }, [tab, alerts, buckets]);

  const handleAcknowledge = async () => {
    if (!selected) return;
    setSaving(true);
    const err = await acknowledge(selected);
    setSaving(false);
    if (err) {
      showToast('error', 'Could not acknowledge this alert.');
      return;
    }
    showToast('success', 'Alert acknowledged.');
  };

  const handleStatus = async (status: SosStatus) => {
    if (!selected) return;
    setSaving(true);
    const err = await setStatus(selected, status);
    setSaving(false);
    if (err) {
      showToast('error', 'Could not update this alert.');
      return;
    }
    setSelected(null);
    showToast('success', `Marked ${status}.`);
  };

  return (
    <div>
      <PageHeader
        title="SOS Alerts"
        subtitle="Emergency alerts — direct access, no referral required"
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => reload(true)} />}
      />

      {error && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</p>
          <button className="btn btn-outline btn-sm" onClick={() => reload(false)}>
            Retry
          </button>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'new' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('new')}>
            New ({loading ? '–' : buckets.new.length})
          </button>
          <button className={`btn btn-sm ${tab === 'active' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('active')}>
            Active ({loading ? '–' : buckets.active.length})
          </button>
          <button className={`btn btn-sm ${tab === 'completed' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('completed')}>
            Resolved ({loading ? '–' : buckets.completed.length})
          </button>
          <button className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('all')}>
            All ({loading ? '–' : alerts.length})
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={tab === 'new' ? 'No new SOS alerts' : tab === 'active' ? 'Nothing active' : tab === 'completed' ? 'No resolved alerts yet' : 'No SOS alerts'}
            subtitle={tab === 'new' ? 'New emergency alerts appear here immediately, most urgent first.' : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Triggered</th>
                  <th>Elapsed</th>
                  <th>Acknowledged by</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.sos_id}>
                    <td>
                      <strong style={{ fontSize: 13 }}>{sosReference(a)}</strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {isCriticalSos(a) && <StatusBadge label="Critical" />}
                        <StatusBadge label={a.status} />
                      </div>
                    </td>
                    <td>{new Date(a.triggered_at).toLocaleString()}</td>
                    <td>{elapsedLabel(sosElapsedMinutes(a))}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {a.acknowledged_by ? (officerNames[a.acknowledged_by] ?? '—') : (
                        <span style={{ color: 'var(--color-text-muted)' }}>Not yet acknowledged</span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => setSelected(a)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Modal
          title={sosReference(selected)}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSelected(null)} disabled={saving}>
                Close
              </button>
              {!selected.acknowledged_by && (
                <button className="btn btn-outline" onClick={handleAcknowledge} disabled={saving}>
                  Acknowledge
                </button>
              )}
              {SOS_STATUS_FLOW[selected.status].map((next) => (
                <button key={next} className="btn btn-primary" disabled={saving} onClick={() => handleStatus(next)}>
                  Mark {next}
                </button>
              ))}
            </>
          }
        >
          <h4 style={{ marginBottom: 4, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
            SOS Information
          </h4>
          <Field label="Reference" value={sosReference(selected)} />
          <Field label="Status" value={<StatusBadge label={selected.status} />} />
          <Field label="Critical" value={isCriticalSos(selected) ? 'Yes — no responder yet' : 'No'} />
          <Field label="Triggered" value={new Date(selected.triggered_at).toLocaleString()} />
          <Field label="Elapsed" value={elapsedLabel(sosElapsedMinutes(selected))} />

          <h4 style={{ margin: '16px 0 4px', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
            Location
          </h4>
          {selected.latitude != null && selected.longitude != null ? (
            <>
              <Field label="Address" value={selected.location_address || `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`} />
              <Field
                label="Accuracy"
                value={`${locationQuality(selected.location_accuracy)}${
                  selected.location_accuracy != null ? ` (~${Math.round(selected.location_accuracy)}m)` : ''
                }${selected.location_source === 'LAST_KNOWN' ? ' · last known position' : ''}`}
              />
              <Field
                label="Map"
                value={
                  <a href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`} target="_blank" rel="noreferrer">
                    View on map
                  </a>
                }
              />
            </>
          ) : (
            <Field label="Address" value="Location unavailable" />
          )}

          <h4 style={{ margin: '16px 0 4px', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
            Response
          </h4>
          <Field
            label="Acknowledged by"
            value={selected.acknowledged_by ? (officerNames[selected.acknowledged_by] ?? '—') : 'Not yet acknowledged'}
          />
          <Field label="Acknowledged at" value={selected.acknowledged_at ? new Date(selected.acknowledged_at).toLocaleString() : '—'} />
          <Field label="Resolved at" value={selected.resolved_at ? new Date(selected.resolved_at).toLocaleString() : '—'} />
        </Modal>
      )}
    </div>
  );
}

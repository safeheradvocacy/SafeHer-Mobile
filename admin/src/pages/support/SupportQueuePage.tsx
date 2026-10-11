import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { ExpertSupportRequest, UserProfile } from '../../types/database.types';

// Manual assignment only, by design (see module6_ai_support.sql's file
// header) — automatic routing is explicitly deferred. Queue rows are
// deliberately survivor-name-free: an authorized admin can always look a
// request's survivor up via its conversation if truly needed, but the
// queue itself shouldn't surface more than priority/timing/status.
export function SupportQueuePage() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<ExpertSupportRequest[]>([]);
  const [experts, setExperts] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);

  const [assigning, setAssigning] = useState<ExpertSupportRequest | null>(null);
  const [selectedExpertId, setSelectedExpertId] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [reqRes, expRes] = await Promise.all([
      supabase.from('expert_support_requests').select('*').order('requested_at', { ascending: false }),
      supabase.from('user_profiles').select('*').eq('role', 'support_expert').eq('is_active', true).order('first_name'),
    ]);
    setRequests(reqRes.data ?? []);
    setExperts(expRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('support-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expert_support_requests' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const stats = {
    waiting: requests.filter((r) => r.status === 'WAITING_FOR_EXPERT').length,
    assigned: requests.filter((r) => r.status === 'EXPERT_ASSIGNED').length,
    active: requests.filter((r) => r.status === 'EXPERT_ACTIVE').length,
    closedToday: requests.filter((r) => r.status === 'CLOSED' && r.closed_at && new Date(r.closed_at).toDateString() === new Date().toDateString()).length,
  };

  const openAssign = (r: ExpertSupportRequest) => {
    setAssigning(r);
    setSelectedExpertId(r.assigned_expert_id ?? '');
    setAssignError(null);
  };

  const submitAssign = async () => {
    if (!assigning || !selectedExpertId) {
      setAssignError('Please select an expert.');
      return;
    }
    setSaving(true);
    setAssignError(null);
    const { error } = await supabase
      .from('expert_support_requests')
      .update({ assigned_expert_id: selectedExpertId, status: 'EXPERT_ASSIGNED' })
      .eq('request_id', assigning.request_id);
    setSaving(false);
    if (error) {
      setAssignError(error.message || 'Could not assign this expert.');
      return;
    }
    setAssigning(null);
    showToast('success', 'Expert assigned. The survivor has been notified.');
    load();
  };

  const expertName = (id: string | null) => {
    if (!id) return '—';
    const e = experts.find((x) => x.profile_id === id);
    return e ? `${e.first_name} ${e.last_name}` : 'Assigned expert';
  };

  const visible = requests.filter((r) => (showClosed ? true : r.status !== 'CLOSED'));

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="Expert Support Queue"
        subtitle="Confidential survivor requests for human support"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              Show closed
            </label>
            <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Waiting for expert" value={loading ? '–' : stats.waiting} accent="#C98A3B" />
        <StatCard label="Assigned" value={loading ? '–' : stats.assigned} accent="#4C7EA8" />
        <StatCard label="Active conversations" value={loading ? '–' : stats.active} accent="#2F80C9" />
        <StatCard label="Closed today" value={loading ? '–' : stats.closedToday} accent="#4A8C6F" />
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : visible.length === 0 ? (
          <EmptyState title="No support requests" subtitle="New requests will appear here in real time." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Priority</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Assigned Expert</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.request_id}>
                    <td>#{r.request_id.slice(0, 8).toUpperCase()}</td>
                    <td>
                      <StatusBadge label={r.priority} />
                    </td>
                    <td>{new Date(r.requested_at).toLocaleString()}</td>
                    <td>
                      <StatusBadge label={r.status.replace(/_/g, ' ')} />
                    </td>
                    <td>{expertName(r.assigned_expert_id)}</td>
                    <td className="table-actions-cell">
                      {(r.status === 'WAITING_FOR_EXPERT' || r.status === 'EXPERT_ASSIGNED') && (
                        <button className="btn btn-outline btn-sm" onClick={() => openAssign(r)}>
                          {r.status === 'WAITING_FOR_EXPERT' ? 'Assign Expert' : 'Reassign'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assigning && (
        <Modal
          title="Assign a SafeSpace support expert"
          onClose={() => setAssigning(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setAssigning(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitAssign} disabled={saving}>
                {saving ? 'Assigning...' : 'Assign'}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Only accounts with the Support Expert role are eligible. The survivor will be notified once assigned.
          </p>
          {experts.length === 0 ? (
            <EmptyState title="No support experts available" subtitle="Create a Support Expert account under Administrator Management first." />
          ) : (
            <div className="field">
              <label className="label">Support expert</label>
              <select className="input" value={selectedExpertId} onChange={(e) => setSelectedExpertId(e.target.value)} disabled={saving}>
                <option value="">Select an expert</option>
                {experts.map((e) => (
                  <option key={e.profile_id} value={e.profile_id}>
                    {e.first_name} {e.last_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {assignError && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 12 }}>{assignError}</p>}
        </Modal>
      )}
    </div>
  );
}

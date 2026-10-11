import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { CaseClientLink, UserProfile } from '../../types/database.types';

// Same shape convention as VerificationQueuePage.tsx — one row per
// request, joined to the requesting client's profile. RLS
// (admin_can_access_case_active) already scopes this to the caller's
// own jurisdiction, so no client-side filter is needed for that.
type QueueRow = CaseClientLink & {
  user_profiles: Pick<UserProfile, 'first_name' | 'last_name'> | null;
};

const LINK_STATUS_LABEL: Record<string, string> = { pending: 'Pending Review', verified: 'Verified', rejected: 'Rejected' };

export function CaseAccessQueuePage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDecided, setShowDecided] = useState(false);

  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('case_client_links')
      .select('*, user_profiles!case_client_links_profile_id_fkey(first_name,last_name)')
      .order('requested_at', { ascending: false });
    setRows((data as QueueRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('case-access-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_client_links' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const stats = {
    pending: rows.filter((r) => r.status === 'pending').length,
    verifiedToday: rows.filter((r) => r.status === 'verified' && r.reviewed_at && new Date(r.reviewed_at).toDateString() === new Date().toDateString()).length,
    rejectedToday: rows.filter((r) => r.status === 'rejected' && r.reviewed_at && new Date(r.reviewed_at).toDateString() === new Date().toDateString()).length,
  };

  const approve = async (r: QueueRow) => {
    if (!profile) return;
    const { error } = await supabase
      .from('case_client_links')
      .update({ status: 'verified', reviewed_at: new Date().toISOString(), reviewed_by: profile.profile_id })
      .eq('link_id', r.link_id);
    if (error) {
      showToast('error', error.message || 'Could not approve this request.');
      return;
    }
    showToast('success', 'Case access approved. The client has been notified.');
    load();
  };

  const openReject = (r: QueueRow) => {
    setRejecting(r);
    setRejectReason('');
    setRejectError(null);
  };

  const submitReject = async () => {
    if (!rejecting || !profile) return;
    if (!rejectReason.trim()) {
      setRejectError('Please provide a reason for rejecting this request.');
      return;
    }
    setSaving(true);
    setRejectError(null);
    const { error } = await supabase
      .from('case_client_links')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.profile_id,
        rejection_reason: rejectReason.trim(),
      })
      .eq('link_id', rejecting.link_id);
    setSaving(false);
    if (error) {
      setRejectError(error.message || 'Could not reject this request.');
      return;
    }
    setRejecting(null);
    showToast('success', 'Request rejected. The client has been notified.');
    load();
  };

  const visible = rows.filter((r) => (showDecided ? true : r.status === 'pending'));

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="Case Access Verification"
        subtitle="Review clients requesting access to a case via their Client Case Access QR"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} />
              Show reviewed
            </label>
            <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Pending review" value={loading ? '–' : stats.pending} accent="#C98A3B" />
        <StatCard label="Verified today" value={loading ? '–' : stats.verifiedToday} accent="#4A8C6F" />
        <StatCard label="Rejected today" value={loading ? '–' : stats.rejectedToday} accent="#C4485B" />
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : visible.length === 0 ? (
          <EmptyState title="No case access requests" subtitle="New requests will appear here in real time." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Client Account</th>
                  <th>Case Reference</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.link_id}>
                    <td>{r.user_profiles ? `${r.user_profiles.first_name} ${r.user_profiles.last_name}` : '—'}</td>
                    <td>
                      <Link to={`/admin/cases/${r.case_id}`}>{r.case_number}</Link>
                    </td>
                    <td>{new Date(r.requested_at).toLocaleString()}</td>
                    <td>
                      <StatusBadge label={LINK_STATUS_LABEL[r.status] ?? r.status} />
                    </td>
                    <td className="table-actions-cell" style={{ display: 'flex', gap: 8 }}>
                      {r.status === 'pending' && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => approve(r)}>
                            Verify
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => openReject(r)}>
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejecting && (
        <Modal
          title="Reject case access request"
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setRejecting(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitReject} disabled={saving}>
                {saving ? 'Rejecting...' : 'Reject'}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Please provide a reason for rejecting this request. The client will see this reason and may request access again.
          </p>
          <div className="field">
            <label className="label">Rejection reason</label>
            <textarea
              className="input"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={saving}
            />
          </div>
          {rejectError && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 12 }}>{rejectError}</p>}
        </Modal>
      )}
    </div>
  );
}

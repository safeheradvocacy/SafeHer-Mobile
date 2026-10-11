import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { UserVerification, UserProfile } from '../../types/database.types';

// One row per submission attempt, joined to the submitting profile.
// The FK to user_profiles must be disambiguated (user_verifications has
// two FKs into user_profiles — profile_id and reviewed_by), same
// PostgREST requirement already solved for law_enforcement_referrals.
type QueueRow = UserVerification & {
  user_profiles: Pick<UserProfile, 'first_name' | 'last_name' | 'municipality_id'> | null;
};

export function VerificationQueuePage() {
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
    // RLS (admin_can_review_verification) already scopes this to the
    // caller's own municipality (or province-wide) — no client-side
    // jurisdiction filter needed, same simplicity as SupportQueuePage.
    const { data } = await supabase
      .from('user_verifications')
      .select('*, user_profiles!user_verifications_profile_id_fkey(first_name,last_name,municipality_id)')
      .order('submitted_at', { ascending: false });
    setRows((data as QueueRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('verification-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_verifications' }, () => load())
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

  const viewDocument = async (r: QueueRow) => {
    const { data } = await supabase.storage.from('identity-documents').createSignedUrl(r.document_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const approve = async (r: QueueRow) => {
    if (!profile) return;
    const { error } = await supabase
      .from('user_verifications')
      .update({ status: 'verified', reviewed_at: new Date().toISOString(), reviewed_by: profile.profile_id })
      .eq('verification_id', r.verification_id);
    if (error) {
      showToast('error', error.message || 'Could not approve this request.');
      return;
    }
    showToast('success', 'Verification approved. The user has been notified.');
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
      setRejectError('Please provide a reason for rejecting this verification request.');
      return;
    }
    setSaving(true);
    setRejectError(null);
    const { error } = await supabase
      .from('user_verifications')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.profile_id,
        rejection_reason: rejectReason.trim(),
      })
      .eq('verification_id', rejecting.verification_id);
    setSaving(false);
    if (error) {
      setRejectError(error.message || 'Could not reject this request.');
      return;
    }
    setRejecting(null);
    showToast('success', 'Verification rejected. The user has been notified.');
    load();
  };

  const visible = rows.filter((r) => (showDecided ? true : r.status === 'pending'));

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="Identity Verification"
        subtitle="Review submitted ID documents to verify survivor accounts"
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
          <EmptyState title="No verification requests" subtitle="New submissions will appear here in real time." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Document Type</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.verification_id}>
                    <td>{r.user_profiles ? `${r.user_profiles.first_name} ${r.user_profiles.last_name}` : '—'}</td>
                    <td>{r.document_type}</td>
                    <td>{new Date(r.submitted_at).toLocaleString()}</td>
                    <td>
                      <StatusBadge label={r.status === 'pending' ? 'Pending Review' : r.status === 'verified' ? 'Verified' : 'Rejected'} />
                    </td>
                    <td className="table-actions-cell" style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => viewDocument(r)}>
                        View Document
                      </button>
                      {r.status === 'pending' && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => approve(r)}>
                            Approve
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
          title="Reject verification request"
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
            Please provide a reason for rejecting this verification request. The user will see this reason and can
            resubmit.
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

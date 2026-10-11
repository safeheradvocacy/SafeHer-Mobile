import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { buildClientAccessQrSheet, buildQrSheetFilename } from '../../lib/qrSheet';
import { ConfirmDialog, Modal, StatusBadge } from '../ui';
import type { CaseAccessToken, CaseClientLink } from '../../types/database.types';

type TokenState = 'none' | 'active' | 'revoked' | 'expired';

function tokenState(t: CaseAccessToken | null): TokenState {
  if (!t) return 'none';
  if (t.revoked_at) return 'revoked';
  if (new Date(t.expires_at) < new Date()) return 'expired';
  return 'active';
}

const LINK_STATUS_LABEL: Record<string, string> = { pending: 'Pending Review', verified: 'Verified', rejected: 'Rejected' };

/**
 * "Client App Access" panel on CaseDetailPage — the admin-facing half
 * of the QR/verification workflow (module14). Every write here goes
 * through either the SECURITY DEFINER RPCs (QR generate/regenerate/
 * revoke — the raw token is NEVER available except transiently, right
 * after a successful generate/regenerate call, and is never persisted
 * client-side beyond this component's own state) or a direct
 * case_client_links UPDATE identical in shape to VerificationQueuePage's
 * existing approve/reject pattern.
 *
 * This page is only reachable by municipal_admin/barangay_admin/
 * provincial_staff (route guard) — the real enforcement for every
 * action below is the database's is_operational_case_admin() +
 * admin_can_access_case_active() checks, not this component.
 */
export function ClientAccessCard({ caseId, caseNumber, scopeLabel }: { caseId: string; caseNumber: string; scopeLabel: string }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [token, setToken] = useState<CaseAccessToken | null>(null);
  const [links, setLinks] = useState<CaseClientLink[]>([]);
  const [linkProfiles, setLinkProfiles] = useState<Record<string, { first_name: string; last_name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [rejecting, setRejecting] = useState<CaseClientLink | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    const [tokenRes, linksRes] = await Promise.all([
      supabase.from('case_access_tokens').select('*').eq('case_id', caseId).order('issued_at', { ascending: false }).limit(1),
      supabase.from('case_client_links').select('*').eq('case_id', caseId).order('requested_at', { ascending: false }),
    ]);
    setToken(tokenRes.data?.[0] ?? null);
    const linkRows = linksRes.data ?? [];
    setLinks(linkRows);

    if (linkRows.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('profile_id, first_name, last_name')
        .in(
          'profile_id',
          linkRows.map((l) => l.profile_id)
        );
      const byId: Record<string, { first_name: string; last_name: string }> = {};
      (profiles ?? []).forEach((p) => {
        byId[p.profile_id] = { first_name: p.first_name, last_name: p.last_name };
      });
      setLinkProfiles(byId);
    } else {
      setLinkProfiles({});
    }
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const state = tokenState(token);
  const caseAccessEnabled = links.some((l) => l.status === 'verified');

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('generate_case_access_token', { p_case_id: caseId });
    setBusy(false);
    if (error || !data) {
      showToast('error', error?.message || 'Could not generate the client access QR.');
      return;
    }
    setRawToken(data);
    showToast('success', 'Client access QR generated. Print or download it now.');
    load();
  };

  const regenerate = async () => {
    setConfirmRegenerate(false);
    setBusy(true);
    const { data, error } = await supabase.rpc('regenerate_case_access_token', { p_case_id: caseId });
    setBusy(false);
    if (error || !data) {
      showToast('error', error?.message || 'Could not regenerate the client access QR.');
      return;
    }
    setRawToken(data);
    showToast('success', 'A new QR was generated. The previous code is no longer valid.');
    load();
  };

  const revoke = async () => {
    setConfirmRevoke(false);
    setBusy(true);
    const { error } = await supabase.rpc('revoke_case_access_token', { p_case_id: caseId });
    setBusy(false);
    if (error) {
      showToast('error', error.message || 'Could not revoke the client access QR.');
      return;
    }
    setRawToken(null);
    showToast('success', 'The client access QR has been revoked.');
    load();
  };

  const buildSheet = async () => {
    if (!rawToken || !profile) return null;
    return buildClientAccessQrSheet({
      caseNumber,
      deepLink: `safeher://case-access/${rawToken}`,
      issuedAt: new Date(),
      issuedByName: `${profile.first_name} ${profile.last_name}`,
      scopeLabel,
    });
  };

  const printQr = async () => {
    const doc = await buildSheet();
    if (!doc) return;
    window.open(doc.output('bloburl'), '_blank');
  };

  const downloadQr = async () => {
    const doc = await buildSheet();
    if (!doc) return;
    doc.save(buildQrSheetFilename(caseNumber));
  };

  const approve = async (link: CaseClientLink) => {
    if (!profile) return;
    const { error } = await supabase
      .from('case_client_links')
      .update({ status: 'verified', reviewed_at: new Date().toISOString(), reviewed_by: profile.profile_id })
      .eq('link_id', link.link_id);
    if (error) {
      showToast('error', error.message || 'Could not approve this request.');
      return;
    }
    showToast('success', 'Case access approved. The client has been notified.');
    load();
  };

  const submitReject = async () => {
    if (!rejecting || !profile || !rejectReason.trim()) return;
    const { error } = await supabase
      .from('case_client_links')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.profile_id,
        rejection_reason: rejectReason.trim(),
      })
      .eq('link_id', rejecting.link_id);
    if (error) {
      showToast('error', error.message || 'Could not reject this request.');
      return;
    }
    setRejecting(null);
    setRejectReason('');
    showToast('success', 'Request rejected. The client has been notified.');
    load();
  };

  if (loading) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Client App Access</h3>

      <Row label="QR Status">
        <StatusBadge label={state === 'none' ? 'Not Generated' : state === 'active' ? 'Active' : state === 'revoked' ? 'Revoked' : 'Expired'} />
      </Row>
      {token && (
        <>
          <Row label="Issued">{new Date(token.issued_at).toLocaleString()}</Row>
          <Row label="Last scanned">{token.last_scanned_at ? new Date(token.last_scanned_at).toLocaleString() : 'Never'}</Row>
        </>
      )}
      <Row label="Case Access">
        <StatusBadge label={caseAccessEnabled ? 'Enabled' : 'Not Yet Available'} />
      </Row>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 }}>
        {state === 'none' && (
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy}>
            Generate Client QR
          </button>
        )}
        {state !== 'none' && (
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmRegenerate(true)} disabled={busy}>
              Regenerate QR
            </button>
            {state === 'active' && (
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                Revoke QR
              </button>
            )}
          </>
        )}
        {rawToken && (
          <>
            <button className="btn btn-outline btn-sm" onClick={printQr}>
              Print Client QR
            </button>
            <button className="btn btn-outline btn-sm" onClick={downloadQr}>
              Download QR Sheet
            </button>
          </>
        )}
      </div>
      {!rawToken && state !== 'none' && (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -8, marginBottom: 16 }}>
          The printable sheet is only available immediately after generating or regenerating — the raw code is never stored, so
          reprinting requires regenerating a new one.
        </p>
      )}

      <h4 style={{ marginBottom: 8, fontSize: 13.5 }}>Client Account</h4>
      {links.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Not linked. No client has requested access yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {links.map((l) => {
            const p = linkProfiles[l.profile_id];
            return (
              <div key={l.link_id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p ? `${p.first_name} ${p.last_name}` : 'Unknown account'}</span>
                  <StatusBadge label={LINK_STATUS_LABEL[l.status] ?? l.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Requested {new Date(l.requested_at).toLocaleString()}
                </div>
                {l.status === 'rejected' && l.rejection_reason && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Reason: {l.rejection_reason}</div>
                )}
                {l.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => approve(l)}>
                      Verify
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setRejecting(l);
                        setRejectReason('');
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmRegenerate && (
        <ConfirmDialog
          title="Regenerate client access QR?"
          body="The current QR code will stop working immediately. A new code will be generated and must be reprinted and given to the client."
          confirmLabel="Regenerate"
          onConfirm={regenerate}
          onCancel={() => setConfirmRegenerate(false)}
        />
      )}
      {confirmRevoke && (
        <ConfirmDialog
          title="Revoke client access QR?"
          body="The printed QR code will stop working immediately. The case itself is not affected, and any already-verified client account keeps its access."
          confirmLabel="Revoke"
          danger
          onConfirm={revoke}
          onCancel={() => setConfirmRevoke(false)}
        />
      )}
      {rejecting && (
        <Modal
          title="Reject case access request"
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitReject} disabled={!rejectReason.trim()}>
                Reject
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Please provide a reason. The client will see this reason and may request access again.
          </p>
          <div className="field">
            <label className="label">Rejection reason</label>
            <textarea className="input" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{children}</span>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, LoadingRow, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { SERVICE_TYPE_LABELS } from '../../lib/serviceTypes';
import type { BarangayActionRequest, BarangayRequestStatus, CaseReport, ServiceType, UserProfile, UserRole } from '../../types/database.types';

const REQUESTER_ROLE_LABEL: Partial<Record<UserRole, string>> = {
  municipal_admin: 'MSWDO (Municipal)',
  provincial_staff: 'PSWDO (Provincial)',
  law_enforcement: 'Police Officer',
};

function requestTypeLabel(requestType: string): string {
  return SERVICE_TYPE_LABELS[requestType as ServiceType] ?? requestType;
}

type TabKey = 'all' | 'pending' | 'in_progress' | 'completed' | 'closed';

const TABS: { key: TabKey; label: string; statuses: BarangayRequestStatus[] | null }[] = [
  { key: 'all', label: 'All Requests', statuses: null },
  { key: 'pending', label: 'Pending', statuses: ['Pending', 'Acknowledged'] },
  { key: 'in_progress', label: 'In Progress', statuses: ['In Progress'] },
  { key: 'completed', label: 'Completed', statuses: ['Completed'] },
  { key: 'closed', label: 'Returned or Declined', statuses: ['Returned', 'Declined', 'Cancelled'] },
];

/**
 * Barangay Admin's inbox for inter-agency action requests (module31,
 * master prompt: "Redesign Barangay Admin Access"). Deliberately shows
 * ONLY what this role needs to act: a case reference, the request
 * itself, and a response workflow — never a survivor name, narrative,
 * or evidence. RLS (barangay_action_requests' own policies) is what
 * actually restricts this to the signed-in barangay_admin's own
 * target_barangay_id; this page never applies its own barangay filter,
 * so there's nothing here for a manipulated query param to bypass.
 */
export function BarangayRequestsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const [requests, setRequests] = useState<BarangayActionRequest[]>([]);
  const [cases, setCases] = useState<Record<string, CaseReport>>({});
  const [requesters, setRequesters] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [openRequest, setOpenRequest] = useState<BarangayActionRequest | null>(null);
  const [responseNotes, setResponseNotes] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('barangay_action_requests').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[BarangayRequestsPage] load:', error.message);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoadError(false);
    const rows = data ?? [];
    setRequests(rows);

    const caseIds = Array.from(new Set(rows.map((r) => r.case_id)));
    const requesterIds = Array.from(new Set(rows.map((r) => r.requested_by)));
    const [caseRes, requesterRes] = await Promise.all([
      caseIds.length ? supabase.from('case_reports').select('*').in('case_id', caseIds) : Promise.resolve({ data: [] as CaseReport[] }),
      requesterIds.length ? supabase.from('user_profiles').select('*').in('profile_id', requesterIds) : Promise.resolve({ data: [] as UserProfile[] }),
    ]);
    setCases(Object.fromEntries((caseRes.data ?? []).map((c) => [c.case_id, c])));
    setRequesters(Object.fromEntries((requesterRes.data ?? []).map((u) => [u.profile_id, u])));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep link from a notification (module31's notify_on_barangay_
  // request_created) — only opens a request RLS already returned in
  // `requests` above; a stale/unauthorized id in the URL simply finds
  // nothing to open.
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && requests.length) {
      const match = requests.find((r) => r.request_id === openId);
      if (match) setOpenRequest(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const filtered = useMemo(() => {
    const tabDef = TABS.find((t) => t.key === tab)!;
    let rows = tabDef.statuses ? requests.filter((r) => tabDef.statuses!.includes(r.status)) : requests;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const c = cases[r.case_id];
        return (
          requestTypeLabel(r.request_type).toLowerCase().includes(q) ||
          c?.case_number?.toLowerCase().includes(q) ||
          r.request_id.toLowerCase().includes(q)
        );
      });
    }
    return rows;
  }, [requests, tab, search, cases]);

  const openDetail = (r: BarangayActionRequest) => {
    setResponseNotes(r.response_notes ?? '');
    setDeclineReason(r.decline_reason ?? '');
    setOpenRequest(r);
  };

  const transition = async (status: BarangayRequestStatus, extra: Partial<BarangayActionRequest> = {}) => {
    if (!openRequest) return;
    setSaving(true);
    const { error } = await supabase
      .from('barangay_action_requests')
      .update({ status, ...extra })
      .eq('request_id', openRequest.request_id);
    setSaving(false);
    if (error) {
      console.error('[BarangayRequestsPage] transition:', error.message);
      showToast('error', 'Could not update the request. Please try again.');
      return;
    }
    showToast('success', `Request marked ${status}.`);
    setOpenRequest(null);
    load();
  };

  return (
    <div>
      <PageHeader title="Barangay Requests" subtitle="Inter-agency requests from MSWDO, PSWDO, or Police that need your barangay's action." />

      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          placeholder="Search by request type or case number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loadError ? (
          <EmptyState title="Couldn't load requests" subtitle="Check your connection and refresh the page to try again." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Case</th>
                <th>From</th>
                <th>Submitted</th>
                <th>Priority</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow colSpan={7} />}
              {!loading &&
                filtered.map((r) => {
                  const c = cases[r.case_id];
                  const requester = requesters[r.requested_by];
                  return (
                    <tr key={r.request_id}>
                      <td>{requestTypeLabel(r.request_type)}</td>
                      <td>{c?.case_number ?? '—'}</td>
                      <td>{REQUESTER_ROLE_LABEL[r.requesting_role] ?? r.requesting_role}{requester ? ` — ${requester.first_name} ${requester.last_name}` : ''}</td>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <StatusBadge label={r.priority} />
                      </td>
                      <td>
                        <StatusBadge label={r.status} />
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => openDetail(r)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
        {!loading && !loadError && filtered.length === 0 && (
          <EmptyState
            title="No barangay requests here yet"
            subtitle="Requests from MSWDO, PSWDO, or a Police Officer that need your barangay's action will appear here."
          />
        )}
      </div>

      {openRequest && (
        <Modal title={requestTypeLabel(openRequest.request_type)} onClose={() => setOpenRequest(null)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <StatusBadge label={openRequest.status} />
            <StatusBadge label={openRequest.priority} />
          </div>

          <Field label="Request reference" value={openRequest.request_id} />
          <Field label="Related case" value={cases[openRequest.case_id]?.case_number ?? '—'} />
          <Field
            label="Requesting agency"
            value={`${REQUESTER_ROLE_LABEL[openRequest.requesting_role] ?? openRequest.requesting_role}${
              requesters[openRequest.requested_by] ? ` — ${requesters[openRequest.requested_by].first_name} ${requesters[openRequest.requested_by].last_name}` : ''
            }`}
          />
          <Field label="Submitted" value={new Date(openRequest.created_at).toLocaleString()} />
          {openRequest.notes && <Field label="Requested action" value={openRequest.notes} />}

          {(openRequest.status === 'Completed' || openRequest.status === 'Declined' || openRequest.status === 'Returned') && (
            <div style={{ marginTop: 12 }}>
              <span className="label">{openRequest.status === 'Declined' ? 'Reason declined' : 'Response'}</span>
              <p>{openRequest.status === 'Declined' ? openRequest.decline_reason : openRequest.response_notes}</p>
            </div>
          )}

          {(openRequest.status === 'Pending' || openRequest.status === 'Acknowledged' || openRequest.status === 'In Progress') && (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <label className="label">Response notes</label>
                <textarea className="input" rows={3} value={responseNotes} onChange={(e) => setResponseNotes(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Decline reason (required only if declining)</label>
                <input className="input" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              </div>

              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                Completing this request does not issue a {requestTypeLabel(openRequest.request_type)} on its own and does not close the
                related case — it records that your barangay's part is done.
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {openRequest.status === 'Pending' && (
                  <button className="btn btn-primary" disabled={saving} onClick={() => transition('Acknowledged', { response_notes: responseNotes.trim() || null })}>
                    Acknowledge
                  </button>
                )}
                {openRequest.status === 'Acknowledged' && (
                  <button className="btn btn-primary" disabled={saving} onClick={() => transition('In Progress', { response_notes: responseNotes.trim() || null })}>
                    Start Processing
                  </button>
                )}
                {openRequest.status === 'In Progress' && (
                  <button
                    className="btn btn-primary"
                    disabled={saving || !responseNotes.trim()}
                    onClick={() => transition('Completed', { response_notes: responseNotes.trim() })}
                  >
                    Mark Completed
                  </button>
                )}
                {openRequest.status !== 'Pending' && (
                  <button
                    className="btn btn-outline"
                    disabled={saving}
                    onClick={() => transition('Returned', { response_notes: responseNotes.trim() || null })}
                  >
                    Return for Clarification
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  disabled={saving || !declineReason.trim()}
                  onClick={() => transition('Declined', { decline_reason: declineReason.trim() })}
                >
                  Decline
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, gap: 12 }}>
      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

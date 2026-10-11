import React, { useState } from 'react';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useShelterAdminData, HIGH_PRIORITY_URGENCY, type SelectedShelterItem, type PipelineItem } from '../../hooks/useShelterAdminData';
import { SHELTER_REQUEST_STATUS_FLOW, REFERRAL_STATUS_FLOW, type ShelterRequestStatus, type ReferralStatus } from '../../types/database.types';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type StatusFilter = 'all' | 'pending' | 'high' | 'active' | 'completed';
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'high', label: 'High Priority' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

type SourceFilter = 'all' | 'request' | 'referral';
const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All sources' },
  { key: 'request', label: 'Incoming Requests' },
  { key: 'referral', label: 'Agency Referrals' },
];

// Requests & Referrals — the master prompt's recommended nav lists
// "Incoming Requests" and "Agency Referrals" as two separate pages, but
// also explicitly allows one combined page with a source filter "if
// survivor requests and agency referrals already share one workflow and
// cannot be safely separated without duplicating functionality." They
// do here: shelter_requests and shelter_referrals were already unified
// into one unreadable table/filter/search/review-modal set on the old
// dashboard (one PipelineItem projection, one Modal that branches on
// `kind`). Splitting that into two pages would mean two copies of the
// same filter bar, search box, and review modal — exactly the
// duplication the brief says to avoid — so this stays one page, with a
// Source filter added alongside the existing status filters to still
// let an administrator look at just one or the other.
export function ShelterRequestsReferralsPage() {
  const { profile, shelter, requests, referrals, loading, refreshing, lastUpdated, loadError, reload, pipelineItems, updateRequestStatus, updateReferralStatus } =
    useShelterAdminData();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedShelterItem | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const openItem = (item: SelectedShelterItem) => {
    setDecisionNotes('');
    setSelected(item);
  };

  const handleStatus = async (status: ShelterRequestStatus | ReferralStatus) => {
    if (!selected) return;
    setSaving(true);
    const ok =
      selected.kind === 'request'
        ? await updateRequestStatus(selected.row, status as ShelterRequestStatus, decisionNotes)
        : await updateReferralStatus(selected.row, status as ReferralStatus, decisionNotes);
    setSaving(false);
    if (ok) setSelected(null);
  };

  const filteredItems: PipelineItem[] = pipelineItems
    .filter((i) => sourceFilter === 'all' || i.source === sourceFilter)
    .filter((i) => {
      switch (statusFilter) {
        case 'pending':
          return i.isPending;
        case 'high':
          return HIGH_PRIORITY_URGENCY.includes(i.priority);
        case 'active':
          return i.isActive;
        case 'completed':
          return i.isTerminal;
        default:
          return true;
      }
    })
    .filter((i) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return i.displayId.toLowerCase().includes(q) || i.title.toLowerCase().includes(q);
    });

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Requests & Referrals" />
        <EmptyState title="No shelter assigned" subtitle="Contact your provincial administrator to have a shelter assigned to your account." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Requests & Referrals"
        subtitle={shelter?.shelter_name}
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => reload(true)} />}
      />

      {loadError && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{loadError}</p>
          <button className="btn btn-outline btn-sm" onClick={() => reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h3>Requests &amp; Referrals</h3>
          <input
            className="input"
            placeholder="Search by ID or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {SOURCE_FILTERS.map((f) => (
            <button key={f.key} className={`btn btn-sm ${sourceFilter === f.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSourceFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} className={`btn btn-sm ${statusFilter === f.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatusFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title={requests.length === 0 && referrals.length === 0 ? 'No requests or referrals yet' : 'Nothing matches this filter'}
            subtitle={requests.length === 0 && referrals.length === 0 ? 'New survivor requests and agency referrals will appear here as they arrive.' : 'Try a different filter or clear your search.'}
          />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Source</th>
                  <th>Priority</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((i) => (
                  <tr key={i.key}>
                    <td>{i.displayId}</td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{i.source === 'request' ? 'Direct Survivor' : 'Agency Referral'}</td>
                    <td>
                      <StatusBadge label={i.priority} />
                    </td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{timeAgo(i.receivedAt)}</td>
                    <td>
                      <StatusBadge label={i.statusLabel} />
                    </td>
                    <td className="table-actions-cell">
                      <button className="btn btn-outline btn-sm" onClick={() => openItem(i.item)}>
                        Review
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
          title={selected.kind === 'request' ? 'Direct shelter request' : 'Official agency referral'}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSelected(null)} disabled={saving}>
                Close
              </button>
              {(selected.kind === 'request' ? SHELTER_REQUEST_STATUS_FLOW[selected.row.status] : REFERRAL_STATUS_FLOW[selected.row.referral_status]).map(
                (next) => (
                  <button
                    key={next}
                    className={next === 'Declined' || next === 'Cancelled' ? 'btn btn-danger' : 'btn btn-primary'}
                    disabled={saving}
                    onClick={() => handleStatus(next)}
                  >
                    Mark {next}
                  </button>
                )
              )}
            </>
          }
        >
          {selected.kind === 'request' ? (
            <>
              <Field label="Requested by" value={selected.row.contact_name} />
              <Field label="Contact preference" value={selected.row.contact_preference ?? '—'} />
              <Field label="People" value={`${selected.row.people_count} (${selected.row.children_count} children)`} />
              <Field label="Urgency" value={selected.row.urgency} />
              <Field label="Status" value={selected.row.status} />
              <div style={{ marginTop: 12 }}>
                <span className="label">Message from survivor</span>
                <p>{selected.row.message || '—'}</p>
              </div>
            </>
          ) : (
            <>
              <Field label="Case #" value={selected.row.case_reports?.case_number ?? '—'} />
              <Field label="Status" value={selected.row.referral_status} />
              <div style={{ marginTop: 12 }}>
                <span className="label">Notes from referring agency</span>
                <p>{selected.row.notes || '—'}</p>
              </div>
            </>
          )}
          <div className="field" style={{ marginTop: 16 }}>
            <label className="label">Notes (optional, saved with your decision)</label>
            <textarea className="input" rows={3} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

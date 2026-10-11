import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { SERVICE_TYPE_LABELS, SERVICE_TYPE_OPTIONS } from '../../lib/serviceTypes';
import {
  REFERRAL_STATUS_FLOW,
  SERVICE_STATUS_FLOW,
  SERVICE_TERMINAL_STATUSES,
  type CaseService,
  type ReferralStatus,
  type ServiceStatus,
  type ServiceType,
} from '../../types/database.types';
import { bucketOf, useLawEnforcementReferrals, type LeReferralRow } from '../../hooks/useLawEnforcementReferrals';

type Tab = 'new' | 'active' | 'completed' | 'all';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, gap: 16 }}>
      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// Dedicated case-only queue — never mixed with SOS referrals (see
// SosReferralsPage.tsx, a separate page/route entirely). Municipality/
// barangay are shown here because case_reports.municipality_id/
// incident_barangay_id are real, direct columns on a row this officer is
// already authorized to read (module9's case_reports SELECT policy) —
// unlike sos_alerts, which carries no such column and has no
// user_profiles join available to this role (see SosReferralsPage.tsx's
// header comment), so that page omits it instead of fabricating it.
export function CaseReferralsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { caseReferrals, loading, refreshing, lastUpdated, error, reload, updateStatus, saveActionNotes } = useLawEnforcementReferrals();
  const [tab, setTab] = useState<Tab>('new');
  const [selected, setSelected] = useState<LeReferralRow | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [municipalities, setMunicipalities] = useState<Record<string, string>>({});
  const [barangays, setBarangays] = useState<Record<string, string>>({});

  // Services Provided (module27) — services recorded on the case BEFORE
  // this referral existed (and any this officer adds) are the same
  // case_services rows MSWDO's Case Details page reads; fetched fresh
  // whenever a referral is opened, scoped by the real case_id, never by
  // referral_id (case_services has no such column/relationship).
  const [services, setServices] = useState<CaseService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [newServiceType, setNewServiceType] = useState<ServiceType | ''>('');
  const [newServiceProvider, setNewServiceProvider] = useState('');
  const [newServiceScheduledDate, setNewServiceScheduledDate] = useState('');
  const [newServiceNotes, setNewServiceNotes] = useState('');
  const [savingService, setSavingService] = useState(false);

  useEffect(() => {
    if (!selected?.case_id) {
      setServices([]);
      return;
    }
    let cancelled = false;
    setServicesLoading(true);
    setServicesError(null);
    supabase
      .from('case_services')
      .select('*')
      .eq('case_id', selected.case_id)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          console.error('[CaseReferralsPage] load services:', err.message);
          setServicesError('Unable to load services for this case.');
        }
        setServices((data as CaseService[] | null) ?? []);
        setServicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.case_id]);

  const reloadServices = () => {
    if (!selected?.case_id) return;
    supabase
      .from('case_services')
      .select('*')
      .eq('case_id', selected.case_id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setServices((data as CaseService[] | null) ?? []));
  };

  const submitAddService = async () => {
    if (!profile || !selected?.case_id || !newServiceType) return;
    setSavingService(true);
    const { error: err } = await supabase.from('case_services').insert({
      case_id: selected.case_id,
      service_type: newServiceType,
      provider_agency: newServiceProvider.trim() || null,
      scheduled_date: newServiceScheduledDate || null,
      notes: newServiceNotes.trim() || null,
      created_by: profile.profile_id,
    });
    setSavingService(false);
    if (err) {
      showToast('error', 'Could not add this service.');
      return;
    }
    setAddServiceOpen(false);
    setNewServiceType('');
    setNewServiceProvider('');
    setNewServiceScheduledDate('');
    setNewServiceNotes('');
    reloadServices();
  };

  // RLS (module27) only lets this officer UPDATE a service they
  // themselves created — an MSWDO-recorded row simply has no control
  // here at all, same "hide what the backend would reject anyway"
  // convention as every other role-gated action in this app.
  const updateServiceStatus = async (service: CaseService, status: ServiceStatus) => {
    setSavingService(true);
    const { error: err } = await supabase
      .from('case_services')
      .update({ status, provided_at: status === 'Provided' ? new Date().toISOString() : service.provided_at })
      .eq('service_id', service.service_id);
    setSavingService(false);
    if (err) {
      showToast('error', 'Could not update this service.');
      return;
    }
    reloadServices();
  };

  useEffect(() => {
    supabase
      .from('municipalities')
      .select('municipality_id, municipality_name')
      .then(({ data }) => setMunicipalities(Object.fromEntries((data ?? []).map((m: any) => [m.municipality_id, m.municipality_name]))));
    supabase
      .from('barangays')
      .select('barangay_id, barangay_name')
      .then(({ data }) => setBarangays(Object.fromEntries((data ?? []).map((b: any) => [b.barangay_id, b.barangay_name]))));
  }, []);

  const buckets = useMemo(
    () => ({
      new: caseReferrals.filter((r) => bucketOf(r) === 'new'),
      active: caseReferrals.filter((r) => bucketOf(r) === 'active'),
      completed: caseReferrals.filter((r) => bucketOf(r) === 'completed'),
    }),
    [caseReferrals]
  );

  const visible = useMemo(() => {
    const list = tab === 'all' ? caseReferrals : buckets[tab];
    return list.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tab, caseReferrals, buckets]);

  const openItem = (r: LeReferralRow) => {
    setNotes(r.action_notes ?? '');
    setSelected(r);
    setAddServiceOpen(false);
    setNewServiceType('');
    setNewServiceProvider('');
    setNewServiceScheduledDate('');
    setNewServiceNotes('');
  };

  const handleStatus = async (status: ReferralStatus) => {
    if (!selected) return;
    setSaving(true);
    const err = await updateStatus(selected, status, notes);
    setSaving(false);
    if (err) {
      showToast('error', 'Could not update this referral.');
      return;
    }
    setSelected(null);
    showToast('success', `Marked ${status}.`);
  };

  const handleSaveNotes = async () => {
    if (!selected) return;
    setSaving(true);
    const err = await saveActionNotes(selected, notes);
    setSaving(false);
    if (err) {
      showToast('error', 'Could not save your notes.');
      return;
    }
    setSelected(null);
    showToast('success', 'Action notes saved.');
  };

  const actionLabel: Record<ReferralStatus, string> = { Pending: 'Pending', Accepted: 'Accept', Declined: 'Decline', Completed: 'Mark Completed' };

  return (
    <div>
      <PageHeader
        title="Case Referrals"
        subtitle="Cases referred to you for authorized review"
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
            Completed ({loading ? '–' : buckets.completed.length})
          </button>
          <button className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('all')}>
            All ({loading ? '–' : caseReferrals.length})
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={tab === 'new' ? 'No new case referrals' : tab === 'active' ? 'Nothing active' : tab === 'completed' ? 'No completed referrals yet' : 'No case referrals'}
            subtitle={tab === 'new' ? 'Cases referred to you for authorized review will appear here.' : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Type</th>
                  <th>Municipality</th>
                  <th>Priority</th>
                  <th>Referred</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.referral_id}>
                    <td>
                      <strong style={{ fontSize: 13 }}>{r.case_reports?.case_number ?? '—'}</strong>
                    </td>
                    <td>{r.case_reports?.case_type ?? '—'}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {r.case_reports?.municipality_id ? municipalities[r.case_reports.municipality_id] ?? '—' : '—'}
                      {r.case_reports?.incident_barangay_id && barangays[r.case_reports.incident_barangay_id] && (
                        <div style={{ color: 'var(--color-text-muted)' }}>{barangays[r.case_reports.incident_barangay_id]}</div>
                      )}
                    </td>
                    <td>{r.case_reports?.priority_level ? <StatusBadge label={r.case_reports.priority_level} /> : '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{timeAgo(r.created_at)}</td>
                    <td>
                      <StatusBadge label={r.status} />
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{new Date(r.updated_at).toLocaleString()}</td>
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => openItem(r)}>
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
          title={selected.case_reports?.case_number ?? 'Referred case'}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSelected(null)} disabled={saving}>
                Close
              </button>
              <button className="btn btn-outline" onClick={handleSaveNotes} disabled={saving}>
                Save notes
              </button>
              {REFERRAL_STATUS_FLOW[selected.status].map((next) => (
                <button
                  key={next}
                  className={next === 'Declined' ? 'btn btn-danger' : 'btn btn-primary'}
                  disabled={saving}
                  onClick={() => handleStatus(next)}
                >
                  {actionLabel[next]}
                </button>
              ))}
            </>
          }
        >
          <h4 style={{ marginBottom: 4, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
            Case Information
          </h4>
          <Field label="Case #" value={selected.case_reports?.case_number ?? '—'} />
          <Field label="Type" value={selected.case_reports?.case_type ?? '—'} />
          <Field label="Priority" value={selected.case_reports?.priority_level ? <StatusBadge label={selected.case_reports.priority_level} /> : '—'} />
          <Field label="Case status" value={selected.case_reports?.status ?? '—'} />
          <Field
            label="Municipality"
            value={selected.case_reports?.municipality_id ? municipalities[selected.case_reports.municipality_id] ?? '—' : '—'}
          />
          {selected.case_reports?.incident_barangay_id && (
            <Field label="Barangay" value={barangays[selected.case_reports.incident_barangay_id] ?? '—'} />
          )}
          <Field label="Incident location" value={selected.case_reports?.incident_location ?? '—'} />
          <div style={{ marginTop: 8 }}>
            <span className="label">Incident description</span>
            <p style={{ fontSize: 13 }}>{selected.case_reports?.description || '—'}</p>
          </div>

          <h4 style={{ margin: '16px 0 4px', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
            Referral
          </h4>
          <Field label="Referral status" value={<StatusBadge label={selected.status} />} />
          <Field label="Referred" value={new Date(selected.created_at).toLocaleString()} />
          <Field label="Last updated" value={new Date(selected.updated_at).toLocaleString()} />
          <div style={{ marginTop: 8 }}>
            <span className="label">Reason for referral</span>
            <p style={{ fontSize: 13 }}>{selected.reason || '—'}</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 4px' }}>
            <h4 style={{ margin: 0, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>
              Services Provided
            </h4>
            {!addServiceOpen && (
              <button className="btn btn-outline btn-sm" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => setAddServiceOpen(true)}>
                + Add Service
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Services already recorded by MSWDO for this case, plus any you add here. Only a service you add yourself
            can be updated from this view.
          </p>
          {servicesError && <p style={{ color: 'var(--color-danger)', fontSize: 12.5, marginBottom: 8 }}>{servicesError}</p>}
          {servicesLoading ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading services...</p>
          ) : services.length === 0 ? (
            <EmptyState title="No services recorded yet" subtitle="Services recorded by MSWDO for this case will appear here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
              {services.map((s) => {
                const ownRecord = s.created_by === profile?.profile_id;
                const dateLabel = s.status === 'Provided' && s.provided_at
                  ? `Provided ${new Date(s.provided_at).toLocaleDateString()}`
                  : s.scheduled_date
                    ? `Scheduled ${new Date(s.scheduled_date).toLocaleDateString()}`
                    : `Recorded ${new Date(s.created_at).toLocaleDateString()}`;
                return (
                  <div key={s.service_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 10, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>
                        {SERVICE_TYPE_LABELS[s.service_type]} ({s.service_type})
                      </span>
                      {ownRecord && SERVICE_STATUS_FLOW[s.status].length > 0 ? (
                        <select
                          className="input"
                          style={{ width: 'auto', fontSize: 12, padding: '3px 6px' }}
                          value={s.status}
                          onChange={(e) => updateServiceStatus(s, e.target.value as ServiceStatus)}
                          disabled={savingService}
                        >
                          <option value={s.status}>{s.status}</option>
                          {SERVICE_STATUS_FLOW[s.status].map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge label={s.status} />
                      )}
                    </div>
                    {s.provider_agency && <div style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>Provider: {s.provider_agency}</div>}
                    {s.notes && <div style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>{s.notes}</div>}
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>
                      {dateLabel}{!ownRecord && ' · Recorded by MSWDO'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {addServiceOpen && (
            <div className="card" style={{ background: 'var(--color-surface-muted)', marginBottom: 12 }}>
              <div className="field">
                <label className="label">Service type</label>
                <select className="input" value={newServiceType} onChange={(e) => setNewServiceType(e.target.value as ServiceType | '')}>
                  <option value="">Select a service</option>
                  {SERVICE_TYPE_OPTIONS.map((code) => (
                    <option key={code} value={code}>{SERVICE_TYPE_LABELS[code]} ({code})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">Provider / office (optional)</label>
                <input className="input" value={newServiceProvider} onChange={(e) => setNewServiceProvider(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Scheduled date (optional)</label>
                <input className="input" type="date" value={newServiceScheduledDate} onChange={(e) => setNewServiceScheduledDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} value={newServiceNotes} onChange={(e) => setNewServiceNotes(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setAddServiceOpen(false)} disabled={savingService}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={submitAddService} disabled={!newServiceType || savingService}>
                  {savingService ? 'Saving...' : 'Save service'}
                </button>
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label className="label">Action notes (your record of what was done)</label>
            <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

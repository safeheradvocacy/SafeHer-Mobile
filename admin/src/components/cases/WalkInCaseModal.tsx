import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { generateCaseNumber } from '../../lib/caseNumber';
import { Modal } from '../ui';
import type { CaseOwnerLevel, CaseType, Municipality, PriorityLevel } from '../../types/database.types';

const TYPES: CaseType[] = ['Physical Abuse', 'Psychological Abuse', 'Sexual Abuse', 'Economic Abuse', 'Stalking', 'Neglect', 'Others'];
const PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Critical'];

type ClientResult = {
  profile_id: string;
  survivor_id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  municipality_name: string | null;
  barangay_name: string | null;
};

/**
 * "Create Walk-In Case" — for a client who reports in person, before or
 * without ever using the mobile app. Only reachable from CaseListPage,
 * which is already role-gated to municipal_admin/barangay_admin/
 * provincial_staff (module11) — the real enforcement is the database's
 * "Operational admins can create walk-in cases" RLS policy (module14),
 * not this frontend check.
 *
 * Two reporter scenarios, per the approved design:
 *  - Scenario A: client already has a SafeHer account — searched via the
 *    search_clients_for_walkin RPC (never a raw survivors table query —
 *    barangay_admin cannot SELECT that table freely) and associated by
 *    survivor_id. Never creates a duplicate account.
 *  - Scenario B: no account yet — only a name/contact are captured;
 *    case_reports.survivor_id stays null until a client later scans the
 *    QR, verifies, and is approved (module14's backfill trigger).
 */
export function WalkInCaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (caseId: string) => void }) {
  const { profile, roleTier, municipality, barangay } = useAuth();
  const { showToast } = useToast();

  const [provincialMunicipalities, setProvincialMunicipalities] = useState<Municipality[]>([]);
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState('');

  const [reporterMode, setReporterMode] = useState<'existing' | 'new'>('new');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ClientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientResult | null>(null);

  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');

  const [caseType, setCaseType] = useState<CaseType | ''>('');
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [incidentDate, setIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [incidentLocation, setIncidentLocation] = useState('');
  const [description, setDescription] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (roleTier !== 'province') return;
    (async () => {
      const { data } = await supabase.from('municipalities').select('*').eq('is_active', true).order('municipality_name');
      setProvincialMunicipalities(data ?? []);
    })();
  }, [roleTier]);

  // Debounced existing-client search — mirrors the report-export
  // module's own debounce convention (short delay, cancel on unmount/
  // re-trigger) rather than searching on every keystroke.
  useEffect(() => {
    if (reporterMode !== 'existing' || search.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc('search_clients_for_walkin', { p_query: search.trim() });
      if (rpcError) {
        console.error('[WalkInCaseModal] search_clients_for_walkin:', rpcError.message);
        setSearchResults([]);
      } else {
        setSearchResults((data as ClientResult[] | null) ?? []);
      }
      setSearching(false);
    }, 350);
    return () => clearTimeout(handle);
  }, [search, reporterMode]);

  const municipalityId = roleTier === 'province' ? selectedMunicipalityId : profile?.municipality_id ?? '';
  const municipalityName =
    roleTier === 'province' ? provincialMunicipalities.find((m) => m.municipality_id === municipalityId)?.municipality_name : municipality?.municipality_name;

  const ownerLevel: CaseOwnerLevel = roleTier === 'barangay' ? 'Barangay' : 'Municipality';
  const ownerBarangayId = roleTier === 'barangay' ? barangay?.barangay_id ?? null : null;

  const submit = async () => {
    setError(null);
    if (!profile) return;
    if (!municipalityId || !municipalityName) {
      setError(roleTier === 'province' ? 'Please select a municipality.' : 'Your account has no municipality assigned.');
      return;
    }
    if (reporterMode === 'existing' && !selectedClient) {
      setError('Please search for and select the existing client, or switch to "No account yet".');
      return;
    }
    if (reporterMode === 'new' && !reporterName.trim()) {
      setError('Please enter the client’s full name.');
      return;
    }
    if (!caseType || !incidentLocation.trim() || !description.trim()) {
      setError('Case type, incident location, and description are required.');
      return;
    }
    if (roleTier === 'barangay' && !ownerBarangayId) {
      setError('Your account has no barangay assigned.');
      return;
    }

    setSaving(true);
    const caseNumber = generateCaseNumber(municipalityName);

    const { data: caseRow, error: insertErr } = await supabase
      .from('case_reports')
      .insert({
        survivor_id: reporterMode === 'existing' ? selectedClient!.survivor_id : null,
        municipality_id: municipalityId,
        case_number: caseNumber,
        case_type: caseType,
        description: description.trim(),
        incident_date: new Date(incidentDate).toISOString(),
        incident_location: incidentLocation.trim(),
        priority_level: priority,
        status: 'Pending',
        is_anonymous: false,
        owner_level: ownerLevel,
        owner_barangay_id: ownerBarangayId,
        source_channel: 'Walk-In',
        walkin_reporter_name: reporterMode === 'new' ? reporterName.trim() : null,
        walkin_reporter_contact: reporterMode === 'new' && reporterContact.trim() ? reporterContact.trim() : null,
        walkin_created_by: profile.profile_id,
      })
      .select()
      .single();

    if (insertErr || !caseRow) {
      setSaving(false);
      console.error('[WalkInCaseModal] insert case_reports:', insertErr?.message);
      setError('Could not create the walk-in case. Please try again.');
      return;
    }

    // No manual logAudit() call — trg_audit_case_reports (module3)
    // fires automatically, same convention as every other case_reports
    // write in this app.
    await supabase.from('case_status_history').insert({
      case_id: caseRow.case_id,
      changed_by: profile.profile_id,
      previous_status: null,
      new_status: 'Pending',
      remarks: 'Walk-in report created by office staff.',
    });

    setSaving(false);
    showToast('success', `Walk-in case ${caseNumber} created.`);
    onCreated(caseRow.case_id);
  };

  return (
    <Modal
      title="New Walk-In Case"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Case'}
          </button>
        </>
      }
    >
      {roleTier === 'province' && (
        <div className="field">
          <label className="label">Municipality</label>
          <select className="input" value={selectedMunicipalityId} onChange={(e) => setSelectedMunicipalityId(e.target.value)}>
            <option value="">Select a municipality</option>
            {provincialMunicipalities.map((m) => (
              <option key={m.municipality_id} value={m.municipality_id}>
                {m.municipality_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <h4 style={{ marginTop: 4, marginBottom: 8, fontSize: 13.5 }}>Client / Reporter</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={reporterMode === 'new' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => {
            setReporterMode('new');
            setSelectedClient(null);
          }}
        >
          No account yet
        </button>
        <button
          type="button"
          className={reporterMode === 'existing' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setReporterMode('existing')}
        >
          Existing SafeSpace user
        </button>
      </div>

      {reporterMode === 'new' ? (
        <>
          <div className="field">
            <label className="label">Full name</label>
            <input className="input" value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Contact number (optional)</label>
            <input className="input" value={reporterContact} onChange={(e) => setReporterContact(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="field">
          <label className="label">Search by name or phone number</label>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Juana Dela Cruz" />
          {selectedClient ? (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }}>
              <strong>
                {selectedClient.first_name} {selectedClient.last_name}
              </strong>{' '}
              — {selectedClient.phone_number ?? 'no phone on file'}
              <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 8 }} onClick={() => setSelectedClient(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              {searching && <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 6 }}>Searching...</p>}
              {searchResults.length > 0 && (
                <div style={{ marginTop: 6, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                  {searchResults.map((r) => (
                    <button
                      type="button"
                      key={r.profile_id}
                      onClick={() => {
                        setSelectedClient(r);
                        setSearchResults([]);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: 'none',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <strong>
                        {r.first_name} {r.last_name}
                      </strong>{' '}
                      — {r.phone_number ?? 'no phone'} · {r.barangay_name ?? r.municipality_name ?? '—'}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13.5 }}>Case Information</h4>
      <div className="field">
        <label className="label">Case type</label>
        <select className="input" value={caseType} onChange={(e) => setCaseType(e.target.value as CaseType)}>
          <option value="">Select a case type</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label">Priority</label>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label">Incident date</label>
        <input className="input" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Incident location</label>
        <input className="input" value={incidentLocation} onChange={(e) => setIncidentLocation(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Description</label>
        <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

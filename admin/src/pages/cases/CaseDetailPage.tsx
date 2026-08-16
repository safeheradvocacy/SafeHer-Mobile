import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import {
  CASE_STATUS_FLOW,
  type CaseAssignment,
  type CaseReport,
  type CaseStatus,
  type CaseStatusHistory,
  type Evidence,
  type Shelter,
  type ShelterReferral,
  type Survivor,
  type UserProfile,
} from '../../types/database.types';

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { profile } = useAuth();

  const [caseReport, setCaseReport] = useState<CaseReport | null>(null);
  const [survivor, setSurvivor] = useState<Survivor | null>(null);
  const [survivorProfile, setSurvivorProfile] = useState<UserProfile | null>(null);
  const [history, setHistory] = useState<CaseStatusHistory[]>([]);
  const [assignment, setAssignment] = useState<CaseAssignment | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [referrals, setReferrals] = useState<(ShelterReferral & { shelters?: Shelter })[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<CaseStatus | ''>('');
  const [remarks, setRemarks] = useState('');
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [referralShelter, setReferralShelter] = useState('');
  const [referralNotes, setReferralNotes] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!caseId) return;
    const { data: caseRow } = await supabase.from('case_reports').select('*').eq('case_id', caseId).single();
    setCaseReport(caseRow ?? null);
    if (!caseRow) {
      setLoading(false);
      return;
    }

    const [survivorRes, historyRes, assignRes, evidenceRes, referralRes, shelterRes] = await Promise.all([
      supabase.from('survivors').select('*').eq('survivor_id', caseRow.survivor_id).single(),
      supabase.from('case_status_history').select('*').eq('case_id', caseId).order('changed_at', { ascending: true }),
      supabase.from('case_assignments').select('*').eq('case_id', caseId).order('assigned_at', { ascending: false }).limit(1),
      supabase.from('evidence').select('*').eq('case_id', caseId).order('uploaded_at', { ascending: false }),
      supabase.from('shelter_referrals').select('*, shelters(*)').eq('case_id', caseId).order('referred_at', { ascending: false }),
      supabase.from('shelters').select('*').eq('municipality_id', caseRow.municipality_id).eq('is_active', true),
    ]);

    setSurvivor(survivorRes.data ?? null);
    setHistory(historyRes.data ?? []);
    setAssignment(assignRes.data?.[0] ?? null);
    setEvidence(evidenceRes.data ?? []);
    setReferrals((referralRes.data as any) ?? []);
    setShelters(shelterRes.data ?? []);

    if (survivorRes.data && !caseRow.is_anonymous) {
      const { data: sp } = await supabase.from('user_profiles').select('*').eq('profile_id', survivorRes.data.profile_id).single();
      setSurvivorProfile(sp ?? null);
    }

    const { data: staffRows } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('municipality_id', caseRow.municipality_id)
      .in('role', ['municipal_admin', 'provincial_admin'])
      .eq('is_active', true);
    setStaff(staffRows ?? []);

    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Loading case...</p>;
  if (!caseReport) return <EmptyState title="Case not found" />;

  const allowedNextStatuses = CASE_STATUS_FLOW[caseReport.status] ?? [];

  const submitStatusChange = async () => {
    if (!nextStatus || !profile) return;
    setSaving(true);
    const previousStatus = caseReport.status;

    await supabase.from('case_reports').update({ status: nextStatus }).eq('case_id', caseReport.case_id);
    const { data: historyRow } = await supabase
      .from('case_status_history')
      .insert({
        case_id: caseReport.case_id,
        changed_by: profile.profile_id,
        previous_status: previousStatus,
        new_status: nextStatus,
        remarks: remarks || null,
      })
      .select()
      .single();

    await logAudit({
      profileId: profile.profile_id,
      action: 'STATUS_CHANGE',
      tableName: 'case_reports',
      recordId: caseReport.case_id,
      oldValues: { status: previousStatus },
      newValues: { status: nextStatus },
    });

    // Notify the survivor of the update — matches the ERD's 'Case Update' notification type.
    if (survivor) {
      await supabase.from('notifications').insert({
        profile_id: survivor.profile_id,
        case_id: caseReport.case_id,
        notification_type: 'Case Update',
        title: `Case ${caseReport.case_number} updated`,
        message: `Your case status changed to "${nextStatus}".${remarks ? ` Note: ${remarks}` : ''}`,
        is_read: false,
      });
    }

    setSaving(false);
    setStatusModalOpen(false);
    setNextStatus('');
    setRemarks('');
    void historyRow;
    load();
  };

  const submitAssignment = async () => {
    if (!assignTo || !profile) return;
    setSaving(true);
    const { data: row } = await supabase
      .from('case_assignments')
      .insert({
        case_id: caseReport.case_id,
        assigned_by: profile.profile_id,
        assigned_to: assignTo,
        assignment_notes: assignNotes || null,
      })
      .select()
      .single();

    if (caseReport.status === 'Under Review') {
      await supabase.from('case_reports').update({ status: 'Assigned' }).eq('case_id', caseReport.case_id);
      await supabase.from('case_status_history').insert({
        case_id: caseReport.case_id,
        changed_by: profile.profile_id,
        previous_status: 'Under Review',
        new_status: 'Assigned',
        remarks: 'Case assigned to staff.',
      });
    }

    await logAudit({
      profileId: profile.profile_id,
      action: 'INSERT',
      tableName: 'case_assignments',
      recordId: row?.assignment_id ?? '',
      newValues: row,
    });

    await supabase.from('notifications').insert({
      profile_id: assignTo,
      case_id: caseReport.case_id,
      notification_type: 'Assignment',
      title: `Case ${caseReport.case_number} assigned to you`,
      message: assignNotes || 'You have been assigned to this case.',
      is_read: false,
    });

    setSaving(false);
    setAssignModalOpen(false);
    setAssignTo('');
    setAssignNotes('');
    load();
  };

  const submitReferral = async () => {
    if (!referralShelter || !profile) return;
    setSaving(true);
    const { data: row } = await supabase
      .from('shelter_referrals')
      .insert({
        case_id: caseReport.case_id,
        shelter_id: referralShelter,
        referred_by: profile.profile_id,
        referral_status: 'Pending',
        notes: referralNotes || null,
      })
      .select()
      .single();

    await supabase.from('case_reports').update({ status: 'Referred' }).eq('case_id', caseReport.case_id);
    await supabase.from('case_status_history').insert({
      case_id: caseReport.case_id,
      changed_by: profile.profile_id,
      previous_status: caseReport.status,
      new_status: 'Referred',
      remarks: 'Referred to a shelter.',
    });

    await logAudit({
      profileId: profile.profile_id,
      action: 'INSERT',
      tableName: 'shelter_referrals',
      recordId: row?.referral_id ?? '',
      newValues: row,
    });

    if (survivor) {
      await supabase.from('notifications').insert({
        profile_id: survivor.profile_id,
        case_id: caseReport.case_id,
        notification_type: 'Referral',
        title: 'You have been referred to a shelter',
        message: referralNotes || 'A shelter referral has been created for your case.',
        is_read: false,
      });
    }

    setSaving(false);
    setReferralModalOpen(false);
    setReferralShelter('');
    setReferralNotes('');
    load();
  };

  const submitEvidenceUpload = async () => {
    if (!uploadFile || !profile) return;
    setSaving(true);
    const path = `${caseReport.case_id}/${Date.now()}_${uploadFile.name}`;
    const { error: uploadErr } = await supabase.storage.from('evidence').upload(path, uploadFile);
    if (!uploadErr) {
      const { data: row } = await supabase
        .from('evidence')
        .insert({
          case_id: caseReport.case_id,
          uploaded_by: profile.profile_id,
          file_name: uploadFile.name,
          storage_path: path,
          mime_type: uploadFile.type || 'application/octet-stream',
          file_size: uploadFile.size,
        })
        .select()
        .single();
      await logAudit({
        profileId: profile.profile_id,
        action: 'INSERT',
        tableName: 'evidence',
        recordId: row?.evidence_id ?? '',
        newValues: row,
      });
    }
    setSaving(false);
    setUploadFile(null);
    load();
  };

  const viewEvidence = async (e: Evidence) => {
    const { data } = await supabase.storage.from('evidence').createSignedUrl(e.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  return (
    <div>
      <PageHeader
        title={caseReport.case_number}
        subtitle={caseReport.case_type}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusBadge label={caseReport.priority_level} />
            <StatusBadge label={caseReport.status} />
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Incident details</h3>
            <Field label="Incident location" value={caseReport.incident_location} />
            <Field label="Incident date" value={new Date(caseReport.incident_date).toLocaleString()} />
            <Field label="Reported" value={new Date(caseReport.reported_at).toLocaleString()} />
            <Field label="Anonymous report" value={caseReport.is_anonymous ? 'Yes' : 'No'} />
            <div style={{ marginTop: 12 }}>
              <span className="label">Description</span>
              <p>{caseReport.description}</p>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Survivor</h3>
            {caseReport.is_anonymous ? (
              <p style={{ color: 'var(--color-text-muted)' }}>This report was submitted anonymously.</p>
            ) : survivorProfile ? (
              <>
                <Field label="Name" value={`${survivorProfile.first_name} ${survivorProfile.last_name}`} />
                <Field label="Phone" value={survivorProfile.phone_number ?? '—'} />
                <Field label="Emergency contact" value={`${survivor?.emergency_contact_name ?? '—'} (${survivor?.emergency_contact_number ?? '—'})`} />
              </>
            ) : (
              <p style={{ color: 'var(--color-text-muted)' }}>Survivor details unavailable.</p>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3>Evidence</h3>
              <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                Attach file
                <input type="file" style={{ display: 'none' }} onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {uploadFile && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13 }}>{uploadFile.name}</span>
                <button className="btn btn-primary btn-sm" onClick={submitEvidenceUpload} disabled={saving}>
                  Upload
                </button>
              </div>
            )}
            {evidence.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No evidence uploaded yet.</p>
            ) : (
              <table>
                <tbody>
                  {evidence.map((e) => (
                    <tr key={e.evidence_id}>
                      <td>{e.file_name}</td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{(e.file_size / 1024).toFixed(0)} KB</td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{new Date(e.uploaded_at).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => viewEvidence(e)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Status timeline</h3>
            {history.length === 0 ? (
              <EmptyState title="No status changes yet" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {history.map((h) => (
                  <div key={h.history_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                    <div style={{ fontWeight: 600 }}>{h.new_status}</div>
                    {h.remarks && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{h.remarks}</div>}
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{new Date(h.changed_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary"
                disabled={allowedNextStatuses.length === 0}
                onClick={() => setStatusModalOpen(true)}
              >
                Update status
              </button>
              <button className="btn btn-outline" onClick={() => setAssignModalOpen(true)}>
                Assign staff
              </button>
              <button className="btn btn-outline" onClick={() => setReferralModalOpen(true)} disabled={shelters.length === 0}>
                Refer to shelter
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Assignment</h3>
            {assignment ? (
              <>
                <Field label="Assigned to" value={staff.find((s) => s.profile_id === assignment.assigned_to)?.first_name ?? '—'} />
                <Field label="Assigned" value={new Date(assignment.assigned_at).toLocaleString()} />
                {assignment.assignment_notes && <Field label="Notes" value={assignment.assignment_notes} />}
              </>
            ) : (
              <p style={{ color: 'var(--color-text-muted)' }}>Not yet assigned.</p>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Shelter referrals</h3>
            {referrals.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No referrals yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {referrals.map((r) => (
                  <div key={r.referral_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>{r.shelters?.shelter_name}</span>
                      <StatusBadge label={r.referral_status} />
                    </div>
                    {r.notes && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{r.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {statusModalOpen && (
        <Modal title="Update case status" onClose={() => setStatusModalOpen(false)}>
          <div className="field">
            <label className="label">New status</label>
            <select className="input" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as CaseStatus)}>
              <option value="">Select a status</option>
              {allowedNextStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Remarks</label>
            <textarea className="input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitStatusChange} disabled={!nextStatus || saving}>
            {saving ? 'Saving...' : 'Save status'}
          </button>
        </Modal>
      )}

      {assignModalOpen && (
        <Modal title="Assign staff" onClose={() => setAssignModalOpen(false)}>
          <div className="field">
            <label className="label">Assign to</label>
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Select staff</option>
              {staff.map((s) => (
                <option key={s.profile_id} value={s.profile_id}>
                  {s.first_name} {s.last_name} ({s.role})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Notes</label>
            <textarea className="input" rows={3} value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitAssignment} disabled={!assignTo || saving}>
            {saving ? 'Saving...' : 'Assign'}
          </button>
        </Modal>
      )}

      {referralModalOpen && (
        <Modal title="Refer to shelter" onClose={() => setReferralModalOpen(false)}>
          <div className="field">
            <label className="label">Shelter</label>
            <select className="input" value={referralShelter} onChange={(e) => setReferralShelter(e.target.value)}>
              <option value="">Select a shelter</option>
              {shelters.map((s) => (
                <option key={s.shelter_id} value={s.shelter_id}>
                  {s.shelter_name} ({s.current_occupancy}/{s.capacity})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Notes</label>
            <textarea className="input" rows={3} value={referralNotes} onChange={(e) => setReferralNotes(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitReferral} disabled={!referralShelter || saving}>
            {saving ? 'Saving...' : 'Refer'}
          </button>
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

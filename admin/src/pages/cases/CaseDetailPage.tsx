import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { LocationMap } from '../../components/maps/LocationMap';
import { ClientAccessCard } from '../../components/cases/ClientAccessCard';
import { ageAt } from '../../lib/governmentReportMapping';
import { EDUCATIONAL_ATTAINMENT_OPTIONS, SEX_OPTIONS } from '../../lib/survivorInfo';
import { SERVICE_TYPE_LABELS, SERVICE_TYPE_OPTIONS } from '../../lib/serviceTypes';
import { requiresBarangayRequest, barangayRequestTypeFor } from '../../lib/barangayRouting';
import {
  CASE_STATUS_FLOW,
  type Barangay,
  type BarangayActionRequest,
  type CaseAssignment,
  type CaseOwnerLevel,
  type CaseReferral,
  type CaseReport,
  type CaseService,
  type CaseStatus,
  type CaseStatusHistory,
  type Evidence,
  type Gender,
  type LawEnforcementReferral,
  type Municipality,
  SERVICE_STATUS_FLOW,
  SERVICE_TERMINAL_STATUSES,
  type ServiceStatus,
  type ServiceType,
  type Shelter,
  type ShelterReferral,
  type Survivor,
  type UserProfile,
} from '../../types/database.types';

const OWNER_LEVEL_LABEL: Record<CaseOwnerLevel, string> = {
  Barangay: 'Barangay',
  Municipality: 'MSWDO',
  Province: 'PSWDO',
};

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { profile, roleTier } = useAuth();

  const [caseReport, setCaseReport] = useState<CaseReport | null>(null);
  const [survivor, setSurvivor] = useState<Survivor | null>(null);
  const [survivorProfile, setSurvivorProfile] = useState<UserProfile | null>(null);
  const [history, setHistory] = useState<CaseStatusHistory[]>([]);
  const [assignment, setAssignment] = useState<CaseAssignment | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [referrals, setReferrals] = useState<(ShelterReferral & { shelters?: Shelter })[]>([]);
  const [lawEnforcementReferrals, setLawEnforcementReferrals] = useState<(LawEnforcementReferral & { user_profiles?: UserProfile })[]>([]);
  const [officers, setOfficers] = useState<UserProfile[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [caseMunicipality, setCaseMunicipality] = useState<Municipality | null>(null);
  const [caseBarangays, setCaseBarangays] = useState<Barangay[]>([]);
  const [ownershipHistory, setOwnershipHistory] = useState<CaseReferral[]>([]);
  const [services, setServices] = useState<CaseService[]>([]);
  const [barangayRequests, setBarangayRequests] = useState<BarangayActionRequest[]>([]);
  // Looked up independently rather than derived from caseBarangays (which
  // is scoped to the case's municipality_id) — a survivor's registered
  // barangay may have since diverged from that if they've updated their
  // address after filing (see module12's design notes).
  const [survivorBarangayName, setSurvivorBarangayName] = useState<string | null>(null);
  const [incidentBarangayName, setIncidentBarangayName] = useState<string | null>(null);
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
  const [leModalOpen, setLeModalOpen] = useState(false);
  const [leOfficer, setLeOfficer] = useState('');
  const [leReason, setLeReason] = useState('');
  // Set when the modal is opened to assign an officer to an EXISTING
  // (already-created, currently unassigned) referral, rather than
  // create a brand-new one — see submitLawEnforcementReferral above.
  const [assigningLeReferral, setAssigningLeReferral] = useState<LawEnforcementReferral | null>(null);
  const [escalateModalOpen, setEscalateModalOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Survivor Information edit (module21) — admin-side completion of a
  // case's survivor record (Date of Birth / Sex / Educational
  // Attainment), the fields the WEDC/CNSP government-report
  // classification actually needs. Gated to roleTier === 'province' |
  // 'municipality' further down, mirroring the new admin UPDATE RLS
  // policy exactly.
  const [survivorInfoModalOpen, setSurvivorInfoModalOpen] = useState(false);
  const [editDob, setEditDob] = useState('');
  const [editSex, setEditSex] = useState<Gender | ''>('');
  const [editEducAttainment, setEditEducAttainment] = useState('');

  // Services Provided (module22) — a case-management record of an
  // actual intervention, deliberately separate from the referral
  // tables above (a referral is "sent somewhere for possible help"; a
  // service marked 'Provided' is "this specific help actually
  // happened" — the government report only ever counts the latter).
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [newServiceType, setNewServiceType] = useState<ServiceType | ''>('');
  const [newServiceProvider, setNewServiceProvider] = useState('');
  const [newServiceNotes, setNewServiceNotes] = useState('');
  const [newServiceScheduledDate, setNewServiceScheduledDate] = useState('');
  // module31 — only relevant when newServiceType requires barangay
  // action (barangayRouting.ts); defaulted from the best available
  // real jurisdiction signal, never silently assumed, and always
  // user-confirmable from the case's OWN municipality's barangay list
  // (caseBarangays) before submission.
  const [targetBarangayId, setTargetBarangayId] = useState('');

  // module25 — editing scheduled/follow-up date and (when applicable)
  // the not-provided reason on an EXISTING service. Separate from the
  // status dropdown, which stays a one-click action.
  const [editingService, setEditingService] = useState<CaseService | null>(null);
  const [editServiceScheduledDate, setEditServiceScheduledDate] = useState('');
  const [editServiceFollowUpDate, setEditServiceFollowUpDate] = useState('');
  const [editServiceReason, setEditServiceReason] = useState('');
  const [savingServiceDetails, setSavingServiceDetails] = useState(false);

  const load = useCallback(async () => {
    if (!caseId) return;
    const { data: caseRow } = await supabase.from('case_reports').select('*').eq('case_id', caseId).single();
    setCaseReport(caseRow ?? null);
    if (!caseRow) {
      setLoading(false);
      return;
    }

    const [survivorRes, historyRes, assignRes, evidenceRes, referralRes, leReferralRes, officersRes, shelterRes, municipalityRes, barangaysRes, ownershipRes, servicesRes, barangayRequestsRes] = await Promise.all([
      // A Walk-In case with no associated account yet (Scenario B,
      // module14) has survivor_id === null — nothing to look up until a
      // client is verified and linked.
      caseRow.survivor_id
        ? supabase.from('survivors').select('*').eq('survivor_id', caseRow.survivor_id).single()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('case_status_history').select('*').eq('case_id', caseId).order('changed_at', { ascending: true }),
      supabase.from('case_assignments').select('*').eq('case_id', caseId).order('assigned_at', { ascending: false }).limit(1),
      supabase.from('evidence').select('*').eq('case_id', caseId).order('uploaded_at', { ascending: false }),
      supabase.from('shelter_referrals').select('*, shelters(*)').eq('case_id', caseId).order('referred_at', { ascending: false }),
      supabase.from('law_enforcement_referrals').select('*, user_profiles!law_enforcement_referrals_assigned_officer_id_fkey(*)').eq('case_id', caseId).order('created_at', { ascending: false }),
      supabase.from('user_profiles').select('*').eq('role', 'law_enforcement').eq('is_active', true),
      supabase.from('shelters').select('*').eq('municipality_id', caseRow.municipality_id).eq('is_active', true),
      supabase.from('municipalities').select('*').eq('municipality_id', caseRow.municipality_id).single(),
      supabase.from('barangays').select('*').eq('municipality_id', caseRow.municipality_id),
      supabase.from('case_referrals').select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
      supabase.from('case_services').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
      // module31 — RLS on this table already restricts rows to the
      // target barangay's own admin or the original requester; a
      // viewer with neither relationship simply gets zero rows back,
      // which this page renders as "no barangay requests" rather than
      // an error.
      supabase.from('barangay_action_requests').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
    ]);

    setSurvivor(survivorRes.data ?? null);
    setHistory(historyRes.data ?? []);
    setAssignment(assignRes.data?.[0] ?? null);
    setEvidence(evidenceRes.data ?? []);
    setReferrals((referralRes.data as any) ?? []);
    setLawEnforcementReferrals((leReferralRes.data as any) ?? []);
    setOfficers(officersRes.data ?? []);
    setShelters(shelterRes.data ?? []);
    setCaseMunicipality(municipalityRes.data ?? null);
    setCaseBarangays(barangaysRes.data ?? []);
    setOwnershipHistory(ownershipRes.data ?? []);
    setServices(servicesRes.data ?? []);
    setBarangayRequests(barangayRequestsRes.data ?? []);

    if (survivorRes.data && !caseRow.is_anonymous) {
      const { data: sp } = await supabase.from('user_profiles').select('*').eq('profile_id', survivorRes.data.profile_id).single();
      setSurvivorProfile(sp ?? null);
    }

    if (survivorRes.data?.barangay_id) {
      const { data: sb } = await supabase.from('barangays').select('barangay_name').eq('barangay_id', survivorRes.data.barangay_id).single();
      setSurvivorBarangayName(sb?.barangay_name ?? null);
    } else {
      setSurvivorBarangayName(null);
    }
    if (caseRow.incident_barangay_id) {
      const { data: ib } = await supabase.from('barangays').select('barangay_name').eq('barangay_id', caseRow.incident_barangay_id).single();
      setIncidentBarangayName(ib?.barangay_name ?? null);
    } else {
      setIncidentBarangayName(null);
    }

    // While a case is barangay-owned, the natural assignable pool is
    // barangay-level personnel for that specific barangay, not municipal
    // staff — matches admin_can_access_case_active's own scoping (see
    // supabase/module3_barangay_hierarchy.sql).
    let staffQuery = supabase.from('user_profiles').select('*').eq('is_active', true);
    staffQuery =
      caseRow.owner_level === 'Barangay' && caseRow.owner_barangay_id
        ? staffQuery.eq('barangay_id', caseRow.owner_barangay_id).eq('role', 'barangay_admin')
        : staffQuery.eq('municipality_id', caseRow.municipality_id).in('role', ['municipal_admin', 'provincial_admin']);
    const { data: staffRows } = await staffQuery;
    setStaff(staffRows ?? []);

    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Loading case...</p>;
  if (!caseReport) return <EmptyState title="Case not found" />;

  const allowedNextStatuses = CASE_STATUS_FLOW[caseReport.status] ?? [];

  // Only the tier that CURRENTLY owns the case may escalate it further up
  // — mirrors admin_can_access_case_active's own scoping. provincial_admin/
  // super_admin already sit at the top, so there's nowhere further up for
  // them to escalate to in Phase 1.
  const canEscalate =
    (roleTier === 'barangay' && caseReport.owner_level === 'Barangay' && caseReport.owner_barangay_id === profile?.barangay_id) ||
    (roleTier === 'municipality' && caseReport.owner_level === 'Municipality' && caseReport.municipality_id === profile?.municipality_id);

  const barangayLabel = (id: string | null) => caseBarangays.find((b) => b.barangay_id === id)?.barangay_name ?? '—';
  const ownerOrgName = (level: CaseOwnerLevel, barangayId: string | null): string => {
    if (level === 'Barangay') return `Barangay ${barangayLabel(barangayId)}`;
    if (level === 'Municipality') return caseMunicipality?.municipality_name ?? '—';
    return 'Provincial Office';
  };

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

    // No manual logAudit() call here — trg_audit_case_reports (see
    // supabase/module3_barangay_hierarchy.sql) fires automatically.

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

    // No manual logAudit() call here — trg_audit_case_assignments (see
    // supabase/module3_barangay_hierarchy.sql) fires automatically.

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

  // Inserts the case_referrals row; trg_apply_case_referral_insert (see
  // supabase/module3_barangay_hierarchy.sql) is the ONLY thing that
  // actually moves case_reports.owner_level/owner_barangay_id — this
  // never updates case_reports directly. No manual logAudit() call
  // either — trg_audit_case_referrals covers it.
  const submitEscalate = async () => {
    if (!profile || !caseReport || !canEscalate) return;
    setSaving(true);
    const toLevel: CaseOwnerLevel = roleTier === 'barangay' ? 'Municipality' : 'Province';
    const { error } = await supabase.from('case_referrals').insert({
      case_id: caseReport.case_id,
      from_level: caseReport.owner_level,
      from_barangay_id: caseReport.owner_barangay_id,
      to_level: toLevel,
      to_barangay_id: null,
      referred_by: profile.profile_id,
      reason: escalateReason || null,
      status: 'Completed',
    });
    setSaving(false);
    if (error) {
      console.error('[CaseDetailPage] submitEscalate:', error.message);
      return;
    }
    setEscalateModalOpen(false);
    setEscalateReason('');
    load();
  };

  // Survivor Information edit (module21) — fills in the fields the
  // WEDC/CNSP government-report classification needs (date_of_birth
  // drives the WEDC-vs-CNSP split; sex/educational attainment are
  // direct template columns). Reuses the survivor row already loaded
  // for this case; RLS (the new "Admins can update survivor
  // demographics in scope" policy) independently re-enforces that only
  // province-tier/same-municipality admins can actually write, so the
  // button below is a convenience gate, not the real boundary.
  const openSurvivorInfoModal = () => {
    setEditDob(survivor?.date_of_birth ?? '');
    setEditSex(survivor?.gender ?? '');
    setEditEducAttainment(survivor?.educational_attainment ?? '');
    setSurvivorInfoModalOpen(true);
  };

  const submitSurvivorInfo = async () => {
    if (!profile || !survivor) return;
    setSaving(true);
    const newDob = editDob || null;
    const { error } = await supabase
      .from('survivors')
      .update({ date_of_birth: newDob, gender: editSex || null, educational_attainment: editEducAttainment || null })
      .eq('survivor_id', survivor.survivor_id);
    setSaving(false);
    if (error) {
      console.error('[CaseDetailPage] submitSurvivorInfo:', error.message);
      return;
    }
    // Date of birth is never written to audit_logs as a literal value —
    // only whether it is now set (see module21's header comment for
    // why). Sex/Educational Attainment are logged normally.
    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'survivors',
      recordId: survivor.survivor_id,
      oldValues: { date_of_birth_set: !!survivor.date_of_birth, gender: survivor.gender, educational_attainment: survivor.educational_attainment },
      newValues: { date_of_birth_set: !!newDob, gender: editSex || null, educational_attainment: editEducAttainment || null },
    });
    setSurvivorInfoModalOpen(false);
    load();
  };

  // Services Provided (module22). RLS (admin_can_access_case_active)
  // independently re-enforces that only the case's current owning tier
  // can create/update a service record — this button is a convenience
  // gate, not the real boundary, same as every other case action here.
  const submitAddService = async () => {
    if (!profile || !caseReport || !newServiceType) return;
    const needsBarangayRequest = requiresBarangayRequest(newServiceType);
    if (needsBarangayRequest && !targetBarangayId) {
      console.error('[CaseDetailPage] submitAddService: target barangay is required for', newServiceType);
      return;
    }
    setSaving(true);
    const { data: serviceRow, error } = await supabase
      .from('case_services')
      .insert({
        case_id: caseReport.case_id,
        service_type: newServiceType,
        provider_agency: newServiceProvider.trim() || null,
        notes: newServiceNotes.trim() || null,
        scheduled_date: newServiceScheduledDate || null,
        created_by: profile.profile_id,
      })
      .select()
      .single();
    if (error || !serviceRow) {
      setSaving(false);
      console.error('[CaseDetailPage] submitAddService:', error?.message);
      return;
    }

    // module31 — route to the Barangay Requests inbox when this service
    // type genuinely requires barangay action (barangayRouting.ts is the
    // ONE place that decision is made). This LINKS to the case_services
    // row just created; it never duplicates it, and never marks
    // anything "issued" — only that a request now exists for the target
    // barangay to act on.
    if (needsBarangayRequest) {
      const { error: reqErr } = await supabase.from('barangay_action_requests').insert({
        case_id: caseReport.case_id,
        service_id: serviceRow.service_id,
        request_type: barangayRequestTypeFor(newServiceType),
        requesting_role: profile.role,
        requested_by: profile.profile_id,
        target_barangay_id: targetBarangayId,
        priority: caseReport.priority_level,
        notes: newServiceNotes.trim() || null,
      });
      if (reqErr) {
        console.error('[CaseDetailPage] submitAddService: barangay_action_requests insert failed:', reqErr.message);
      }
    }
    setSaving(false);
    setServiceModalOpen(false);
    setNewServiceType('');
    setNewServiceProvider('');
    setNewServiceNotes('');
    setNewServiceScheduledDate('');
    setTargetBarangayId('');
    load();
  };

  // module25 — statuses where "why didn't this happen" is meaningful
  // enough to prompt for a reason right away, instead of leaving it to
  // be found later via the separate Edit action.
  const NOT_PROVIDED_STATUSES: ServiceStatus[] = ['Declined', 'Cancelled', 'Unable to Provide'];

  const openEditServiceDetails = (service: CaseService) => {
    setEditServiceScheduledDate(service.scheduled_date ?? '');
    setEditServiceFollowUpDate(service.follow_up_date ?? '');
    setEditServiceReason(service.reason_not_provided ?? '');
    setEditingService(service);
  };

  const submitEditServiceDetails = async () => {
    if (!editingService) return;
    setSavingServiceDetails(true);
    const { error } = await supabase
      .from('case_services')
      .update({
        scheduled_date: editServiceScheduledDate || null,
        follow_up_date: editServiceFollowUpDate || null,
        reason_not_provided: editServiceReason.trim() || null,
      })
      .eq('service_id', editingService.service_id);
    setSavingServiceDetails(false);
    if (error) {
      console.error('[CaseDetailPage] submitEditServiceDetails:', error.message);
      return;
    }
    setEditingService(null);
    load();
  };

  // Setting status to 'Provided' is the ONLY transition that makes a
  // service count on a government report (see serviceTypes.ts's
  // isServiceProvided()) — provided_at is stamped at that exact moment,
  // never backfilled or guessed.
  const updateServiceStatus = async (service: CaseService, status: ServiceStatus) => {
    setSaving(true);
    const { error } = await supabase
      .from('case_services')
      .update({ status, provided_at: status === 'Provided' ? new Date().toISOString() : service.provided_at })
      .eq('service_id', service.service_id);
    setSaving(false);
    if (error) {
      console.error('[CaseDetailPage] updateServiceStatus:', error.message);
      return;
    }
    // Not forced — just a convenience so "why didn't this happen" is
    // easy to record at the moment it's decided, instead of only
    // discoverable later via the separate Edit action.
    if (NOT_PROVIDED_STATUSES.includes(status)) openEditServiceDetails({ ...service, status });
    load();
  };

  // CASE referrals only — SOS alerts no longer go through this table at
  // all (module19: every active police officer already has direct,
  // unconditional access to sos_alerts). RLS (admin_can_access_case_active)
  // enforces that only the case's current owning tier can create/edit a
  // law_enforcement_referrals row.
  //
  // Creating a NEW referral (assigningLeReferral === null) auto-assigns
  // the eligible, active law_enforcement officer with the fewest
  // currently-open referrals, via least_loaded_law_enforcement_officer()
  // (module26) — a narrow, RLS-bypassing lookup, the same established
  // technique as is_case_referred_to_officer() just below it, needed
  // because this admin's own RLS-visible referrals never cover every
  // officer's TRUE workload across every other admin's cases. Returns
  // null only when no active law_enforcement account exists at all; the
  // referral is still created (same "a referral can be unassigned" rule
  // this system already had — see the "Unassigned" row below), never
  // silently reported as assigned when it wasn't.
  //
  // Editing an EXISTING, still-unassigned referral (assigningLeReferral
  // set — the "Assign officer" fallback action below) keeps the manual
  // picker: that path exists specifically for the case auto-assignment
  // found nobody eligible, or for correcting an assignment later.
  //
  // Either way, trg_notify_law_enforcement_referral_created/
  // trg_notify_law_enforcement_assignment (module9/module17) notify the
  // assigned officer immediately once assigned_officer_id is set.
  const submitLawEnforcementReferral = async () => {
    if (!profile || !caseReport) return;
    setSaving(true);

    let error: { message: string } | null = null;
    if (assigningLeReferral) {
      ({ error } = await supabase
        .from('law_enforcement_referrals')
        .update({ assigned_officer_id: leOfficer || null, reason: leReason || null })
        .eq('referral_id', assigningLeReferral.referral_id));
    } else {
      const { data: officerId, error: rpcError } = await supabase.rpc('least_loaded_law_enforcement_officer');
      if (rpcError) console.error('[CaseDetailPage] least_loaded_law_enforcement_officer:', rpcError.message);
      ({ error } = await supabase.from('law_enforcement_referrals').insert({
        case_id: caseReport.case_id,
        referred_by: profile.profile_id,
        assigned_officer_id: (officerId as string | null) ?? null,
        reason: leReason || null,
        status: 'Pending',
      }));
    }

    setSaving(false);
    if (error) {
      console.error('[CaseDetailPage] submitLawEnforcementReferral:', error.message);
      return;
    }
    setLeModalOpen(false);
    setAssigningLeReferral(null);
    setLeOfficer('');
    setLeReason('');
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

  // Part A/4 — the compact action area is deliberately role-scoped: a
  // Municipal Administrator's general case actions are Update Status /
  // Refer to Shelter / Refer to Police Officer only. Assign Staff moved
  // to the Assignment panel (its proper operational workflow, not a
  // generic action list) and Refer to {MSWDO/PSWDO} moved to Ownership
  // History, shown ONLY for the barangay "Refer to MSWDO" escalation —
  // "Refer to PSWDO" (roleTier === 'municipality') is never rendered
  // anywhere on this page now. canEscalate/submitEscalate/the modal
  // itself are completely unchanged — this only changes WHERE the
  // trigger button appears, never the underlying authorization or
  // ownership-transfer logic.
  const canReferToMswdo = canEscalate && roleTier === 'barangay';

  return (
    <div>
      <PageHeader
        title={caseReport.case_number}
        subtitle={caseReport.case_type}
        actions={<DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* ---------- Case Header and Summary ---------- */}
      <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StatusBadge label={caseReport.status} />
          <StatusBadge label={caseReport.priority_level} />
          <StatusBadge label={caseReport.source_channel} />
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Owned by <strong style={{ color: 'var(--color-text)' }}>{OWNER_LEVEL_LABEL[caseReport.owner_level]}</strong> — {ownerOrgName(caseReport.owner_level, caseReport.owner_barangay_id)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Reported {new Date(caseReport.reported_at).toLocaleDateString()}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={allowedNextStatuses.length === 0} onClick={() => setStatusModalOpen(true)}>
            Update Status
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setReferralModalOpen(true)} disabled={shelters.length === 0}>
            Refer to Shelter
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              setAssigningLeReferral(null);
              setLeOfficer('');
              setLeReason('');
              setLeModalOpen(true);
            }}
          >
            Refer to Police Officer
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* ---------- Primary Case Information ---------- */}
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Incident Details</h3>
            <Field label="Incident location" value={caseReport.incident_location} />
            {incidentBarangayName && <Field label="Incident barangay" value={incidentBarangayName} />}
            <Field label="Incident date" value={new Date(caseReport.incident_date).toLocaleString()} />
            <Field label="Reported" value={new Date(caseReport.reported_at).toLocaleString()} />
            <Field label="Anonymous report" value={caseReport.is_anonymous ? 'Yes' : 'No'} />
            <Field label="Reported for" value={caseReport.reported_for === 'Other' ? 'Someone else (see below)' : 'Self'} />
            <div style={{ marginTop: 12 }}>
              <span className="label">Description</span>
              <p>{caseReport.description}</p>
            </div>
            {caseReport.incident_latitude != null && caseReport.incident_longitude != null && (
              <div style={{ marginTop: 12, height: 220 }}>
                <LocationMap
                  latitude={caseReport.incident_latitude}
                  longitude={caseReport.incident_longitude}
                  label={`Incident — ${caseReport.case_number}`}
                />
              </div>
            )}
          </div>

          {/* module30 — shown only when a reporting account filed this on
              behalf of someone else. The Survivor Information card below
              always describes the REPORTING account, never this person —
              clarified in that card's own subtitle just below. */}
          {caseReport.reported_for === 'Other' && (
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Person the Report Concerns</h3>
              <Field label="Name" value={caseReport.third_party_name ?? '—'} />
              <Field label="Reporter's relationship to them" value={caseReport.third_party_relationship ?? '—'} />
              <Field label="Approximate age" value={caseReport.third_party_age_range ?? 'Not provided'} />
              <Field label="Contact number" value={caseReport.third_party_contact_number ?? 'Not provided'} />
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Survivor Information</h3>
                {caseReport.reported_for === 'Other' && (
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    The account that filed this report — not necessarily the person affected (see above).
                  </p>
                )}
              </div>
              {survivorProfile && (roleTier === 'province' || roleTier === 'municipality') && (
                <button className="btn btn-outline btn-sm" onClick={openSurvivorInfoModal}>
                  Edit Survivor Information
                </button>
              )}
            </div>
            {caseReport.is_anonymous ? (
              <p style={{ color: 'var(--color-text-muted)' }}>This report was submitted anonymously.</p>
            ) : survivorProfile ? (
              <>
                <Field label="Name" value={`${survivorProfile.first_name} ${survivorProfile.last_name}`} />
                <Field label="Phone" value={survivorProfile.phone_number ?? '—'} />
                <Field label="Emergency contact" value={`${survivor?.emergency_contact_name ?? '—'} (${survivor?.emergency_contact_number ?? '—'})`} />

                <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13.5 }}>Survivor Information</h4>
                <Field label="Date of birth" value={survivor?.date_of_birth ? new Date(`${survivor.date_of_birth}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not on file'} />
                <Field label="Age" value={survivor?.date_of_birth != null ? `${ageAt(survivor.date_of_birth, new Date().toISOString())} (calculated)` : '—'} />
                <Field label="Sex" value={survivor?.gender ?? 'Not on file'} />
                <Field label="Educational attainment" value={survivor?.educational_attainment ?? 'Not on file'} />

                <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13.5 }}>Registered Address</h4>
                {survivor?.address || survivorBarangayName ? (
                  <>
                    <Field label="Address" value={[survivor?.address, survivorBarangayName, caseMunicipality?.municipality_name].filter(Boolean).join(', ') || '—'} />
                    {survivor?.purok_sitio && <Field label="Purok / Sitio" value={survivor.purok_sitio} />}
                    {survivor?.latitude != null && survivor?.longitude != null && (
                      <div style={{ marginTop: 8, height: 200 }}>
                        <LocationMap latitude={survivor.latitude} longitude={survivor.longitude} label="Registered address" />
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No registered address on file.</p>
                )}
              </>
            ) : caseReport.source_channel === 'Walk-In' && !caseReport.survivor_id ? (
              <>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8 }}>
                  Reported in person — no SafeSpace account associated yet. The client can create an account, scan the Client Access
                  QR, and be verified to complete this association.
                </p>
                <Field label="Name given at report" value={caseReport.walkin_reporter_name ?? '—'} />
                <Field label="Contact given at report" value={caseReport.walkin_reporter_contact ?? '—'} />
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
              <EmptyState title="No evidence uploaded yet" />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Services</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setServiceModalOpen(true)}>
                Add Service
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              A service only counts on a government report once its status is set to "Provided" — a referral or pending
              request is never counted as a service actually given.
            </p>
            {services.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, fontSize: 12 }}>
                <ServiceSummaryStat label="Total" count={services.length} />
                <ServiceSummaryStat label="Requested / Referred" count={services.filter((s) => s.status === 'Requested' || s.status === 'Referred').length} />
                <ServiceSummaryStat label="Scheduled / In Progress" count={services.filter((s) => s.status === 'Scheduled' || s.status === 'In Progress').length} />
                <ServiceSummaryStat label="Provided" count={services.filter((s) => s.status === 'Provided').length} tone="success" />
                <ServiceSummaryStat
                  label="Declined / Cancelled / Unable"
                  count={services.filter((s) => s.status === 'Declined' || s.status === 'Cancelled' || s.status === 'Unable to Provide').length}
                />
                {services.some(isServiceOverdue) && (
                  <ServiceSummaryStat label="Overdue follow-up" count={services.filter(isServiceOverdue).length} tone="danger" />
                )}
              </div>
            )}
            {services.length === 0 ? (
              <EmptyState title="No services recorded yet" subtitle="Add one once an intervention has been requested or provided." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {services.map((s) => {
                  const nextStatuses = SERVICE_STATUS_FLOW[s.status];
                  const overdue = isServiceOverdue(s);
                  return (
                    <div key={s.service_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>
                          {SERVICE_TYPE_LABELS[s.service_type]} ({s.service_type})
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {overdue && <StatusBadge label="Overdue" />}
                          {nextStatuses.length === 0 ? (
                            <StatusBadge label={s.status} />
                          ) : (
                            <select
                              className="input"
                              style={{ width: 'auto', fontSize: 12.5, padding: '4px 8px' }}
                              value={s.status}
                              onChange={(e) => updateServiceStatus(s, e.target.value as ServiceStatus)}
                              disabled={saving}
                            >
                              <option value={s.status}>{s.status}</option>
                              {nextStatuses.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          )}
                          <button className="btn btn-outline btn-sm" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEditServiceDetails(s)}>
                            Edit
                          </button>
                        </div>
                      </div>
                      {s.provider_agency && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Provider: {s.provider_agency}</div>}
                      {s.notes && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{s.notes}</div>}
                      {s.scheduled_date && <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Scheduled: {new Date(s.scheduled_date).toLocaleDateString()}</div>}
                      {s.follow_up_date && (
                        <div style={{ color: overdue ? 'var(--color-danger)' : 'var(--color-text-muted)', fontSize: 12 }}>
                          Follow-up: {new Date(s.follow_up_date).toLocaleDateString()}
                        </div>
                      )}
                      {s.reason_not_provided && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Reason: {s.reason_not_provided}</div>}
                      {(() => {
                        // module31 — this case's own view of a request this
                        // service generated, read-only here (the barangay
                        // acts on it from its own Barangay Requests inbox).
                        // RLS already limits what comes back in
                        // barangayRequests to rows this viewer (as the
                        // original requester, or province-wide oversight)
                        // is actually allowed to see.
                        const linked = barangayRequests.find((r) => r.service_id === s.service_id);
                        if (!linked) return null;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <StatusBadge label={`Barangay request: ${linked.status}`} />
                            {linked.response_notes && <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{linked.response_notes}</span>}
                          </div>
                        );
                      })()}
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {s.status === 'Provided' && s.provided_at ? `Provided ${new Date(s.provided_at).toLocaleString()}` : `Added ${new Date(s.created_at).toLocaleString()}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---------- Referrals (Case Operations) ---------- */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Referrals</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
              Shelter and Police Officer referrals for this case — use Refer to Shelter / Refer to Police Officer above.
            </p>

            <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>Shelter Referrals</h4>
            {referrals.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 16 }}>No shelter referrals recorded.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {referrals.map((r) => (
                  <div key={r.referral_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{r.shelters?.shelter_name}</span>
                      <StatusBadge label={r.referral_status} />
                    </div>
                    {r.notes && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>{r.notes}</p>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0 14px' }} />

            <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>Police Officer Referrals</h4>
            {lawEnforcementReferrals.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No Police Officer referrals recorded.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lawEnforcementReferrals.map((r) => (
                  <div key={r.referral_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>
                        {r.user_profiles ? (
                          `${r.user_profiles.first_name} ${r.user_profiles.last_name}`
                        ) : (
                          <span style={{ color: 'var(--color-danger)' }}>Unassigned</span>
                        )}
                      </span>
                      <StatusBadge label={r.status} />
                    </div>
                    {r.reason && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>{r.reason}</p>}
                    {r.action_notes && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Officer notes: {r.action_notes}</p>
                    )}
                    {!r.assigned_officer_id && (
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          setAssigningLeReferral(r);
                          setLeOfficer('');
                          setLeReason(r.reason ?? '');
                          setLeModalOpen(true);
                        }}
                      >
                        Assign officer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------- History and Supporting Records ---------- */}
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Status Timeline</h3>
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

          {/* Distinct from Referrals above — this records actual
              case-OWNERSHIP transfers (case_referrals), never inferred
              from a shelter/police referral. */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Ownership History</h3>
              {canReferToMswdo && (
                <button className="btn btn-outline btn-sm" onClick={() => setEscalateModalOpen(true)}>
                  Refer to MSWDO
                </button>
              )}
            </div>
            {ownershipHistory.length === 0 ? (
              <EmptyState title="No ownership changes yet" subtitle="This case has not moved between offices." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {ownershipHistory.map((r) => (
                  <div key={r.referral_id} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                    <div style={{ fontWeight: 600 }}>
                      {ownerOrgName(r.from_level, r.from_barangay_id)} → {ownerOrgName(r.to_level, r.to_barangay_id)}
                    </div>
                    {r.reason && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{r.reason}</div>}
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---------- Contextual sidebar ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <ClientAccessCard
            caseId={caseReport.case_id}
            caseNumber={caseReport.case_number}
            scopeLabel={ownerOrgName(caseReport.owner_level, caseReport.owner_barangay_id)}
          />

          {/* Staff assignment lives here — its proper operational
              workflow — not in the general case-action area above. */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Assignment</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setAssignModalOpen(true)}>
                {assignment ? 'Reassign' : 'Assign'}
              </button>
            </div>
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
        </div>
      </div>

      {statusModalOpen && (
        <Modal
          title="Update case status"
          onClose={() => setStatusModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setStatusModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitStatusChange} disabled={!nextStatus || saving}>
                {saving ? 'Saving...' : 'Save status'}
              </button>
            </>
          }
        >
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
        </Modal>
      )}

      {assignModalOpen && (
        <Modal
          title="Assign staff"
          onClose={() => setAssignModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setAssignModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitAssignment} disabled={!assignTo || saving}>
                {saving ? 'Saving...' : 'Assign'}
              </button>
            </>
          }
        >
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
        </Modal>
      )}

      {referralModalOpen && (
        <Modal
          title="Refer to shelter"
          onClose={() => setReferralModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setReferralModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitReferral} disabled={!referralShelter || saving}>
                {saving ? 'Saving...' : 'Refer'}
              </button>
            </>
          }
        >
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
        </Modal>
      )}

      {leModalOpen && (
        <Modal
          title={assigningLeReferral ? 'Assign an officer to this referral' : 'Refer to police officer'}
          onClose={() => {
            setLeModalOpen(false);
            setAssigningLeReferral(null);
          }}
          footer={
            <>
              <button
                className="btn btn-outline"
                onClick={() => {
                  setLeModalOpen(false);
                  setAssigningLeReferral(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitLawEnforcementReferral} disabled={saving}>
                {saving ? 'Saving...' : assigningLeReferral ? 'Save' : 'Refer'}
              </button>
            </>
          }
        >
          {assigningLeReferral ? (
            <>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
                No eligible officer was available when this referral was created. It only becomes visible to the
                assigned officer once one is assigned below.
              </p>
              <div className="field">
                <label className="label">Assign to officer</label>
                <select className="input" value={leOfficer} onChange={(e) => setLeOfficer(e.target.value)}>
                  <option value="">Leave unassigned for now</option>
                  {officers.map((o) => (
                    <option key={o.profile_id} value={o.profile_id}>
                      {o.first_name} {o.last_name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
              The case will be automatically assigned to an eligible police officer for authorized review — whichever
              active officer currently has the fewest open referrals. If no officer is eligible right now, the
              referral is still created and can be assigned manually once one is.
            </p>
          )}
          <div className="field">
            <label className="label">Reason for referral</label>
            <textarea className="input" rows={3} value={leReason} onChange={(e) => setLeReason(e.target.value)} />
          </div>
        </Modal>
      )}

      {escalateModalOpen && (
        <Modal
          title={`Refer to ${roleTier === 'barangay' ? 'MSWDO' : 'PSWDO'}`}
          onClose={() => setEscalateModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEscalateModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitEscalate} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm referral'}
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
            This transfers case ownership from {ownerOrgName(caseReport.owner_level, caseReport.owner_barangay_id)} to the{' '}
            {roleTier === 'barangay' ? 'municipal (MSWDO)' : 'provincial (PSWDO)'} office. This case will remain visible to you in its history.
          </p>
          <div className="field">
            <label className="label">Reason</label>
            <textarea className="input" rows={3} value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} />
          </div>
        </Modal>
      )}

      {survivorInfoModalOpen && (
        <Modal
          title="Edit Survivor Information"
          onClose={() => setSurvivorInfoModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSurvivorInfoModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitSurvivorInfo} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>
            Used only for official government case-reporting classification (WEDC/CNSP). All fields are optional — leave
            blank if not known.
          </p>
          <div className="field">
            <label className="label">Date of birth</label>
            <input type="date" className="input" value={editDob} onChange={(e) => setEditDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            {editDob && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Age: {ageAt(editDob, new Date().toISOString())} (calculated — not directly editable)</p>}
          </div>
          <div className="field">
            <label className="label">Sex</label>
            <select className="input" value={editSex} onChange={(e) => setEditSex(e.target.value as Gender | '')}>
              <option value="">Not on file</option>
              {SEX_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Educational attainment</label>
            <select className="input" value={editEducAttainment} onChange={(e) => setEditEducAttainment(e.target.value)}>
              <option value="">Not on file</option>
              {EDUCATIONAL_ATTAINMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {serviceModalOpen && (
        <Modal
          title="Add Service"
          onClose={() => setServiceModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setServiceModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitAddService}
                disabled={!newServiceType || saving || (requiresBarangayRequest(newServiceType) && !targetBarangayId)}
              >
                {saving ? 'Saving...' : 'Add'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Service type</label>
            <select
              className="input"
              value={newServiceType}
              onChange={(e) => {
                const value = e.target.value as ServiceType | '';
                setNewServiceType(value);
                if (value && requiresBarangayRequest(value)) {
                  // Best available real signal, never a guess: the
                  // survivor's own registered barangay first, falling
                  // back to where the incident was recorded. Always
                  // confirmable/overridable in the dropdown below before
                  // submission — this just saves a redundant click when
                  // the obvious answer is already on file.
                  setTargetBarangayId(survivor?.barangay_id ?? caseReport?.incident_barangay_id ?? '');
                } else {
                  setTargetBarangayId('');
                }
              }}
            >
              <option value="">Select a service</option>
              {SERVICE_TYPE_OPTIONS.map((code) => (
                <option key={code} value={code}>{SERVICE_TYPE_LABELS[code]} ({code})</option>
              ))}
            </select>
          </div>
          {newServiceType && requiresBarangayRequest(newServiceType) && (
            <div className="field">
              <label className="label">Target barangay *</label>
              <select className="input" value={targetBarangayId} onChange={(e) => setTargetBarangayId(e.target.value)}>
                <option value="">Select the barangay that should act on this</option>
                {caseBarangays.map((b) => (
                  <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                {SERVICE_TYPE_LABELS[newServiceType]} will appear in this barangay's Barangay Requests inbox. This
                creates a request, not an issued order — the barangay still has to act on it.
              </p>
            </div>
          )}
          <div className="field">
            <label className="label">Provider / agency (optional)</label>
            <input className="input" value={newServiceProvider} onChange={(e) => setNewServiceProvider(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Scheduled date (optional)</label>
            <input className="input" type="date" value={newServiceScheduledDate} onChange={(e) => setNewServiceScheduledDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Notes (optional)</label>
            <textarea className="input" rows={3} value={newServiceNotes} onChange={(e) => setNewServiceNotes(e.target.value)} />
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>
            New services start as "Requested" — update the status from the Services card once the intervention is
            referred, scheduled, or actually provided.
          </p>
        </Modal>
      )}

      {editingService && (
        <Modal
          title={`Edit — ${SERVICE_TYPE_LABELS[editingService.service_type]}`}
          onClose={() => setEditingService(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEditingService(null)} disabled={savingServiceDetails}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitEditServiceDetails} disabled={savingServiceDetails}>
                {savingServiceDetails ? 'Saving...' : 'Save'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Scheduled date</label>
            <input className="input" type="date" value={editServiceScheduledDate} onChange={(e) => setEditServiceScheduledDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Follow-up date</label>
            <input className="input" type="date" value={editServiceFollowUpDate} onChange={(e) => setEditServiceFollowUpDate(e.target.value)} />
          </div>
          {NOT_PROVIDED_STATUSES.includes(editingService.status) && (
            <div className="field">
              <label className="label">Reason not provided</label>
              <textarea className="input" rows={3} value={editServiceReason} onChange={(e) => setEditServiceReason(e.target.value)} />
            </div>
          )}
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

// module25 — a service is only "overdue" if it has a follow-up date in
// the past AND hasn't already reached a terminal status; a service
// that's Provided/Declined/Cancelled/Unable to Provide is finished one
// way or another and must never show as pending follow-up.
function isServiceOverdue(s: CaseService): boolean {
  if (!s.follow_up_date || SERVICE_TERMINAL_STATUSES.includes(s.status)) return false;
  return new Date(s.follow_up_date) < new Date(new Date().toDateString());
}

function ServiceSummaryStat({ label, count, tone }: { label: string; count: number; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'var(--color-success)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)';
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-surface-muted)',
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {count} {label}
    </span>
  );
}

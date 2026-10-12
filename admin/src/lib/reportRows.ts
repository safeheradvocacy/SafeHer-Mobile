import type { CaseAssignment, CaseReport, ShelterReferral, UserProfile } from '../types/database.types';

/**
 * The one shared case-record row shape consumed by both the on-screen
 * Case Detail table and the PDF's case-records table — see
 * ReportsPage.tsx. Building this once here (instead of twice) is what
 * makes "the on-screen total and the PDF can never independently
 * drift" a structural guarantee.
 *
 * `assignedStaff`/`referralStatus` are genuinely-available fields (not
 * fabricated) — case_assignments/shelter_referrals are already fetched
 * by useCaseReportData for the same authorized, filtered case set;
 * both arrays are queried ordered most-recent-first, so `.find()`
 * below naturally picks the current assignment/referral per case.
 */
export interface ReportRow {
  caseNumber: string;
  dateReportedIso: string; // yyyy-mm-dd — machine-readable
  dateReportedDisplay: string; // e.g. "Sep 10, 2026" — for the on-screen table/PDF
  caseType: string;
  status: string;
  priority: string;
  municipality: string;
  barangay: string;
  assignedStaff: string;
  referralStatus: string;
  sourceChannel: string; // 'Mobile' | 'Walk-In' (module14) — already on every fetched case row
}

export function buildReportRows(
  cases: CaseReport[],
  referrals: ShelterReferral[],
  assignments: CaseAssignment[],
  staffOptions: UserProfile[],
  municipalityName: (id: string | null) => string,
  barangayName: (id: string | null) => string
): ReportRow[] {
  const staffNameById = new Map(staffOptions.map((s) => [s.profile_id, `${s.first_name} ${s.last_name}`]));

  return cases.map((c) => {
    const referral = referrals.find((r) => r.case_id === c.case_id);
    const assignment = assignments.find((a) => a.case_id === c.case_id);
    const reportedDate = new Date(c.reported_at);

    return {
      caseNumber: c.case_number,
      dateReportedIso: reportedDate.toISOString().slice(0, 10),
      dateReportedDisplay: reportedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      caseType: c.case_type,
      status: c.status,
      priority: c.priority_level,
      municipality: municipalityName(c.municipality_id),
      barangay: c.owner_barangay_id ? barangayName(c.owner_barangay_id) : '—',
      assignedStaff: assignment ? staffNameById.get(assignment.assigned_to) ?? 'Unassigned' : 'Unassigned',
      referralStatus: referral ? referral.referral_status : 'None',
      sourceChannel: c.source_channel,
    };
  });
}

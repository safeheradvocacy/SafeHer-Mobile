import type { ServiceStatus, ServiceType } from '../types/database.types';

/**
 * The ONE place the Services Provided vocabulary (module22) is
 * defined — reused by the CaseDetailPage UI, governmentReportDocument.ts's
 * PDF legend, and governmentReportCsv.ts, so the code/label pairing can
 * never drift between the case-management screen and the government
 * report output.
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  CS: 'Counseling Services',
  LS: 'Legal Services',
  PPO: 'Permanent Protection Order',
  TPO: 'Temporary Protection Order',
  BPO: 'Barangay Protection Order',
  EA: 'Educational Assistance',
  LA: 'Livelihood Assistance',
  FA: 'Financial Assistance',
  MA: 'Medical Assistance',
  TA: 'Transportation Assistance',
};

export const SERVICE_TYPE_OPTIONS = Object.keys(SERVICE_TYPE_LABELS) as ServiceType[];

export const SERVICE_STATUS_OPTIONS: ServiceStatus[] = [
  'Requested',
  'Referred',
  'Scheduled',
  'In Progress',
  'Provided',
  'Declined',
  'Cancelled',
  'Unable to Provide',
];

/** Only this one status ever counts as "provided" for a government
 * report — a referral, a schedule, or an in-progress service is not a
 * completed intervention. Centralized so this rule is checked exactly
 * once, not re-implemented at each call site. */
export function isServiceProvided(status: ServiceStatus): boolean {
  return status === 'Provided';
}

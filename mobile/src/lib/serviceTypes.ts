import type { CaseService, ServiceStatus, ServiceType } from '../types/database.types';

/**
 * Mirrors admin/src/lib/serviceTypes.ts — same code/label pairing and
 * the same "only 'Provided' counts" rule, so a service's status reads
 * identically whether a staff member views it in the admin portal or a
 * survivor views it here. Mobile is read-only for case_services (RLS —
 * module22 — only grants INSERT/UPDATE to case-owning staff; a survivor
 * can SELECT their own case's services via owns_case(), never write
 * one), so this file has no write helpers.
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

/** Only this status means the service actually happened — a referral,
 * request, schedule, or in-progress service is not "provided." Mirrors
 * admin/src/lib/serviceTypes.ts's isServiceProvided() exactly. */
export function isServiceProvided(status: ServiceStatus): boolean {
  return status === 'Provided';
}

export function serviceTypeLabel(service: CaseService): string {
  return SERVICE_TYPE_LABELS[service.service_type] ?? service.service_type;
}

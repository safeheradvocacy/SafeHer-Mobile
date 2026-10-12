import type { ServiceType } from '../types/database.types';

/**
 * The ONE centralized map of "does this service type require a
 * Barangay Action Request" (module31) — per the master prompt's
 * explicit instruction not to hardcode separate, inconsistent
 * conditions across multiple UI components. Every call site
 * (CaseDetailPage.tsx's Add Service flow, any future one) must read
 * through requiresBarangayRequest()/barangayRequestTypeFor(), never
 * re-derive this decision inline.
 *
 * Evaluated against the REAL service catalog (serviceTypes.ts,
 * module22) — all 10 existing service_type values, decided one by
 * one rather than assumed:
 *
 *   BPO (Barangay Protection Order) — REQUIRES a barangay request.
 *     A BPO is, by definition (RA 9262 Sec. 14), issued by the Punong
 *     Barangay — the only service in this catalog where barangay
 *     action isn't just helpful but the entire point of the service.
 *
 *   TPO / PPO (Temporary / Permanent Protection Order) — do NOT route
 *     to a barangay. These are court-issued orders (family court) —
 *     a barangay has no issuing authority here; routing them to
 *     Barangay Requests would misrepresent who actually acts on them.
 *
 *   CS (Counseling), LS (Legal Services), MA (Medical Assistance),
 *   EA (Educational Assistance), LA (Livelihood Assistance),
 *   FA (Financial Assistance), TA (Transportation Assistance) — do
 *   NOT route to a barangay by default. Each is normally delivered or
 *   coordinated directly by MSWDO/PSWDO or a partner provider, with
 *   no established SafeSpace workflow today where barangay-level
 *   action is the actual next step. Marked NEEDS_CONFIRMATION rather
 *   than a flat "no": a real local government may, in practice, ask
 *   a barangay to help coordinate one of these (e.g. a barangay
 *   escort for a medical referral) — that is a genuine MSWDO/PSWDO
 *   business-rule decision this codebase has no authority to assume,
 *   so it is documented here as open rather than silently decided.
 *
 * Changing any entry below is a product/policy decision, not a code
 * change — do it here, once, with the same reasoning discipline.
 */
export type BarangayRoutingDecision = 'requires_request' | 'no_routing' | 'needs_confirmation';

export const BARANGAY_SERVICE_ROUTING: Record<ServiceType, BarangayRoutingDecision> = {
  BPO: 'requires_request',
  TPO: 'no_routing',
  PPO: 'no_routing',
  CS: 'needs_confirmation',
  LS: 'needs_confirmation',
  MA: 'needs_confirmation',
  EA: 'needs_confirmation',
  LA: 'needs_confirmation',
  FA: 'needs_confirmation',
  TA: 'needs_confirmation',
};

/** The only question a UI call site should ever ask directly. */
export function requiresBarangayRequest(serviceType: ServiceType): boolean {
  return BARANGAY_SERVICE_ROUTING[serviceType] === 'requires_request';
}

/** request_type stored on barangay_action_requests — for this pass,
 * always just the service_type code itself (the request IS "please
 * act on this BPO"). Kept as its own function rather than inlined so
 * a future non-service-catalog request type has one obvious place to
 * extend without touching call sites. */
export function barangayRequestTypeFor(serviceType: ServiceType): string {
  return serviceType;
}

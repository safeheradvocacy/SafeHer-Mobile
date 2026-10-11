import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ReportsPage } from './ReportsPage';
import { PoliceReportsPage } from './PoliceReportsPage';
import { ShelterReportsPage } from './ShelterReportsPage';
import { SupportReportsPage } from './SupportReportsPage';

/**
 * Role-aware REPORTS entry point, mounted at /admin/reports (module24,
 * split from Analytics in module25 — see AnalyticsRouter.tsx for the
 * independently-routed /admin/analytics sibling). Mirrors the exact
 * DashboardRouter.tsx precedent (check the specific role first, fall
 * back to roleTier) rather than cramming every role's logic into one
 * monolithic page.
 *
 * shelter_admin/shelter_staff/support_expert/law_enforcement have no
 * roleTier (none sits on the province -> municipality -> barangay
 * ladder) and their RLS grants no general case_reports access, so
 * ReportsPage's case-centric data hook would be empty/useless for
 * them — each gets its own lean, document-oriented Reports page
 * (PDF/CSV via the shared generateRoleReportPdf renderer), sourced
 * from the same already-RLS-correct tables/hooks their Analytics page
 * and dashboard already use.
 *
 * province/municipality/barangay roleTier roles (provincial_admin,
 * super_admin, provincial_staff, municipal_admin, barangay_admin) all
 * share identical case_reports/sos_alerts/shelter_referrals RLS access
 * within their tier (is_provincial_admin() treats provincial_admin/
 * super_admin/provincial_staff identically) — they continue to share
 * the single existing ReportsPage unchanged (General + WEDC/CNSP/CICL).
 */
export function ReportsRouter() {
  const { profile } = useAuth();
  if (profile?.role === 'law_enforcement') return <PoliceReportsPage />;
  if (profile?.role === 'shelter_admin' || profile?.role === 'shelter_staff') return <ShelterReportsPage />;
  if (profile?.role === 'support_expert') return <SupportReportsPage />;
  return <ReportsPage />;
}

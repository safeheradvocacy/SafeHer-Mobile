import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { AnalyticsPage } from './AnalyticsPage';
import { PoliceAnalyticsPage } from './PoliceAnalyticsPage';
import { ShelterAnalyticsPage } from './ShelterAnalyticsPage';
import { SupportAnalyticsPage } from './SupportAnalyticsPage';

/**
 * Role-aware ANALYTICS entry point (module25), mounted independently at
 * /admin/analytics — the interactive-exploration sibling of
 * ReportsRouter.tsx's /admin/reports. Same role-dispatch shape as
 * ReportsRouter/DashboardRouter: check the specific role first, fall
 * back to roleTier.
 */
export function AnalyticsRouter() {
  const { profile } = useAuth();
  if (profile?.role === 'law_enforcement') return <PoliceAnalyticsPage />;
  if (profile?.role === 'shelter_admin' || profile?.role === 'shelter_staff') return <ShelterAnalyticsPage />;
  if (profile?.role === 'support_expert') return <SupportAnalyticsPage />;
  return <AnalyticsPage />;
}

import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { MunicipalDashboard } from './MunicipalDashboard';
import { ProvincialDashboard } from './ProvincialDashboard';
import { TechnicalAdminDashboard } from './TechnicalAdminDashboard';
import { ShelterAdminDashboard } from './ShelterAdminDashboard';
import { SupportExpertDashboard } from './SupportExpertDashboard';
import { LawEnforcementDashboard } from './LawEnforcementDashboard';

export function DashboardRouter() {
  const { profile, roleTier } = useAuth();
  // shelter_admin, shelter_staff, support_expert, and law_enforcement
  // have no roleTier (none is a rung on the province -> municipality ->
  // barangay ladder) — must be checked before the roleTier branches
  // below, or they'd silently fall through to plain MunicipalDashboard.
  //
  // shelter_staff is retired (role consolidation,
  // module24_retire_shelter_staff_role.sql) — shelter_admin is now the
  // single official shelter role and ShelterStaffDashboard no longer
  // exists. Routed here alongside shelter_admin, not removed outright,
  // so any account not yet converted by that migration still lands on
  // a working dashboard instead of falling through to
  // MunicipalDashboard — same non-destructive-retirement treatment as
  // provincial_admin/super_admin below.
  if (profile?.role === 'shelter_admin' || profile?.role === 'shelter_staff') return <ShelterAdminDashboard />;
  if (profile?.role === 'support_expert') return <SupportExpertDashboard />;
  if (profile?.role === 'law_enforcement') return <LawEnforcementDashboard />;
  // provincial_admin/super_admin (RBAC split, module11) are redefined as
  // technical/system administration — checked explicitly, before the
  // roleTier === 'province' fallback below, since provincial_staff also
  // shares that tier (same province-wide geographic scope) but must get
  // the operational ProvincialDashboard instead. This mirrors the exact
  // precedent above: check the specific role first, fall back to tier.
  if (profile?.role === 'provincial_admin' || profile?.role === 'super_admin') return <TechnicalAdminDashboard />;
  if (roleTier === 'province') return <ProvincialDashboard />;
  if (roleTier === 'barangay') return <MunicipalDashboard scope="barangay" />;
  return <MunicipalDashboard />;
}

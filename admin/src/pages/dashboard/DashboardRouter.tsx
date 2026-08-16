import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { MunicipalDashboard } from './MunicipalDashboard';
import { ProvincialDashboard } from './ProvincialDashboard';

export function DashboardRouter() {
  const { profile } = useAuth();
  const isProvincial = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  return isProvincial ? <ProvincialDashboard /> : <MunicipalDashboard />;
}

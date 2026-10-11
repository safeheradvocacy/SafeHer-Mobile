import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/database.types';

export function ProtectedRoute({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  // Was hardcoded to a 4-role union (missing shelter_admin/shelter_staff/
  // support_expert/law_enforcement/provincial_staff entirely, blocking
  // any route guard from ever being written for them). Importing the
  // canonical UserRole union instead removes that drift risk — every
  // admin role can now be used in a requireRole array.
  requireRole?: UserRole[];
}) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading SafeSpace Administrative Portal...</div>;
  }

  if (!session || !profile) {
    return <Navigate to="/admin/login" replace />;
  }

  if (requireRole && !requireRole.includes(profile.role as any)) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <>{children}</>;
}

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: Array<'municipal_admin' | 'provincial_admin' | 'super_admin'>;
}) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading SafeHer Admin...</div>;
  }

  if (!session || !profile) {
    return <Navigate to="/admin/login" replace />;
  }

  if (requireRole && !requireRole.includes(profile.role as any)) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <>{children}</>;
}

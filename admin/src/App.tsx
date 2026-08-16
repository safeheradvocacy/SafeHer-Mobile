import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppLayout } from './layout/AppLayout';
import { LandingPage } from './pages/public/LandingPage';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from './pages/auth/AuthPages';
import { DashboardRouter } from './pages/dashboard/DashboardRouter';
import { CaseListPage } from './pages/cases/CaseListPage';
import { CaseDetailPage } from './pages/cases/CaseDetailPage';
import { SosMonitoringPage } from './pages/sos/SosMonitoringPage';
import { ShelterReferralPage } from './pages/shelters/ShelterReferralPage';
import { MunicipalityManagementPage } from './pages/municipalities/MunicipalityManagementPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { UserManagementPage } from './pages/users/UserManagementPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { SettingsPage } from './pages/settings/SettingsPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/admin/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardRouter />} />
            <Route path="cases" element={<CaseListPage />} />
            <Route path="cases/:caseId" element={<CaseDetailPage />} />
            <Route path="sos" element={<SosMonitoringPage />} />
            <Route path="shelters" element={<ShelterReferralPage />} />
            <Route
              path="municipalities"
              element={
                <ProtectedRoute requireRole={['provincial_admin', 'super_admin']}>
                  <MunicipalityManagementPage />
                </ProtectedRoute>
              }
            />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="users" element={<UserManagementPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppLayout } from './layout/AppLayout';
import { LandingPage } from './pages/public/LandingPage';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from './pages/auth/AuthPages';
import { DashboardRouter } from './pages/dashboard/DashboardRouter';
import { CaseListPage } from './pages/cases/CaseListPage';
import { CaseDetailPage } from './pages/cases/CaseDetailPage';
import { SosMonitoringPage } from './pages/sos/SosMonitoringPage';
import { ShelterReferralPage } from './pages/shelters/ShelterReferralPage';
import { ShelterInformationPage } from './pages/shelters/ShelterInformationPage';
import { ShelterOccupancyPage } from './pages/shelters/ShelterOccupancyPage';
import { ShelterRequestsReferralsPage } from './pages/shelters/ShelterRequestsReferralsPage';
import { ShelterManagementPage } from './pages/shelters/ShelterManagementPage';
import { MunicipalityManagementPage } from './pages/municipalities/MunicipalityManagementPage';
import { BarangayManagementPage } from './pages/barangays/BarangayManagementPage';
import { ReportsRouter } from './pages/reports/ReportsRouter';
import { AnalyticsRouter } from './pages/reports/AnalyticsRouter';
import { UserManagementPage } from './pages/users/UserManagementPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { FaqManagementPage } from './pages/faq/FaqManagementPage';
import { SupportQueuePage } from './pages/support/SupportQueuePage';
import { VerificationQueuePage } from './pages/verifications/VerificationQueuePage';
import { CaseAccessQueuePage } from './pages/verifications/CaseAccessQueuePage';
import { SosReferralsPage } from './pages/lawEnforcement/SosReferralsPage';
import { CaseReferralsPage } from './pages/lawEnforcement/CaseReferralsPage';
import { AuditLogPage } from './pages/audit/AuditLogPage';
import { BackupRestorePage } from './pages/backups/BackupRestorePage';
import { RolesPermissionsPage } from './pages/roles/RolesPermissionsPage';
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage';
import { BarangayRequestsPage } from './pages/barangayRequests/BarangayRequestsPage';
import { PoliceManagementPage } from './pages/police/PoliceManagementPage';

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
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
            {/* RBAC split (module11): every route below that used to list
                'provincial_admin'/'super_admin' as an OPERATIONAL role now
                lists 'provincial_staff' instead — provincial_admin is
                redefined as technical/system administration only and no
                longer reaches these routes (nav no longer links to them
                either, but the route guard is the real enforcement layer —
                see ProtectedRoute.tsx). Underlying database RLS access is
                unchanged for provincial_admin (see module11's own header);
                this is a frontend route-guard/nav scope decision only. */}
            <Route
              path="cases"
              element={
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff', 'barangay_admin']}>
                  <CaseListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="cases/:caseId"
              element={
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff', 'barangay_admin']}>
                  <CaseDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sos"
              element={
                // module31 — barangay_admin removed (master prompt: "Redesign
                // Barangay Admin Access"): no standalone SOS Monitoring for this
                // role, enforced here, not merely hidden from the sidebar.
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff']}>
                  <SosMonitoringPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="shelters"
              element={
                // module31 — barangay_admin removed, same reasoning as /sos above.
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff']}>
                  <ShelterReferralPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="verifications"
              element={
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff', 'barangay_admin']}>
                  <VerificationQueuePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="case-access"
              element={
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_staff', 'barangay_admin']}>
                  <CaseAccessQueuePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="shelter-management"
              element={
                <ProtectedRoute requireRole={['provincial_staff', 'municipal_admin']}>
                  <ShelterManagementPage />
                </ProtectedRoute>
              }
            />
            {/* module32 — Police Management. provincial_admin/super_admin added
                here even though "Administrator Management" above deliberately
                excludes provincial_staff — this is a different, narrower
                surface (Police Officer accounts only) that both province-admin
                tier AND provincial_staff may reach. Deliberately province-tier
                ONLY — municipal_admin (MSWDO) does not get this module; see
                PoliceManagementPage.tsx and create-admin-user/index.ts for the
                real, server-side enforcement of what each role may do inside it. */}
            <Route
              path="police-management"
              element={
                <ProtectedRoute requireRole={['provincial_staff', 'provincial_admin', 'super_admin']}>
                  <PoliceManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="municipalities"
              element={
                <ProtectedRoute requireRole={['provincial_staff']}>
                  <MunicipalityManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="barangays"
              element={
                <ProtectedRoute requireRole={['provincial_staff', 'municipal_admin']}>
                  <BarangayManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="support-queue"
              element={
                <ProtectedRoute requireRole={['provincial_staff']}>
                  <SupportQueuePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="faqs"
              element={
                <ProtectedRoute requireRole={['provincial_staff']}>
                  <FaqManagementPage />
                </ProtectedRoute>
              }
            />
            {/* module24/25 — Reports & Analytics, expanded to every active
                role and split into two independently-routed pages
                (Phase 2: "independently accessible, rather than being
                one page with two unrelated sections hidden together").
                ReportsRouter/AnalyticsRouter each pick the role-
                appropriate page. provincial_admin/super_admin are
                deliberately EXCLUDED here — they're the technical/
                system-administration tier (accounts, reference data,
                system settings, audit log); reports/analytics/
                announcements stay with municipal_admin and
                provincial_staff (see permissions.ts' reports.view set,
                which this list must keep matching). The four shelter/
                support/police roles each get their own assignment- or
                shelter-scoped Reports (PDF) and Analytics (charts/KPIs)
                pages. */}
            <Route
              path="reports"
              element={
                <ProtectedRoute
                  requireRole={[
                    'municipal_admin',
                    'provincial_staff',
                    'barangay_admin',
                    'law_enforcement',
                    'shelter_admin',
                    'shelter_staff',
                    'support_expert',
                  ]}
                >
                  <ReportsRouter />
                </ProtectedRoute>
              }
            />
            <Route
              path="analytics"
              element={
                <ProtectedRoute
                  requireRole={[
                    'municipal_admin',
                    'provincial_staff',
                    'barangay_admin',
                    'law_enforcement',
                    'shelter_admin',
                    'shelter_staff',
                    'support_expert',
                  ]}
                >
                  <AnalyticsRouter />
                </ProtectedRoute>
              }
            />
            {/* Administrator Management stays technical-admin-only (plus the
                existing municipal_admin self-service scope) — provincial_staff
                is deliberately NOT added here, matching its confirmed nav scope. */}
            <Route
              path="users"
              element={
                <ProtectedRoute requireRole={['municipal_admin', 'provincial_admin', 'super_admin']}>
                  <UserManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit-log"
              element={
                <ProtectedRoute requireRole={['provincial_admin', 'super_admin']}>
                  <AuditLogPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="backups"
              element={
                <ProtectedRoute requireRole={['provincial_admin', 'super_admin']}>
                  <BackupRestorePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="roles-permissions"
              element={
                <ProtectedRoute requireRole={['provincial_admin', 'super_admin']}>
                  <RolesPermissionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="law-enforcement/sos-referrals"
              element={
                <ProtectedRoute requireRole={['law_enforcement']}>
                  <SosReferralsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="law-enforcement/case-referrals"
              element={
                <ProtectedRoute requireRole={['law_enforcement']}>
                  <CaseReferralsPage />
                </ProtectedRoute>
              }
            />
            {/* shelter_admin's own dedicated pages (master prompt: "Separate
                SafeSpace Shelter Administrator Functions into Dedicated
                Navigation Pages") — role-guarded the same way as
                law-enforcement's own sub-routes just above. Frontend route
                guard only; the real boundary is still RLS
                (module4_shelter_admin.sql), scoped to profile.shelter_id. */}
            <Route
              path="shelter/information"
              element={
                <ProtectedRoute requireRole={['shelter_admin']}>
                  <ShelterInformationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="shelter/occupancy"
              element={
                <ProtectedRoute requireRole={['shelter_admin']}>
                  <ShelterOccupancyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="shelter/requests"
              element={
                <ProtectedRoute requireRole={['shelter_admin']}>
                  <ShelterRequestsReferralsPage />
                </ProtectedRoute>
              }
            />
            {/* module28 — Provincial Staff only. Route guard mirrors
                support-queue/faqs above (the same provincial_staff-only
                shape); real enforcement is module28's is_provincial_staff()
                RLS, not this guard. */}
            <Route
              path="announcements"
              element={
                <ProtectedRoute requireRole={['provincial_staff']}>
                  <AnnouncementsPage />
                </ProtectedRoute>
              }
            />
            {/* module31 — barangay_admin's inbox for MSWDO/PSWDO/Police-
                originated action requests (e.g. BPO). The requesting
                agency tracks status from the case itself (CaseDetailPage),
                not a second copy of this page — see that page's own
                "Barangay Requests" section. */}
            <Route
              path="barangay-requests"
              element={
                <ProtectedRoute requireRole={['barangay_admin']}>
                  <BarangayRequestsPage />
                </ProtectedRoute>
              }
            />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

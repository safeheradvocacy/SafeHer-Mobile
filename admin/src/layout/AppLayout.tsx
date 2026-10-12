import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Siren,
  MapPin,
  Building2,
  Home,
  BarChart3,
  LineChart,
  Users,
  Bell,
  Settings,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
  HelpCircle,
  MessageCircleHeart,
  IdCard,
  History,
  KeyRound,
  QrCode,
  DatabaseBackup,
  Megaphone,
  ClipboardCheck,
  Shield,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { LogoLockup, LogoMark } from '../components/branding/Logo';
import { AdminErrorBoundary } from '../components/AdminErrorBoundary';
import { hasPermission, type PermissionKey } from '../lib/permissions';
import { ROLE_LABEL } from '../lib/roleLabels';
import type { UserRole } from '../types/database.types';

// Section a nav item belongs to, purely for the sidebar's visual grouping
// (small uppercase labels) — carries no permission meaning of its own.
// 'utility' items (Notifications/Settings) are the same for every role and
// render below a thin divider instead of a text label, since they aren't
// really "a category of work" the way the others are.
// 'shelter'/'occupancy'/'requests'/'account' are exclusively used by
// SHELTER_ADMIN_NAV_ITEMS below. 'communication' is used there AND (as
// of module28) by the shared NAV_ITEMS' Announcements item — both are
// safe, since GROUP_ORDER/GROUP_LABEL are rendered identically no
// matter which array supplies the items, and Announcements is gated by
// the 'announcements.manage' permission (provincial_staff only), so no
// other role's sidebar gains a 'communication' section from this.
// 'communication'/'account' render
// as normal labeled groups (not the unlabeled 'utility' divider every
// other role uses for Notifications/Settings) — a deliberate,
// role-scoped exception: this master prompt explicitly asked for
// COMMUNICATION/ACCOUNT labels twice, unambiguously, unlike the first
// shelter_admin nav pass where the accompanying mockup actually showed
// no labels there at all.
// 'barangayOps' (module31) is used ONLY by the shared NAV_ITEMS'
// Barangay Requests item, gated by 'barangayRequests.manage'
// (barangay_admin only) — same safe-to-add-a-new-key precedent as
// 'communication' above.
type NavGroup =
  | 'overview'
  | 'cases'
  | 'emergency'
  | 'services'
  | 'shelter'
  | 'occupancy'
  | 'requests'
  | 'communication'
  | 'barangayOps'
  | 'account'
  | 'reporting'
  | 'administration'
  | 'system'
  | 'utility';

const GROUP_LABEL: Partial<Record<NavGroup, string>> = {
  overview: 'Overview',
  cases: 'Case Management',
  emergency: 'Emergency',
  services: 'Services',
  shelter: 'Shelter Information',
  occupancy: 'Occupancy & Placement',
  requests: 'Requests & Referrals',
  communication: 'Communication',
  barangayOps: 'Barangay Operations',
  account: 'Account',
  reporting: 'Reporting',
  administration: 'Administration',
  system: 'System',
};

/**
 * One flat, permission-driven nav list — replaces the 7 hardcoded
 * per-role arrays this used to be (RBAC split, module11). `permission:
 * null` means "visible to any signed-in admin" (Dashboard/Notifications/
 * Settings); everything else is gated by admin/src/lib/permissions.ts,
 * the SAME source of truth App.tsx's route guards derive from — so the
 * sidebar can never show an item a route guard would then reject.
 * `labelByRole` covers the handful of items whose wording legitimately
 * differs by role (e.g. "Province-Wide Cases" vs "Case Management")
 * without needing a second array. `group` only drives which small section
 * label (if any) an item renders under — see renderNav below.
 */
interface NavItemDef {
  to: string;
  label: string;
  labelByRole?: Partial<Record<UserRole, string>>;
  icon: React.ElementType;
  end?: boolean;
  permission: PermissionKey | null;
  group: NavGroup;
}

const NAV_ITEMS: NavItemDef[] = [
  {
    to: '/admin/dashboard',
    label: 'Dashboard',
    labelByRole: {
      provincial_staff: 'Provincial Dashboard',
      provincial_admin: 'System Overview',
      super_admin: 'System Overview',
      // support_expert's dashboard IS their work queue — no separate
      // "Management" nav item exists for them. law_enforcement gets its
      // own dedicated nav array below (LAW_ENFORCEMENT_NAV_ITEMS) instead
      // of a labelByRole override here. shelter_staff (retired — role
      // consolidation, module24_retire_shelter_staff_role.sql) no longer
      // gets a dedicated label: any not-yet-migrated account now shares
      // shelter_admin's plain "Dashboard" label and dashboard.
      support_expert: 'My Conversations',
    },
    icon: LayoutDashboard,
    end: true,
    permission: null,
    group: 'overview',
  },
  { to: '/admin/cases', label: 'Case Management', labelByRole: { provincial_staff: 'Province-Wide Cases' }, icon: ClipboardList, permission: 'cases.view', group: 'cases' },
  { to: '/admin/verifications', label: 'Identity Verification', icon: IdCard, permission: 'identity.verify', group: 'cases' },
  { to: '/admin/case-access', label: 'Case Access Verification', icon: QrCode, permission: 'cases.view', group: 'cases' },
  { to: '/admin/sos', label: 'SOS Monitoring', icon: Siren, permission: 'sos.monitor', group: 'emergency' },
  { to: '/admin/shelters', label: 'Shelters & Referrals', icon: MapPin, permission: 'shelters.refer', group: 'services' },
  { to: '/admin/support-queue', label: 'Expert Support Queue', icon: MessageCircleHeart, permission: 'support.manage', group: 'services' },
  { to: '/admin/faqs', label: 'FAQ Management', icon: HelpCircle, permission: 'faqs.manage', group: 'services' },
  // module32 — Shelter Management moved from 'services' to
  // 'administration' (master prompt: "Reorganize Shelter Management
  // and Implement Police Management"). Same route, same
  // 'shelters.manage' permission gate — a pure nav reclassification,
  // not a new capability or a different page.
  { to: '/admin/shelter-management', label: 'Shelter Management', icon: Home, permission: 'shelters.manage', group: 'administration' },
  // module32 — new Police Management module. 'police.manage' is held
  // by municipal_admin, provincial_staff, provincial_admin, and
  // super_admin (see permissions.ts); law_enforcement itself never
  // sees this item (it reaches only its own profile via Settings).
  { to: '/admin/police-management', label: 'Police Management', icon: Shield, permission: 'police.manage', group: 'administration' },
  { to: '/admin/municipalities', label: 'Municipality Management', icon: Building2, permission: 'municipalities.manage', group: 'administration' },
  { to: '/admin/barangays', label: 'Barangay Management', icon: Building2, permission: 'barangays.manage', group: 'administration' },
  // module25 — Reports and Analytics are independently accessible pages
  // (Phase 2), not two tabs hidden behind one nav item. Both share the
  // same reports.view permission gate — there is no meaningful
  // "analytics but not reports" access tier for any role today.
  // module26 — given their own "Reporting" group (previously lumped
  // under "Administration" alongside Municipality/Barangay/Administrator
  // Management, which misrepresented reporting as a system-admin
  // function rather than the operational/analytical one it actually is).
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, permission: 'reports.view', group: 'reporting' },
  { to: '/admin/analytics', label: 'Analytics', icon: LineChart, permission: 'reports.view', group: 'reporting' },
  // module28 — Provincial Staff only (announcements.manage), per the
  // explicit role split: Provincial Admin must not automatically gain
  // this just because it shares other province-wide permissions.
  { to: '/admin/announcements', label: 'Provincial Announcements', icon: Megaphone, permission: 'announcements.manage', group: 'communication' },
  // module31 — barangay_admin only. Inter-agency (MSWDO/PSWDO/Police)
  // action requests that actually need barangay participation (e.g.
  // Barangay Protection Order) — never mixed with ordinary SOS,
  // shelter, or incident-report navigation, both of which this role no
  // longer has (see the removed sos.monitor/shelters.refer keys this
  // module's permissions.ts change documents).
  { to: '/admin/barangay-requests', label: 'Barangay Requests', icon: ClipboardCheck, permission: 'barangayRequests.manage', group: 'barangayOps' },
  { to: '/admin/users', label: 'Administrator Management', labelByRole: { municipal_admin: 'User Management' }, icon: Users, permission: 'admins.manage', group: 'administration' },
  { to: '/admin/audit-log', label: 'Audit Log', icon: History, permission: 'audit.view', group: 'system' },
  { to: '/admin/backups', label: 'Backup & Restore', icon: DatabaseBackup, permission: 'backups.manage', group: 'system' },
  { to: '/admin/roles-permissions', label: 'Roles & Permissions', icon: KeyRound, permission: 'roles.view', group: 'system' },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, permission: null, group: 'utility' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: null, group: 'utility' },
];

// law_enforcement ("Police Officer" in the UI — the role string itself
// is unchanged, see roleLabels.ts) gets zero items from the shared,
// permission-gated NAV_ITEMS above (deliberately excluded, same as
// shelter_admin/shelter_staff/support_expert — see NAV_ITEMS's own
// header comment) — its access is DB-assignment-scoped, not governed by
// lib/permissions.ts, so folding it into that shared matrix would
// misrepresent it as permission-gated. This small, separate array is
// rendered instead of NAV_ITEMS for this one role (see navItems below),
// and deliberately flat (no section labels) — a 6-item role-specific
// menu doesn't need categories forced onto it. Order matches the
// user-facing recommendation: overview -> SOS alerts -> case referrals
// -> reports -> analytics -> shared items. SOS access is now direct
// (module19 — every active police officer sees every SOS alert, no
// referral/assignment step); only "Incident Report Referrals"
// (case_id-set rows) remain assignment-gated, same as before. Reports
// and Analytics (module24/25) are listed here as two separate entries
// with permission: null like every other item in this array —
// law_enforcement does hold reports.view in permissions.ts (for
// RolesPermissionsPage/SettingsPage's own display), but this hardcoded
// array was never filtered by hasPermission() to begin with, so both
// entries are added directly rather than through that mechanism.
// Grouped the same way NAV_ITEMS above is for every other role, reusing
// the exact same group keys/labels (GROUP_LABEL, GROUP_ORDER) rather than
// inventing role-specific section names — e.g. 'emergency' already
// renders as "Emergency" for Municipal/Barangay/Provincial roles' SOS
// Monitoring item, so SOS Alerts reuses that label verbatim instead of a
// one-off "Emergency Response" just for this role. Section ORDER is
// Overview -> Case Management -> Emergency -> Reporting here (not
// Overview -> Emergency -> Case Management as a literal brief might
// suggest) because GROUP_ORDER is one shared array every role's sidebar
// renders through — Municipal Admin already has items in both 'cases'
// and 'emergency' (Case Management / SOS Monitoring), so reordering
// GROUP_ORDER to flip those two for this role would silently flip their
// section order too. Reusing the existing order here instead of
// special-casing law_enforcement is the actual "match the Municipal
// Administrator's navigation structure" outcome.
const LAW_ENFORCEMENT_NAV_ITEMS: NavItemDef[] = [
  { to: '/admin/dashboard', label: 'Police Dashboard', icon: LayoutDashboard, end: true, permission: null, group: 'overview' },
  { to: '/admin/law-enforcement/case-referrals', label: 'Incident Report Referrals', icon: ClipboardList, permission: null, group: 'cases' },
  { to: '/admin/law-enforcement/sos-referrals', label: 'SOS Alerts', icon: Siren, permission: null, group: 'emergency' },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, permission: null, group: 'reporting' },
  { to: '/admin/analytics', label: 'Analytics', icon: LineChart, permission: null, group: 'reporting' },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, permission: null, group: 'utility' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: null, group: 'utility' },
];

// shelter_admin (master prompt: "Separate SafeSpace Shelter Administrator
// Functions into Dedicated Navigation Pages") — a dedicated array, same
// precedent as LAW_ENFORCEMENT_NAV_ITEMS just above: these routes
// (/admin/shelter/*) belong to this role alone, so hasPermission()
// filtering (built for the shared, multi-role NAV_ITEMS below) doesn't
// apply here either. Notifications/Settings deliberately stay under the
// existing unlabeled 'utility' divider rather than new "Communication"/
// "Account" labels — every other role's sidebar already treats those two
// items the same bare way, and the Shelter Administrator sidebar mockup
// that accompanied this brief shows them with no bold label too (just
// spacing), matching 'utility' exactly rather than the brief's prose,
// which suggested two labels unlike anything else in this app.
const SHELTER_ADMIN_NAV_ITEMS: NavItemDef[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true, permission: null, group: 'overview' },
  { to: '/admin/shelter/information', label: 'Shelter Information', icon: Home, permission: null, group: 'shelter' },
  { to: '/admin/shelter/requests', label: 'Requests & Referrals', icon: ClipboardList, permission: null, group: 'requests' },
  { to: '/admin/shelter/occupancy', label: 'Occupancy & Placement', icon: Users, permission: null, group: 'occupancy' },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, permission: null, group: 'reporting' },
  { to: '/admin/analytics', label: 'Analytics', icon: LineChart, permission: null, group: 'reporting' },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, permission: null, group: 'communication' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: null, group: 'account' },
];

const SIDEBAR_COLLAPSED_KEY = 'safeher_admin_sidebar_collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return sessionStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const GROUP_ORDER: NavGroup[] = [
  'overview',
  'cases',
  'barangayOps',
  'shelter',
  'requests',
  'occupancy',
  'emergency',
  'services',
  'reporting',
  'communication',
  'account',
  'administration',
  'system',
  'utility',
];

export function AppLayout() {
  const { profile, municipality, barangay, shelter, roleTier } = useAuth();
  const { resolvedTheme } = useTheme();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [unreadCount, setUnreadCount] = useState(0);
  const isShelterAdmin = profile?.role === 'shelter_admin';
  const isShelterStaff = profile?.role === 'shelter_staff';
  const isSupportExpert = profile?.role === 'support_expert';
  const isLawEnforcement = profile?.role === 'law_enforcement';
  const navItems = useMemo(() => {
    if (profile?.role === 'law_enforcement') return LAW_ENFORCEMENT_NAV_ITEMS;
    if (profile?.role === 'shelter_admin') return SHELTER_ADMIN_NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.permission === null || hasPermission(profile?.role, item.permission)).map((item) => ({
      ...item,
      label: (profile?.role && item.labelByRole?.[profile.role]) ?? item.label,
    }));
  }, [profile?.role]);
  const sidebarLabel = profile ? ROLE_LABEL[profile.role] : '';

  // Grouped into the sidebar's labeled sections, in a fixed order, with
  // empty sections dropped entirely — a role whose permissions only ever
  // produce one real section (Dashboard) plus the universal Notifications/
  // Settings doesn't get a floating "Overview" label over a single link;
  // that's the "don't force categories on a small role" rule applied
  // automatically from the actual item count, rather than per-role.
  const groupedNav = useMemo(() => {
    const buckets = new Map<NavGroup, typeof navItems>();
    for (const item of navItems) {
      const list = buckets.get(item.group) ?? [];
      list.push(item);
      buckets.set(item.group, list);
    }
    const groups = GROUP_ORDER.map((group) => ({ group, items: buckets.get(group) ?? [] })).filter((g) => g.items.length > 0);
    const realSections = groups.filter((g) => g.group !== 'utility').length;
    return { groups, showLabels: realSections > 1 };
  }, [navItems]);

  // One-time-per-navigation count, not a live subscription — the header's
  // own NotificationBell already holds a realtime channel on this table
  // for the pages that render it; a second permanent channel here just to
  // badge the sidebar link would duplicate that for a number that's fine
  // being a little behind until the next route change.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    supabase
      .from('notifications')
      .select('notification_id', { count: 'exact', head: true })
      .eq('profile_id', profile.profile_id)
      .eq('is_read', false)
      .then(({ count }) => {
        if (!cancelled) setUnreadCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, location.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        sessionStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // best-effort only — collapse still works for this render, just won't persist
      }
      return next;
    });
  };

  return (
    <div data-theme={resolvedTheme} className="admin-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,38,0.45)', zIndex: 39 }}
        />
      )}

      {/* A proper column container, capped at exactly one viewport tall and
          clipped (overflow: hidden) — the nav list below is the ONLY part
          that scrolls internally when it's long (sidebar-nav-scroll, in
          theme.css). Header and footer are flex-shrink: 0, so neither the
          account footer nor the page's own scroll position can ever push
          Settings/Notifications/the footer outside this box or outside
          the blue background — that was the structural bug this fixes. */}
      <aside
        className={`app-sidebar${sidebarOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}
        style={{
          width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: collapsed ? '18px 14px' : '20px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: 8,
          }}
        >
          {collapsed ? (
            <div className="tooltip-anchor" data-tooltip="SafeSpace Administrative Portal">
              <LogoMark size={28} tone="onDark" />
            </div>
          ) : (
            <div>
              <LogoLockup size={28} tone="onDark" />
              <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginTop: 5 }}>
                {sidebarLabel}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
            >
              <ChevronsLeft size={15} strokeWidth={2} />
            </button>
          )}
        </div>

        {collapsed && (
          <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
            >
              <ChevronsRight size={15} strokeWidth={2} />
            </button>
          </div>
        )}

        <nav className="sidebar-nav-scroll" aria-label="Admin navigation">
          {groupedNav.groups.map(({ group, items }) => (
            <div className="sidebar-nav-group" key={group}>
              {group === 'utility' ? (
                <div className="sidebar-nav-divider" role="separator" />
              ) : (
                !collapsed && groupedNav.showLabels && (
                  <div className="sidebar-group-label" id={`sidebar-group-${group}`}>
                    {GROUP_LABEL[group]}
                  </div>
                )
              )}
              <div
                role={!collapsed && groupedNav.showLabels && group !== 'utility' ? 'group' : undefined}
                aria-labelledby={!collapsed && groupedNav.showLabels && group !== 'utility' ? `sidebar-group-${group}` : undefined}
                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}${collapsed ? ' tooltip-anchor' : ''}`}
                    data-tooltip={collapsed ? item.label : undefined}
                    aria-label={item.label}
                  >
                    <item.icon size={18} strokeWidth={1.75} />
                    {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
                    {!collapsed && item.to === '/admin/notifications' && unreadCount > 0 && (
                      <span className="sidebar-nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Logging out lives in Settings > Danger Zone now — this footer is
            purely identity. Always rendered (never clipped/overlapped by
            nav, guaranteed by the column/overflow structure above):
            full name + coverage when expanded, a compact initials avatar
            with the same info in a tooltip when collapsed. */}
        {collapsed ? (
          <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '12px 0 16px', borderTop: '1px solid var(--sidebar-border)' }}>
            <div
              className="sidebar-account-avatar tooltip-anchor"
              data-tooltip={`${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Account'}
            >
              {(profile?.first_name?.[0] ?? '').toUpperCase()}
              {(profile?.last_name?.[0] ?? '').toUpperCase()}
            </div>
          </div>
        ) : (
          <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid var(--sidebar-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--sidebar-hover-text)' }}>
              {profile?.first_name} {profile?.last_name}
            </p>
            <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)' }}>
              {isShelterAdmin || isShelterStaff
                ? (shelter?.shelter_name ?? '—')
                : isSupportExpert
                  ? 'Confidential support'
                  : isLawEnforcement
                    ? 'Assigned referrals only'
                    : roleTier === 'province'
                    ? 'Coverage: Aurora Province'
                    : roleTier === 'barangay'
                      ? `Barangay ${barangay?.barangay_name ?? '—'}, ${municipality?.municipality_name ?? '—'}`
                      : (municipality?.municipality_name ?? '—')}
            </p>
          </div>
        )}
      </aside>

      <div className="app-main" style={{ flex: 1, maxWidth: 1200, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          className="mobile-topbar"
          style={{
            display: 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <LogoLockup size={26} />
          <button
            className="btn btn-outline btn-sm"
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
        <main style={{ padding: 32, flex: 1, minWidth: 0 }}>
          {/* Keyed by pathname so each route change gets its own fresh fade
              + slight-rise entrance rather than the outgoing page's
              animation state carrying over. */}
          <div key={location.pathname} className="page-transition">
            <AdminErrorBoundary>
              <Outlet />
            </AdminErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}

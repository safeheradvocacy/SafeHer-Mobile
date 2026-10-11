import type { UserRole } from '../types/database.types';

/**
 * SafeHer Admin — code-level permission model (RBAC split, module11).
 *
 * There is no DB-editable permission table in this project — building
 * one safely would mean rewriting the RLS architecture across 9 prior
 * schema modules, which is out of scope for this pass (see
 * module11_provincial_staff_rbac.sql's header). This file is instead
 * the single source of truth the SIDEBAR (AppLayout.tsx) and ROUTE
 * GUARDS (App.tsx, via rolesWithPermission) both derive from, so
 * "what's shown" and "what's reachable" can never drift apart — and
 * it's what RolesPermissionsPage.tsx displays as the actual enforced
 * model, not a fabricated one.
 *
 * This is forward-compatible with a real DB-backed permission table
 * later: callers only ever go through hasPermission()/rolesWithPermission(),
 * never read ROLE_PERMISSIONS directly, so the resolution mechanism
 * could change without touching any call site.
 *
 * IMPORTANT: this is a UI-layer convenience, not the actual security
 * boundary — the database's RLS policies (see supabase/module*.sql)
 * are what actually enforce access. Never treat a permission check
 * here as sufficient authorization on its own.
 */
export type PermissionKey =
  | 'cases.view'
  | 'sos.monitor'
  | 'identity.verify'
  | 'municipalities.manage'
  | 'barangays.manage'
  | 'shelters.refer'
  | 'shelters.manage'
  | 'support.manage'
  | 'faqs.manage'
  | 'reports.view'
  | 'admins.manage'
  | 'audit.view'
  | 'roles.view'
  | 'backups.manage';

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  'cases.view': 'View and manage case reports',
  'sos.monitor': 'Monitor SOS alerts',
  'identity.verify': 'Review identity verification submissions',
  'municipalities.manage': 'Manage municipality records',
  'barangays.manage': 'Manage barangay records',
  'shelters.refer': 'Refer cases to shelters',
  'shelters.manage': 'Manage shelter records and capacity',
  'support.manage': 'Manage the expert support queue',
  'faqs.manage': 'Manage FAQ content',
  'reports.view': 'View reports and analytics',
  'admins.manage': 'Create and manage administrator accounts',
  'audit.view': 'View the province-wide audit log',
  'roles.view': 'View the role/permission model',
  'backups.manage': 'Manage system backups and the backup schedule',
};

// Deliberately grouped to mirror the module list a reader would
// recognize from the app itself — used by RolesPermissionsPage.tsx.
export const PERMISSION_MODULES: { module: string; keys: PermissionKey[] }[] = [
  { module: 'Case & Emergency Operations', keys: ['cases.view', 'sos.monitor', 'identity.verify'] },
  { module: 'Geographic & Shelter Coordination', keys: ['municipalities.manage', 'barangays.manage', 'shelters.refer', 'shelters.manage'] },
  { module: 'Support Services', keys: ['support.manage', 'faqs.manage'] },
  { module: 'Reporting', keys: ['reports.view'] },
  { module: 'System Administration', keys: ['admins.manage', 'audit.view', 'roles.view', 'backups.manage'] },
];

// survivor, shelter_admin, shelter_staff, support_expert, and
// law_enforcement otherwise hold no keys here — none of the OTHER
// permission gates apply to their (entirely separate) dashboards/
// work queues, which are reached without going through NAV_ITEMS or
// requireRole at all. reports.view (module24) is the one exception:
// each of the four now has its own role-appropriate Reports &
// Analytics page (see ReportsRouter.tsx), sourced from the exact same
// RLS-scoped tables/hooks their dashboard already uses — not the
// case_reports-centric page the other roles below share.
const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {
  survivor: new Set(),
  // reports.view added here (module13) — barangay-scoped Case
  // Management Reports & Analytics, enforced by the same
  // admin_can_access_case_active() barangay branch already live on
  // case_reports. Mirrors the access it already has on cases.view/
  // sos.monitor rather than granting anything new in kind.
  barangay_admin: new Set<PermissionKey>(['cases.view', 'sos.monitor', 'identity.verify', 'shelters.refer', 'reports.view']),
  municipal_admin: new Set<PermissionKey>([
    'cases.view', 'sos.monitor', 'identity.verify', 'barangays.manage', 'shelters.refer', 'shelters.manage', 'reports.view', 'admins.manage',
  ]),
  // Province-wide OPERATIONAL access — the exact same modules
  // provincial_admin's UI used to expose, minus admins.manage/audit.view/
  // roles.view (technical-only, stay with provincial_admin).
  provincial_staff: new Set<PermissionKey>([
    'cases.view', 'sos.monitor', 'identity.verify', 'municipalities.manage', 'barangays.manage',
    'shelters.refer', 'shelters.manage', 'support.manage', 'faqs.manage', 'reports.view',
  ]),
  // Redefined as technical/system administration only — no operational
  // modules by default (confirmed design decision). Underlying database
  // access is unchanged (see is_provincial_admin() in module11); this is
  // strictly a UI/route-guard scope, not the database's actual limit.
  //
  // backups.manage (module16) is the FIRST permission key that
  // deliberately excludes provincial_staff even though provincial_staff
  // shares every other province-wide capability — backup/restore is
  // technical administration, not operational case management, and is
  // backed by is_provincial_technical_admin() at the database layer
  // (narrower than is_provincial_admin(), which provincial_staff passes
  // for everything else). Do not add it to provincial_staff's set.
  //
  // reports.view added here (module24) — is_provincial_admin() has
  // always granted provincial_admin/super_admin identical case_reports/
  // sos_alerts/shelter_referrals access to provincial_staff's; the
  // Reports page was simply never reachable from this role's UI before.
  // No new conditional logic needed — ReportsRouter.tsx gives both the
  // exact same province-wide ReportsPage provincial_staff already uses.
  provincial_admin: new Set<PermissionKey>(['admins.manage', 'audit.view', 'roles.view', 'backups.manage', 'reports.view']),
  super_admin: new Set<PermissionKey>(['admins.manage', 'audit.view', 'roles.view', 'backups.manage', 'reports.view']),
  // reports.view only (module24) — each gets its own role-scoped
  // Reports & Analytics page (ReportsRouter.tsx), not the shared
  // case_reports-centric ReportsPage above.
  shelter_admin: new Set<PermissionKey>(['reports.view']),
  shelter_staff: new Set<PermissionKey>(['reports.view']),
  support_expert: new Set<PermissionKey>(['reports.view']),
  law_enforcement: new Set<PermissionKey>(['reports.view']),
};

export function hasPermission(role: UserRole | undefined | null, key: PermissionKey): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(key) ?? false;
}

/** Every role that holds a given permission — used to build a route's
 * `requireRole` array from the same source of truth the sidebar uses,
 * so a route guard and its nav item can never silently disagree. */
export function rolesWithPermission(key: PermissionKey): UserRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter((r) => ROLE_PERMISSIONS[r].has(key));
}

export function permissionsFor(role: UserRole | undefined | null): PermissionKey[] {
  if (!role) return [];
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

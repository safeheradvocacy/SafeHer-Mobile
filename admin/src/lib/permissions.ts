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
  | 'backups.manage'
  | 'announcements.manage'
  | 'barangayRequests.manage'
  | 'police.manage';

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
  'announcements.manage': 'Create, publish, and manage provincial announcements',
  'barangayRequests.manage': 'Review and respond to inter-agency barangay action requests',
  'police.manage': 'View and manage Police Officer accounts and assignments',
};

// Deliberately grouped to mirror the module list a reader would
// recognize from the app itself — used by RolesPermissionsPage.tsx.
export const PERMISSION_MODULES: { module: string; keys: PermissionKey[] }[] = [
  { module: 'Case & Emergency Operations', keys: ['cases.view', 'sos.monitor', 'identity.verify'] },
  { module: 'Geographic & Shelter Coordination', keys: ['municipalities.manage', 'barangays.manage', 'shelters.refer', 'shelters.manage'] },
  { module: 'Support Services', keys: ['support.manage', 'faqs.manage'] },
  { module: 'Communication', keys: ['announcements.manage'] },
  { module: 'Barangay Operations', keys: ['barangayRequests.manage'] },
  { module: 'Personnel Administration', keys: ['police.manage'] },
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
  // Management Reports & Analytics, enforced by admin_can_access_
  // case_active()'s barangay branch, already live on case_reports.
  //
  // module31 — sos.monitor and shelters.refer REMOVED here (master
  // prompt: "Redesign Barangay Admin Access"). Audit confirmed
  // barangay_admin never had shelters.manage/support.manage/
  // faqs.manage to begin with, so this is the entire nav-reduction
  // this role needed — no standalone SOS Monitoring or Shelters &
  // Referrals page, and (per App.tsx's route guards, not just this
  // hidden nav item) no reachable route either. identity.verify and
  // cases.view are UNCHANGED — this role still does ordinary case
  // work, just not SOS/shelter operations, which were never genuinely
  // barangay-tier functions. barangayRequests.manage (module31) is
  // the one new capability added: the dedicated Barangay Requests
  // page for MSWDO/PSWDO/Police-originated action requests, held by
  // this role alone.
  // police.manage (module32) is deliberately NOT granted here — Police
  // Officer account administration is a province-tier-only module
  // (provincial_staff/provincial_admin/super_admin); Municipal Admin
  // (MSWDO) does not get a Police Management surface at all.
  barangay_admin: new Set<PermissionKey>(['cases.view', 'identity.verify', 'reports.view', 'barangayRequests.manage']),
  municipal_admin: new Set<PermissionKey>([
    'cases.view', 'sos.monitor', 'identity.verify', 'barangays.manage', 'shelters.refer', 'shelters.manage', 'reports.view', 'admins.manage',
  ]),
  // Province-wide OPERATIONAL access — the exact same modules
  // provincial_admin's UI used to expose, minus admins.manage/audit.view/
  // roles.view (technical-only, stay with provincial_admin).
  // announcements.manage (module28) added here ONLY — Provincial Staff
  // is the sole announcement publisher by explicit design. It is
  // deliberately NOT added to provincial_admin/super_admin below, even
  // though is_provincial_admin() at the database layer already includes
  // provincial_staff for other operational tables: announcements use
  // their OWN narrower is_provincial_staff() RLS helper (module28),
  // which excludes provincial_admin/super_admin entirely — so this
  // isn't just a hidden UI gate, the database itself denies them.
  // police.manage (module32) — province-wide Police Officer directory
  // view + the narrow update capability create-admin-user actually
  // grants this role (reassign municipality, name/phone, activate/
  // deactivate) — never account creation, which stays province-
  // ADMIN-tier-only (see that Edge Function's own comments). Police
  // Management is a PROVINCE-TIER-ONLY module — Municipal Admin (MSWDO)
  // does not hold this key (see that role's own set above).
  provincial_staff: new Set<PermissionKey>([
    'cases.view', 'sos.monitor', 'identity.verify', 'municipalities.manage', 'barangays.manage',
    'shelters.refer', 'shelters.manage', 'support.manage', 'faqs.manage', 'reports.view', 'announcements.manage', 'police.manage',
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
  // police.manage added here too (module32) — provincial_admin/
  // super_admin already have full create+update reach over
  // law_enforcement accounts via admins.manage/create-admin-user; this
  // key only gates the NEW dedicated Police Management nav item/page,
  // a focused alternative to the generic Administrator Management
  // table, not a new capability.
  // reports.view removed (provincial_admin/super_admin are the
  // technical/system-administration tier — reports, analytics, and
  // announcements stay with municipal_admin and provincial_staff).
  provincial_admin: new Set<PermissionKey>(['admins.manage', 'audit.view', 'roles.view', 'backups.manage', 'police.manage']),
  super_admin: new Set<PermissionKey>(['admins.manage', 'audit.view', 'roles.view', 'backups.manage', 'police.manage']),
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

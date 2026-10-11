import type { UserRole } from '../types/database.types';

/**
 * One consolidated role display-name map — replaces the four
 * independently-maintained (and disagreeing) copies that used to live
 * in UserManagementPage.tsx, ProfileMenu.tsx, AppLayout.tsx's
 * TIER_LABEL, and SettingsPage.tsx's inline ternary. Every screen that
 * shows a role name to a user should import this instead of
 * re-deriving its own label.
 *
 * 'super_admin' is retired (never creatable — see database.types.ts)
 * but kept here since existing accounts can still carry the label.
 *
 * 'shelter_staff' is retired too (role consolidation,
 * module24_retire_shelter_staff_role.sql) — shelter_admin is now the
 * single official shelter role. Existing shelter_staff accounts are
 * migrated to shelter_admin by that one-time SQL migration; this label
 * stays only for any account not yet converted.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  survivor: 'Survivor',
  municipal_admin: 'Municipal Administrator',
  provincial_admin: 'Provincial Administrator',
  provincial_staff: 'Provincial Staff',
  super_admin: 'Super Administrator (Retired)',
  barangay_admin: 'Barangay VAWC Officer',
  shelter_admin: 'Shelter Administrator',
  shelter_staff: 'Shelter Staff (Retired)',
  support_expert: 'Support Expert',
  // Internal role string stays `law_enforcement` (RLS, routes, grants all
  // reference it) — only this display label changed, per the SafeSpace
  // rebrand's "Police Officer" terminology (module19).
  law_enforcement: 'Police Officer',
};

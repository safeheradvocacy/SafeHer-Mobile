import type { Gender } from '../types/database.types';

/**
 * Survivor demographic fields shared between the mobile self-service
 * profile edit and the admin case-detail edit — kept in exactly one
 * place per app (this file is the admin-side copy; mobile has its own
 * textually-identical copy at mobile/src/lib/survivorInfo.ts, since the
 * two apps don't share a package — same convention already used for
 * fixed option lists like CaseType's TYPES arrays).
 *
 * No standardized Philippine educational-attainment classification
 * exists anywhere else in this codebase (confirmed by inspection before
 * adding this) — this is a conservative, general-purpose list, not an
 * official government classification being invented here.
 */
export const EDUCATIONAL_ATTAINMENT_OPTIONS = [
  'No formal education',
  'Elementary',
  'Junior High School',
  'Senior High School',
  'Vocational/Technical',
  'College',
  'Postgraduate',
  'Not Applicable',
  'Prefer not to say',
] as const;

export type EducationalAttainment = (typeof EDUCATIONAL_ATTAINMENT_OPTIONS)[number];

// Reuses the existing Gender enum/type (database.types.ts) — never a
// second, competing "Sex" type. The official government templates'
// "Sex" column maps directly to this value as-is (Male/Female); 'Other'
// prints literally rather than being forced into a binary it doesn't
// fit — see governmentReportRows.ts for where that's rendered.
export const SEX_OPTIONS: Gender[] = ['Male', 'Female', 'Other'];

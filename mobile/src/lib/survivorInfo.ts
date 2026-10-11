import type { Gender } from '../types/database.types';

/**
 * Survivor demographic fields shared between the mobile self-service
 * profile edit and the admin case-detail edit — kept in exactly one
 * place per app (this is the mobile-side copy; admin has its own
 * textually-identical copy at admin/src/lib/survivorInfo.ts, since the
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
// second, competing "Sex" type.
export const SEX_OPTIONS: Gender[] = ['Male', 'Female', 'Other'];

// Year/Month/Day dropdown options — a "proper date picker" built from
// three constrained selectors rather than a native calendar-picker
// dependency. No native date-picker library (e.g.
// @react-native-community/datetimepicker) is part of this project today,
// and adding one is a real native module, not a JS-only change — it
// would need a custom dev client / EAS build to actually load, and this
// app is tested through Expo Go, which only loads the native modules it
// shipped with. Three plain dropdowns reusing the existing DropdownInput
// component avoid that risk entirely while still making impossible
// dates unselectable BY CONSTRUCTION rather than by regex: the year list
// never includes the future, and the day list is always bounded to
// however many days the selected month/year actually has (28–31,
// leap-year-aware), so there's no way to end up with e.g. "February 30".
export const MONTH_OPTIONS: { label: string; value: string }[] = [
  { label: 'January', value: '01' },
  { label: 'February', value: '02' },
  { label: 'March', value: '03' },
  { label: 'April', value: '04' },
  { label: 'May', value: '05' },
  { label: 'June', value: '06' },
  { label: 'July', value: '07' },
  { label: 'August', value: '08' },
  { label: 'September', value: '09' },
  { label: 'October', value: '10' },
  { label: 'November', value: '11' },
  { label: 'December', value: '12' },
];

// Matches validateDateOfBirth's own "implausibly old" boundary below —
// newest-first, since a birth year is far more likely to be recent.
const MAX_AGE_YEARS = 120;

export function getYearOptions(): { label: string; value: string }[] {
  const currentYear = new Date().getFullYear();
  const years: { label: string; value: string }[] = [];
  for (let y = currentYear; y >= currentYear - MAX_AGE_YEARS; y--) {
    years.push({ label: String(y), value: String(y) });
  }
  return years;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Day options bounded to the selected year/month — falls back to 31
 * (the widest possible) when year/month aren't chosen yet, so the day
 * dropdown is never empty before the others are filled in. */
export function getDayOptions(year: string | null, month: string | null): { label: string; value: string }[] {
  const count = year && month ? daysInMonth(Number(year), Number(month)) : 31;
  return Array.from({ length: count }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return { label: d, value: d };
  });
}

export function composeIsoDate(year: string, month: string, day: string): string {
  return `${year}-${month}-${day}`;
}

/** Splits an existing stored YYYY-MM-DD value back into the three
 * dropdowns' values, for editing an already-set date of birth. */
export function parseIsoDate(iso: string | null | undefined): { year: string; month: string; day: string } {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return { year: '', month: '', day: '' };
  return { year: match[1], month: match[2], day: match[3] };
}

export interface SurvivorDemographics {
  date_of_birth: string | null;
  gender: string | null;
  educational_attainment: string | null;
}

/** Whether all three demographic fields required at registration are
 * present — used to decide whether an existing (pre-this-feature)
 * account should see a "complete your information" nudge in Profile.
 * Never used to block login/navigation, only to show that nudge. */
export function isSurvivorInfoComplete(survivor: SurvivorDemographics | null | undefined): boolean {
  return !!(survivor?.date_of_birth && survivor?.gender && survivor?.educational_attainment);
}

/**
 * Validates a YYYY-MM-DD date-of-birth string (composed from the
 * Year/Month/Day dropdowns above, or already stored). Rejects malformed
 * input, impossible calendar dates, future dates, and implausibly old
 * ones, without imposing an arbitrary minimum-age restriction.
 */
export function validateDateOfBirth(value: string): { valid: true; iso: string } | { valid: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true, iso: '' }; // optional field — blank clears it
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return { valid: false, error: 'Enter the date as YYYY-MM-DD, e.g. 1998-05-14.' };

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(year, month - 1, day);
  const isRealCalendarDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  if (!isRealCalendarDate) return { valid: false, error: 'That is not a real calendar date.' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getTime() > today.getTime()) return { valid: false, error: 'Date of birth cannot be in the future.' };

  const earliestPlausible = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate());
  if (date.getTime() < earliestPlausible.getTime()) return { valid: false, error: 'Please double-check this date.' };

  return { valid: true, iso: trimmed };
}

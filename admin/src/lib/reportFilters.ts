import type { RoleTier } from '../contexts/AuthContext';
import type { CaseSource, CaseStatus, CaseType, PriorityLevel, ReferralStatus, UserProfile } from '../types/database.types';

/**
 * Case Management Reports filter shape — every field maps directly to a
 * real case_reports/shelter_referrals column or a real enum value.
 * Nothing here is a fabricated option (see ReportsPage.tsx for where
 * each field's dropdown options come from). This exact shape is also
 * what gets persisted into saved_reports.filters (jsonb) — see
 * clampFiltersToScope() below for why a stored value is never trusted
 * blindly on reopen.
 */
/** General = the existing PII-free Case Management Report (unchanged).
 * WEDC/CNSP/CICL = the three official government templates — see
 * governmentReportMapping.ts for how a case lands in WEDC vs. CNSP
 * (age-derived) and why CICL always renders empty today. */
export type GovernmentReportType = 'General' | 'WEDC' | 'CNSP' | 'CICL';

export type ReportingPeriodPreset = 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual' | 'Custom';

export interface CaseReportFilters {
  reportType: GovernmentReportType;
  periodPreset: ReportingPeriodPreset;
  dateFrom: string; // yyyy-mm-dd, '' = unset — the report-received date (reported_at), never last_updated_at
  dateTo: string; // yyyy-mm-dd, '' = unset
  status: CaseStatus | '';
  caseType: CaseType | '';
  priority: PriorityLevel | '';
  municipalityId: string; // only meaningful for provincial_staff (drill-down)
  barangayId: string; // meaningful for provincial_staff + municipal_admin (drill-down)
  assignedTo: string; // profile_id, from case_assignments
  referralStatus: ReferralStatus | '';
  source: CaseSource | ''; // Report Source (module14): All / Mobile / Walk-In
  // Government-report certification signatories — plain configurable
  // text, never auto-filled from a name the system doesn't actually
  // know belongs in that role. Persisted in saved_reports.filters like
  // every other field here; printing a generated PDF never implies
  // these people have actually signed it (see governmentReportDocument.ts).
  preparedBy: string;
  certifiedCorrectBy: string;
  notedBy: string;
}

export const EMPTY_FILTERS: CaseReportFilters = {
  reportType: 'General',
  periodPreset: 'Custom',
  dateFrom: '',
  dateTo: '',
  status: '',
  caseType: '',
  priority: '',
  municipalityId: '',
  barangayId: '',
  preparedBy: '',
  certifiedCorrectBy: '',
  notedBy: '',
  assignedTo: '',
  referralStatus: '',
  source: '',
};

function ymd(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Computes a non-overlapping [dateFrom, dateTo] window for a Reporting
 * Period preset, anchored to a reference date (defaults to today). The
 * presets are built to butt up against each other with zero overlap
 * (Jan 1–31, Feb 1–28, …) specifically so switching presets can never
 * double-count a case that falls on a period boundary — the brief's
 * "avoid double-counting a case across periods" requirement. Returns
 * null for 'Custom', meaning: leave whatever dateFrom/dateTo the user
 * already typed alone.
 */
export function computePeriodRange(preset: ReportingPeriodPreset, anchor: Date = new Date()): { dateFrom: string; dateTo: string } | null {
  const year = anchor.getFullYear();
  const month = anchor.getMonth(); // 0-11

  if (preset === 'Monthly') {
    return { dateFrom: ymd(new Date(year, month, 1)), dateTo: ymd(new Date(year, month + 1, 0)) };
  }
  if (preset === 'Quarterly') {
    const q = Math.floor(month / 3);
    return { dateFrom: ymd(new Date(year, q * 3, 1)), dateTo: ymd(new Date(year, q * 3 + 3, 0)) };
  }
  if (preset === 'Semi-Annual') {
    const half = month < 6 ? 0 : 1;
    return { dateFrom: ymd(new Date(year, half * 6, 1)), dateTo: ymd(new Date(year, half * 6 + 6, 0)) };
  }
  if (preset === 'Annual') {
    return { dateFrom: ymd(new Date(year, 0, 1)), dateTo: ymd(new Date(year, 11, 31)) };
  }
  return null; // Custom
}

/**
 * Re-clamps geographic filter values to the CURRENT user's authorized
 * scope — called both when filters change live in the UI (so a
 * municipal_admin/barangay_admin never sees a picker for anything but
 * their own jurisdiction) and, critically, when a saved report is
 * reopened (so a stored municipality_id/barangay_id from a JSONB
 * column is never trusted at face value). This is defense-in-depth:
 * case_reports/shelter_referrals/sos_alerts' own RLS policies already
 * guarantee no unauthorized row can ever be returned regardless of
 * what filter value is requested — this just keeps the UI honest and
 * avoids a confusing "filter silently returns nothing" experience.
 */
export function clampFiltersToScope(
  filters: CaseReportFilters,
  roleTier: RoleTier | null,
  profile: UserProfile | null
): CaseReportFilters {
  if (roleTier === 'barangay') {
    return { ...filters, municipalityId: profile?.municipality_id ?? '', barangayId: profile?.barangay_id ?? '' };
  }
  if (roleTier === 'municipality') {
    return { ...filters, municipalityId: profile?.municipality_id ?? '' };
  }
  return filters;
}

// Fields that are report CONFIGURATION, not case filters — reportType
// defaults to 'General' and periodPreset to 'Custom' (both always
// non-empty), and the signatory fields are never "filters" in the
// case-query sense, so none of them should make hasActiveFilters()
// true on an otherwise-untouched filter set.
const NON_FILTER_KEYS = new Set<keyof CaseReportFilters>(['reportType', 'periodPreset', 'preparedBy', 'certifiedCorrectBy', 'notedBy']);

export function hasActiveFilters(filters: CaseReportFilters): boolean {
  return (Object.entries(filters) as [keyof CaseReportFilters, string][]).some(([key, v]) => !NON_FILTER_KEYS.has(key) && v !== '');
}

// Aurora Province, Philippines operates in a single zone (Asia/Manila,
// UTC+8, no DST). Every dateFrom/dateTo value in this app is a plain
// yyyy-mm-dd CIVIL date the user picked, meant as a Manila calendar day
// — so its boundaries must be anchored to MANILA midnight, not the
// browser's local midnight (an admin's OS clock/timezone is unverified)
// and not UTC midnight (what Postgres/PostgREST casts a bare date
// literal to by default, and what `new Date(\`${d}T00:00:00\`)` resolves
// to only when the browser itself happens to be UTC). Getting this
// wrong silently shifts every date-range boundary by up to 8 hours —
// e.g. a case reported at 3 AM Manila time on the 2nd is actually
// 7 PM UTC on the 1st, so a naive UTC-anchored "from the 2nd" filter
// drops it even though, to the person who reported it, it plainly
// happened "on the 2nd." This was the root cause behind several
// Analytics/Reports pages appearing to filter correctly in testing
// (same-timezone browser) while silently losing records near midnight
// for anyone else, or when compared against the PDF's own count.
const PH_OFFSET = '+08:00';

/** Inclusive LOWER bound, as a real UTC instant — Manila-local midnight
 * of `dateFrom`. Empty string in, empty string back (caller should
 * check for an unset filter before calling, same as before). */
export function dateFilterLowerBoundIso(dateFrom: string): string {
  return new Date(`${dateFrom}T00:00:00${PH_OFFSET}`).toISOString();
}

/** Exclusive UPPER bound, as a real UTC instant — Manila-local midnight
 * of the day AFTER `dateTo`, so a record timestamped anywhere during
 * `dateTo` (as a Manila calendar day) is included rather than silently
 * excluded (the classic date-range boundary bug), without the timezone
 * error described above. */
export function dateFilterUpperBoundIso(dateTo: string): string {
  const d = new Date(`${dateTo}T00:00:00${PH_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * The one correct way to test whether an ISO timestamp (as returned by
 * Postgres, in whatever valid ISO 8601 form it comes back in) falls
 * within a Manila-calendar-day [dateFrom, dateTo] window. Always parses
 * to a real instant and compares numerically — never compare ISO
 * timestamp STRINGS directly with `<`/`>=` (lexicographic string order
 * is only reliable when both sides share the exact same format/
 * precision/timezone suffix, which a hand-built browser string and a
 * Postgres-returned string do not). Replaces the `iso <
 * \`${dateFrom}T00:00:00\`` pattern previously duplicated — with the
 * same timezone bug — across every role-specific Analytics/Reports page.
 */
export function isWithinDateFilter(iso: string | null | undefined, dateFrom: string, dateTo: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (dateFrom && t < Date.parse(dateFilterLowerBoundIso(dateFrom))) return false;
  if (dateTo && t >= Date.parse(dateFilterUpperBoundIso(dateTo))) return false;
  return true;
}

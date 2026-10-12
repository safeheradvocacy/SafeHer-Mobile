/**
 * The one centralized filename-generation utility for report exports —
 * used by both the PDF and CSV export paths (see ReportsPage.tsx) so
 * filename logic never has to be duplicated or drift between formats.
 *
 * Report Name -> Normalize -> Sanitize -> Optional timestamp -> .ext
 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** yyyy-mm-dd_HHmm in the browser's local time — matches how every other
 * timestamp in this admin app is already displayed (toLocaleString with
 * no explicit timezone override), so the filename and the PDF's own
 * "Generated" timestamp always agree. */
export function filenameTimestamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Preserves the user's meaningful report name — only replaces
 * characters that are actually invalid/risky in a filename, collapses
 * whitespace to single underscores, and never destroys the name down
 * to nothing (falls back to a sensible default only if literally
 * nothing usable remains). */
function sanitizeReportName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed
    .replace(/[\\/:*?"<>|]/g, '') // characters invalid on Windows/most filesystems
    .replace(/\s+/g, '_');
  return safe || 'Case_Management_Report';
}

export function buildReportFilename(
  reportName: string,
  extension: 'pdf' | 'csv',
  options: { includeTimestamp?: boolean; date?: Date } = {}
): string {
  const { includeTimestamp = true, date = new Date() } = options;
  const base = sanitizeReportName(reportName);
  return includeTimestamp ? `${base}_${filenameTimestamp(date)}.${extension}` : `${base}.${extension}`;
}

/**
 * Government report filenames follow a different, date-range-based
 * convention from buildReportFilename above (e.g.
 * SafeSpace_WEDC_2026-01-01_to_2026-01-31.csv) — a fixed, predictable
 * shape officials can recognize at a glance, rather than a free-text
 * report title + timestamp. Falls back to "all" for an unset date
 * bound rather than an empty string in the filename.
 */
/**
 * Analytics PDF filenames follow the brief's own convention
 * (SafeSpace_Analytics_<Scope>_<period>.pdf) — a predictable, scope-
 * and-period-based shape, matching buildGovernmentReportFilename's
 * approach rather than the free-text+timestamp one above. `scope` is
 * sanitized the same way a free-text report name is (no invalid
 * filesystem characters, no raw PII) and should be a short tier label
 * such as "Provincial"/"Municipal"/"Barangay"/"Police"/"Shelter"/
 * "Support" — never a survivor's name or any case-level identifier.
 */
export function buildAnalyticsReportFilename(scope: string, dateFrom: string, dateTo: string): string {
  const safeScope = sanitizeReportName(scope).replace(/_Report$/, '');
  const from = dateFrom || 'all';
  const to = dateTo || 'present';
  return `SafeSpace_Analytics_${safeScope}_${from}_to_${to}.pdf`;
}

export function buildGovernmentReportFilename(
  reportType: 'General' | 'WEDC' | 'CNSP' | 'CICL',
  dateFrom: string,
  dateTo: string,
  extension: 'pdf' | 'csv'
): string {
  const from = dateFrom || 'all';
  const to = dateTo || 'present';
  return `SafeSpace_${reportType}_${from}_to_${to}.${extension}`;
}

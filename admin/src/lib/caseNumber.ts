/**
 * Generates a human-readable case number — the exact same format/logic
 * as mobile's `generateCaseNumber` (mobile/src/lib/audit.ts), reused
 * verbatim so walk-in cases created here and mobile-submitted cases
 * never compete on numbering scheme. Assumes the existing
 * `case_reports.case_number` column has no DB-side default/trigger
 * (confirmed true — see that file's own comment).
 */
export function generateCaseNumber(municipalityName: string): string {
  const code = municipalityName.slice(0, 3).toUpperCase();
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${code}-${y}${m}${d}-${rand}`;
}

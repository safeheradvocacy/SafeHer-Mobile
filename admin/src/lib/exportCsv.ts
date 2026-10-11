/**
 * Dependency-free CSV export — Blob + URL.createObjectURL + a hidden
 * <a download>. No export library exists anywhere in this codebase
 * today (confirmed by audit); adding one just for CSV would be an
 * unnecessary dependency for something the browser already does
 * natively. PDF/XLSX are NOT implemented for the same reason — see
 * ReportsPage.tsx's own note on this.
 */
export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[]
) {
  const escape = (value: unknown): string => {
    const s = value == null ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(','));
  // Leading BOM so Excel opens UTF-8 (e.g. ñ in names/addresses) correctly
  // instead of guessing the wrong codepage.
  const csv = '﻿' + [header, ...lines].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

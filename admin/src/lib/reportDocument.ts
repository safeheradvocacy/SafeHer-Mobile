import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportRow } from './reportRows';

/**
 * Real, paginated PDF document generation via jsPDF + jspdf-autotable —
 * pure-vector text/tables/lines, never a screenshot of the browser/DOM.
 * Every value drawn here is passed in from the SAME authorized dataset
 * already driving the Reports/Analytics tabs (see ReportsPage.tsx) —
 * this module does no querying of its own and has no knowledge of
 * Supabase; it is a pure function of data already in hand.
 *
 * Layout is deliberately plain/institutional (see plan's Design
 * Decision 2 — analytics are rendered as tables, not chart images).
 */

// Exported so other document generators (e.g. lib/qrSheet.ts) share the
// exact same page geometry/brand palette rather than redeclaring their
// own copy that could drift.
export const PAGE_WIDTH = 210; // A4, mm
export const PAGE_HEIGHT = 297;
export const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 16; // mm reserved at the bottom of every page for the footer
export const BRAND_PRIMARY = '#0B3A82'; // matches --color-primary-dark (theme.css)
export const BRAND_ACCENT = '#2F80C9'; // matches --color-primary-accent (theme.css)
export const TEXT_BODY = '#172033'; // matches --color-text (theme.css)
export const TEXT_MUTED = '#526070'; // matches --color-text-muted (theme.css)
export const BORDER = '#D9E2EC'; // matches --color-border (theme.css)
export const HEADER_FILL_LIGHT = '#EAF3FB'; // matches --color-primary-light (theme.css)
export const ROW_ALT_FILL = '#F7FAFD';

export interface DistributionRow {
  label: string;
  count: number;
}

export interface ReportPdfParams {
  reportTitle: string;
  reportId?: string | null;
  generatedByName: string;
  generatedByRole: string;
  scopeLabel: string;
  dateFrom: string; // yyyy-mm-dd or ''
  dateTo: string;
  appliedFilterLines: string[];
  summary: DistributionRow[];
  statusDistribution: DistributionRow[];
  classificationDistribution: DistributionRow[];
  sourceDistribution: DistributionRow[]; // Mobile vs Walk-In (module14)
  geographicDistribution: DistributionRow[] | null;
  geographicLabel: string;
  referralDistribution: DistributionRow[];
  sosSummary: { total: number; byStatus: DistributionRow[] } | null;
  rows: ReportRow[];
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function reportingPeriodLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return 'All available records';
  if (dateFrom && dateTo) return `${formatDisplayDate(dateFrom)} – ${formatDisplayDate(dateTo)}`;
  if (dateFrom) return `From ${formatDisplayDate(dateFrom)}`;
  return `Through ${formatDisplayDate(dateTo)}`;
}

export function distributionTable(doc: jsPDF, y: number, title: string, data: DistributionRow[], valueLabel = 'Count'): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text(title, MARGIN, y);
  y += 5;

  if (data.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No records match the selected filters.', MARGIN, y);
    return y + 8;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [[title.split(' ')[0] === 'REFERRAL' ? 'Referral Status' : 'Category', valueLabel]],
    body: data.map((d) => [d.label, String(d.count)]),
    theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 2.2, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: HEADER_FILL_LIGHT, textColor: BRAND_PRIMARY, fontStyle: 'bold' },
    // Matches detailTable's alternating fill (ROW_ALT_FILL) — the one
    // real visual gap found auditing this against the WEDC reference's
    // alternating-row convention; distributionTable never had it even
    // though detailTable always has. Shared by every role report
    // (General/Police/Shelter/Support), not a Police-only change.
    alternateRowStyles: { fillColor: ROW_ALT_FILL },
    columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

/**
 * Embeds an ALREADY-RENDERED chart (captured from the live Chart.js
 * <canvas> on the Analytics page via its native toDataURL(), never
 * redrawn or recalculated here) plus an optional compact data table
 * underneath it — the one new drawing primitive this file didn't need
 * before Analytics PDFs existed (the original design note above,
 * "analytics are rendered as tables, not chart images," was a
 * deliberate choice for the Reports module specifically; the Analytics
 * PDF is a different document with a different brief). Shared by
 * analyticsReportDocument.ts exactly like every other primitive here is
 * shared by generateReportPdf/generateRoleReportPdf — one drawing
 * routine, never copy-pasted per role's analytics page.
 *
 * `image` carries the chart's REAL captured pixel dimensions so the
 * aspect ratio is preserved exactly (never stretched/squashed); a null
 * `image` (capture failed, or the chart was empty on screen) falls back
 * to the data table alone rather than drawing a broken/blank image —
 * matching the brief's "if a chart cannot be reliably embedded, provide
 * an accurate data table... rather than an empty or broken chart."
 */
export function chartImageSection(
  doc: jsPDF,
  startY: number,
  title: string,
  image: { dataUrl: string; width: number; height: number } | null,
  tableRows: DistributionRow[] | null,
  valueLabel = 'Count'
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = startY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text(title, MARGIN, y);
  y += 6;

  if (image && image.width > 0 && image.height > 0) {
    // Capped so a wide canvas never dwarfs the page, and never upscaled
    // past its own captured size (no fabricated resolution).
    const maxDisplayWidth = Math.min(contentWidth, 150);
    const displayWidth = Math.min(maxDisplayWidth, (image.width / image.height) * 90);
    const displayHeight = displayWidth * (image.height / image.width);
    y = ensureSpace(doc, y, displayHeight + 6);
    const x = MARGIN + (contentWidth - displayWidth) / 2;
    try {
      doc.addImage(image.dataUrl, 'PNG', x, y, displayWidth, displayHeight);
      y += displayHeight + 6;
    } catch (e) {
      console.warn('[reportDocument] chartImageSection: addImage failed, falling back to table only:', e);
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Chart image unavailable for this section — see the data table below.', MARGIN, y);
    y += 6;
  }

  if (tableRows && tableRows.length > 0) {
    y = ensureSpace(doc, y, 20);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Category', valueLabel]],
      body: tableRows.map((r) => [r.label, String(r.count)]),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 1.8, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1 },
      headStyles: { fillColor: HEADER_FILL_LIGHT, textColor: BRAND_PRIMARY, fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: ROW_ALT_FILL },
      columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
      tableWidth: Math.min(contentWidth, 120),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  } else if (!tableRows) {
    y += 4;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text('No records match the selected filters.', MARGIN, y);
    y += 10;
  }

  return y;
}

export function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  // Reads the real page height off `doc` rather than the module-level
  // PAGE_HEIGHT (fixed portrait A4) — generateRoleReportPdf can now
  // construct doc as landscape (via its new `orientation` param), and
  // every shared helper in this file must respect whichever orientation
  // the caller actually built, not assume portrait. doc.addPage() with
  // no args below already reuses the document's own format/orientation,
  // unaffected by this.
  if (y + needed > doc.internal.pageSize.getHeight() - FOOTER_RESERVE) {
    doc.addPage();
    return MARGIN + 4;
  }
  return y;
}

export const DEFAULT_CONFIDENTIALITY_NOTE =
  'CONFIDENTIAL — For authorized use only. This report contains sensitive case-management information and must be handled in accordance with SafeSpace data-handling practices.';

/**
 * The branded masthead (SAFESPACE wordmark + a one-line document
 * kicker) — identical first-page block every report shares, now shared
 * by generateReportPdf (below) and generateRoleReportPdf (module25, see
 * end of file) so neither re-implements it independently.
 *
 * Deliberately text-only, no logo image — the old SafeHer brand mark
 * (safeher-logo.png) previously drawn here has been removed outright
 * (see the "Remove Outdated SafeHer and Legacy Logos" pass): it names
 * the retired product and was never replaced with an approved current
 * SafeSpace image asset, per that pass's own "do not invent a
 * replacement logo" instruction. A clean text wordmark is the entire
 * header identity now; see drawWatermarkFooter below for the
 * document's provenance mark instead.
 */
export function drawBrandHeader(doc: jsPDF, startY: number, documentKicker: string): number {
  let y = startY;
  const textX = MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text('SAFESPACE', textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text('VAWC Survivor Support and Protection Platform', textX, y + 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(BRAND_ACCENT);
  doc.text(documentKicker, textX, y + 17);

  y += 24;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, doc.internal.pageSize.getWidth() - MARGIN, y);
  return y + 8;
}

// =====================================================================
// SafeSpace PDF watermark system — a subtle, consistent FOOTER mark
// (never a large diagonal overlay), applied to every generated page via
// finalizePagination below, governmentReportDocument.ts's own
// finalizePages, and qrSheet.ts's single-page footer. Branding/
// provenance information only — NOT a security, signature, or
// tamper-evidence mechanism; never described as one anywhere this is
// used.
// =====================================================================
export const WATERMARK_TEXT = 'Computer-generated by SafeSpace';
export const WATERMARK_COLOR = '#6B7280'; // muted blue-gray, ~WCAG-legible on white at this size

/** Draws the standardized watermark line on whichever page is CURRENTLY
 * selected on `doc` (caller loops pages via doc.setPage(i) first) — one
 * shared implementation so the exact text/size/color/placement can
 * never drift between the three independent PDF generators in this
 * codebase. Small (7.5pt), muted, bottom-center, in its own reserved
 * footer row below any existing footer line/page-number text — never
 * overlapping them. */
export function drawWatermarkFooter(doc: jsPDF, pageWidth: number, y: number): void {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(WATERMARK_COLOR);
  doc.text(WATERMARK_TEXT, pageWidth / 2, y, { align: 'center' });
}

/** Populates standard PDF metadata (Title/Subject/Author/Creator) in
 * addition to the visible watermark — never a replacement for it (see
 * the brief: "Metadata complements the visible watermark; it does not
 * replace it"). `title`/`subject` must never carry survivor names, case
 * identifiers, or other sensitive data — every caller here passes only
 * the document's own generic title/kind, the same text already shown
 * on the page itself and used in its filename, never a case-level
 * value. */
export function setSafeSpaceDocumentMetadata(doc: jsPDF, title: string, subject: string): void {
  doc.setProperties({
    title,
    subject,
    author: 'SafeSpace',
    creator: 'SafeSpace Administrative System',
  });
}

/** Document title + the label/value metadata rows + the confidentiality
 * notice — shared the same way as drawBrandHeader above. */
export function drawMetaBlock(doc: jsPDF, startY: number, title: string, metaLines: [string, string][], confidentialityNote: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(TEXT_BODY);
  doc.text(title, MARGIN, y);
  y += 8;

  doc.setFontSize(9.5);
  metaLines.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(TEXT_MUTED);
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(TEXT_BODY);
    doc.text(value, MARGIN + 32, y);
    y += 5.5;
  });

  y += 3;
  doc.setDrawColor(BORDER);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 4;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  const wrapped = doc.splitTextToSize(confidentialityNote, pageWidth - MARGIN * 2);
  doc.text(wrapped, MARGIN, y);
  return y + wrapped.length * 3.6 + 6;
}

/** A generic multi-column detail table — the same visual styling as the
 * original inline "Case Records" table (grid theme, brand-filled header
 * repeated on every page, alternating row fill), generalized to any
 * column set/rows so role-specific reports (module25) can reuse it
 * instead of each hand-rolling their own autoTable call. */
function detailTable(doc: jsPDF, startY: number, title: string, columns: string[], rows: (string | number)[][], emptyMessage: string): number {
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text(title, MARGIN, y);
  y += 6;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text(emptyMessage, MARGIN, y);
    return y + 8;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    head: [columns],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.8, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: BRAND_PRIMARY, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: ROW_ALT_FILL },
    showHead: 'everyPage', // repeated table header across page breaks
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
}

/** The plain-theme label/value "EXECUTIVE SUMMARY" table — shared
 * verbatim between generateReportPdf and generateRoleReportPdf. */
export function executiveSummaryTable(doc: jsPDF, startY: number, summary: DistributionRow[]): number {
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text('EXECUTIVE SUMMARY', MARGIN, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: summary.map((s) => [s.label, String(s.count)]),
    theme: 'plain',
    styles: { fontSize: 10.5, cellPadding: 2.4, textColor: TEXT_BODY },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold', textColor: BRAND_PRIMARY } },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
}

/** The "APPLIED FILTERS" bullet list — shared verbatim between
 * generateReportPdf and generateRoleReportPdf. Returns the finished Y
 * position so a caller can draw something after it (generateReportPdf
 * never needed to; generateRoleReportPdf's signatory block, below,
 * does). */
export function drawAppliedFilters(doc: jsPDF, startY: number, lines: string[]): number {
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text('APPLIED FILTERS', MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT_BODY);
  if (lines.length === 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('No filters applied — this report covers all records within your authorized scope.', MARGIN, y);
    return y + 6;
  }
  lines.forEach((line) => {
    doc.text(`•  ${line}`, MARGIN, y);
    y += 5;
  });
  return y + 1;
}

export interface RoleReportSignatory {
  /** e.g. "Prepared by:" */
  label: string;
  /** Typed in by the report preparer (see e.g. PoliceReportsPage.tsx) —
   * never auto-filled from anything but the signed-in preparer's own
   * verified profile, and even then only for their own "Prepared by"
   * line. Blank renders as a placeholder, never a fabricated name. */
  name: string;
  /** The printed designation under the signature line, e.g. "Reporting
   * Police Officer" — a role/title, not a person's name. */
  roleLabel: string;
}

export const DEFAULT_CERTIFICATION_NOTE =
  'Prepared report — official certification and signatures are required from the designated authorized personnel.';

/** Counterpart of governmentReportDocument.ts's drawCertificationAndFooter
 * signature block — same visual pattern (N-column label, signature line,
 * bold name-or-placeholder, muted role designation beneath), re-derived
 * here rather than copy-pasted since that file's geometry is fixed
 * landscape at different measurements. Column width is computed from the
 * real page width on every call, so this reads correctly whether the
 * calling document is portrait or landscape (generateRoleReportPdf's
 * `orientation` param) — wider in landscape, giving the three columns
 * more room, never a fixed assumption. A generated PDF is a PREPARED
 * report, never claimed as officially certified — certificationNote says
 * so explicitly, and an empty `name` always renders as "[Authorized
 * signatory]", never blank or guessed. */
function drawSignatoryBlock(doc: jsPDF, startY: number, signatories: RoleReportSignatory[], certificationNote: string): number {
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2;
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text('CERTIFICATION', MARGIN, y);
  y += 7;

  const colWidth = contentWidth / signatories.length;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_BODY);
  signatories.forEach((s, i) => doc.text(s.label, MARGIN + colWidth * i, y));
  y += 14;

  signatories.forEach((s, i) => {
    const x = MARGIN + colWidth * i;
    doc.setDrawColor(BORDER);
    doc.line(x, y, x + colWidth - 10, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_BODY);
    doc.text(s.name || '[Authorized signatory]', x, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text(s.roleLabel, x, y + 8);
  });
  y += 14;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED);
  const wrapped = doc.splitTextToSize(certificationNote, contentWidth);
  doc.text(wrapped, MARGIN, y);
  return y + wrapped.length * 3.4 + 6;
}

/** Repeated compact running header (page 2+) and the footer/page-number
 * stamp applied to every page once the full document is built — shared
 * by generateReportPdf and generateRoleReportPdf. */
export function finalizePagination(doc: jsPDF, opts: { runningHeaderTitle: string; runningHeaderRight: string; footerLeft: string }): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Read per-page, after setPage — every page here is the same
    // format, but this keeps the header/footer correctly positioned
    // whether the document is portrait (PAGE_WIDTH/PAGE_HEIGHT) or
    // landscape, without hardcoding either.
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(BRAND_PRIMARY);
      doc.text(opts.runningHeaderTitle, MARGIN, 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_MUTED);
      doc.text(opts.runningHeaderRight, pageWidth - MARGIN, 10, { align: 'right' });
      doc.setDrawColor(BORDER);
      doc.line(MARGIN, 12.5, pageWidth - MARGIN, 12.5);
    }

    doc.setDrawColor(BORDER);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text(opts.footerLeft, MARGIN, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 7, { align: 'right' });
    // Watermark sits in its OWN reserved row below the confidentiality/
    // page-number line — on every page, first through last, including
    // ones created by autoTable's own pagination (this loop runs after
    // the full document, including every table, is already built).
    drawWatermarkFooter(doc, pageWidth, pageHeight - 3);
  }
}

export function generateReportPdf(params: ReportPdfParams): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const generatedAt = new Date();
  setSafeSpaceDocumentMetadata(doc, params.reportTitle, 'SafeSpace case management report');

  // ---- Header block (first page) ----
  let y = drawBrandHeader(doc, MARGIN, 'CASE MANAGEMENT REPORT');

  // ---- Title + metadata block ----
  const metaLines: [string, string][] = [
    ['Reporting Period', reportingPeriodLabel(params.dateFrom, params.dateTo)],
    ['Generated', generatedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })],
    ['Generated By', `${params.generatedByName} (${params.generatedByRole})`],
    ['Coverage', params.scopeLabel],
  ];
  if (params.reportId) metaLines.push(['Report ID', params.reportId]);

  y = drawMetaBlock(doc, y, params.reportTitle, metaLines, DEFAULT_CONFIDENTIALITY_NOTE);

  // ---- Executive Summary ----
  y = ensureSpace(doc, y, 30);
  y = executiveSummaryTable(doc, y, params.summary);

  // ---- Distribution sections ----
  y = ensureSpace(doc, y, 30);
  y = distributionTable(doc, y, 'CASE STATUS DISTRIBUTION', params.statusDistribution);

  y = ensureSpace(doc, y, 30);
  y = distributionTable(doc, y, 'CASE CLASSIFICATION DISTRIBUTION', params.classificationDistribution);

  y = ensureSpace(doc, y, 30);
  y = distributionTable(doc, y, 'REPORT SOURCE DISTRIBUTION', params.sourceDistribution);

  if (params.geographicDistribution) {
    y = ensureSpace(doc, y, 30);
    y = distributionTable(doc, y, `GEOGRAPHIC DISTRIBUTION — ${params.geographicLabel}`, params.geographicDistribution, 'Cases');
  }

  y = ensureSpace(doc, y, 30);
  y = distributionTable(doc, y, 'REFERRAL SUMMARY', params.referralDistribution, 'Referrals');

  if (params.sosSummary) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(BRAND_PRIMARY);
    doc.text(`SOS / EMERGENCY SUMMARY — Total Alerts: ${params.sosSummary.total}`, MARGIN, y);
    y += 5;
    y = distributionTable(doc, y, 'SOS Alerts by Status', params.sosSummary.byStatus, 'Alerts');
  }

  // ---- Case records ----
  y = ensureSpace(doc, y, 20);
  y = detailTable(
    doc,
    y,
    `CASE RECORDS (${params.rows.length})`,
    ['Case #', 'Date', 'Type', 'Source', 'Status', 'Priority', 'Municipality', 'Barangay', 'Assigned Staff', 'Referral'],
    params.rows.map((r) => [r.caseNumber, r.dateReportedDisplay, r.caseType, r.sourceChannel, r.status, r.priority, r.municipality, r.barangay, r.assignedStaff, r.referralStatus]),
    'No case records match the selected filters.'
  );

  // ---- Applied filters ----
  y = ensureSpace(doc, y, 14 + params.appliedFilterLines.length * 5);
  drawAppliedFilters(doc, y, params.appliedFilterLines);

  // ---- Final pass: compact repeated header + footer with real page count ----
  finalizePagination(doc, {
    runningHeaderTitle: 'SAFESPACE — CASE MANAGEMENT REPORT',
    runningHeaderRight: params.reportTitle,
    footerLeft: 'SafeSpace — Case Management Report · Confidential — For Authorized Use Only',
  });

  return doc;
}

// =====================================================================
// module25 — generic role-specific report document.
//
// generateReportPdf above stays exactly as it was (the existing
// Provincial Staff "General (Case Management Report)" workflow must not
// regress) but every drawing primitive it uses — drawBrandHeader,
// drawMetaBlock, executiveSummaryTable, distributionTable, detailTable,
// drawAppliedFilters, finalizePagination — is already shared, not
// duplicated. generateRoleReportPdf below is the ONE additional
// function every new role report (Police, Shelter, Support, and any
// future role-specific document) is built from, composed entirely from
// those same primitives: one shared document renderer, driven by a
// role-specific report *definition* (RoleReportPdfParams), rather than
// nine independent PDF implementations.
//
// Deliberately does NOT draw a signatory block, seal, or certification
// language of any kind — those belong only to the official WEDC/CNSP/
// CICL templates (governmentReportDocument.ts), which already exist
// for the roles actually authorized to use them. A role-specific report
// built from this function is a prepared operational report, not an
// official government submission.
// =====================================================================

export interface RoleReportSection {
  title: string;
  data: DistributionRow[];
  valueLabel?: string;
}

export interface RoleReportDetailTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  emptyMessage: string;
}

export interface RoleReportPdfParams {
  /** Short ALL-CAPS line under the SAFESPACE wordmark, e.g. "POLICE ACTIVITY REPORT". */
  documentKicker: string;
  /** The large document title, e.g. "Emergency Response & Police Activity Report". */
  reportTitle: string;
  /** Compact running header repeated on page 2+, e.g. "SAFESPACE — POLICE ACTIVITY REPORT". */
  runningHeaderTitle: string;
  /** Footer line repeated on every page, e.g. "SafeSpace — Police Activity Report · Confidential — For Authorized Use Only". */
  footerLabel: string;
  reportId?: string | null;
  generatedByName: string;
  generatedByRole: string;
  scopeLabel: string;
  dateFrom: string;
  dateTo: string;
  appliedFilterLines: string[];
  /** Executive-summary label/value rows — omit the section entirely by passing []. */
  summary: DistributionRow[];
  /** Zero or more distribution tables (status breakdowns, etc.), in order. */
  sections: RoleReportSection[];
  /** Zero or more generic multi-column detail tables, in order, after the sections. */
  detailTables?: RoleReportDetailTable[];
  confidentialityNote?: string;
  /** Omit entirely for no signatory section (e.g. Shelter/Support
   * reports keep their current, unchanged layout). When present, drawn
   * as the final section, after Applied Filters. */
  signatories?: RoleReportSignatory[];
  /** Defaults to DEFAULT_CERTIFICATION_NOTE; only meaningful when
   * `signatories` is also provided. */
  certificationNote?: string;
  /** Defaults to 'portrait' (unchanged behavior for every existing
   * caller — Shelter, Support). Police Activity Report opts into
   * 'landscape' for its wide SOS-detail table; every shared drawing
   * primitive in this file reads real page geometry off `doc` itself
   * (doc.internal.pageSize), not a fixed module constant, so both
   * orientations render correctly through the exact same functions. */
  orientation?: 'portrait' | 'landscape';
}

export function generateRoleReportPdf(params: RoleReportPdfParams): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: params.orientation ?? 'portrait' });
  const generatedAt = new Date();
  setSafeSpaceDocumentMetadata(doc, params.reportTitle, `SafeSpace ${params.documentKicker.toLowerCase()}`);

  let y = drawBrandHeader(doc, MARGIN, params.documentKicker);

  const metaLines: [string, string][] = [
    ['Reporting Period', reportingPeriodLabel(params.dateFrom, params.dateTo)],
    ['Generated', generatedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })],
    ['Generated By', `${params.generatedByName} (${params.generatedByRole})`],
    ['Coverage', params.scopeLabel],
  ];
  if (params.reportId) metaLines.push(['Report ID', params.reportId]);

  y = drawMetaBlock(doc, y, params.reportTitle, metaLines, params.confidentialityNote ?? DEFAULT_CONFIDENTIALITY_NOTE);

  if (params.summary.length > 0) {
    y = ensureSpace(doc, y, 30);
    y = executiveSummaryTable(doc, y, params.summary);
  }

  for (const section of params.sections) {
    y = ensureSpace(doc, y, 30);
    y = distributionTable(doc, y, section.title, section.data, section.valueLabel ?? 'Count');
  }

  for (const table of params.detailTables ?? []) {
    y = ensureSpace(doc, y, 20);
    y = detailTable(doc, y, table.title, table.columns, table.rows, table.emptyMessage);
  }

  y = ensureSpace(doc, y, 14 + params.appliedFilterLines.length * 5);
  y = drawAppliedFilters(doc, y, params.appliedFilterLines);

  if (params.signatories && params.signatories.length > 0) {
    y = ensureSpace(doc, y, 45);
    drawSignatoryBlock(doc, y, params.signatories, params.certificationNote ?? DEFAULT_CERTIFICATION_NOTE);
  }

  finalizePagination(doc, {
    runningHeaderTitle: params.runningHeaderTitle,
    runningHeaderRight: params.reportTitle,
    footerLeft: params.footerLabel,
  });

  return doc;
}

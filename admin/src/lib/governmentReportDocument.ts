import jsPDF from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import {
  BRAND_PRIMARY,
  TEXT_BODY,
  TEXT_MUTED,
  BORDER,
  HEADER_FILL_LIGHT,
  drawWatermarkFooter,
  setSafeSpaceDocumentMetadata,
  CHECKMARK_CELL,
  checkmarkCellHooks,
} from './reportDocument';
import { SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE, CICL_NOT_AVAILABLE_NOTE } from './governmentReportMapping';
import { SERVICE_TYPE_LABELS } from './serviceTypes';
import type { GovernmentReportRow } from './governmentReportRows';
import type { ServiceType } from '../types/database.types';

/**
 * Official WEDC/VAW, CNSP, and CICL/CAR "Consolidated Cases" report
 * PDFs, laid out to match the supplied government templates — merged
 * group headers, service-code columns, a Source of Data split, a
 * Total row, and a Prepared by / Certified Correct / Noted by
 * certification block. Landscape A4 (the templates are far wider than
 * a portrait page can hold).
 *
 * Reuses the same jsPDF + jspdf-autotable setup, brand colors, and logo
 * loading already established in reportDocument.ts — this file adds
 * three NEW generators for the three NEW official formats; it does not
 * touch or replace generateReportPdf (the existing, PII-free Case
 * Management Report).
 *
 * CERTIFICATION — a generated PDF is a PREPARED report, not an
 * officially certified one. The Prepared by / Certified Correct /
 * Noted by lines print whatever signatory names the preparer typed in
 * (see ReportsPage.tsx) with a signature line for an actual physical
 * signature — nothing here claims those approvals already happened.
 */

const PAGE_WIDTH = 297; // A4 landscape, mm
const PAGE_HEIGHT = 210;
const MARGIN = 10;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 16; // +2mm over the prior 14 to reserve its own watermark row

export interface Signatories {
  preparedBy: string; // Secretariat/Social Worker
  certifiedCorrectBy: string; // MSWDO
  notedBy: string; // PNP-WCPD / Chairperson
}

export interface GovernmentReportParams {
  jurisdictionLabel: string; // "MUNICIPALITY OF BALER" or "AURORA PROVINCE (ALL MUNICIPALITIES)"
  periodLabel: string; // "January 1-31, 2026"
  rows: GovernmentReportRow[];
  signatories: Signatories;
  generatedByName: string;
  generatedByRole: string;
}

// Deliberately text-only — the old SafeHer brand mark previously drawn
// here has been removed outright (see the "Remove Outdated SafeHer and
// Legacy Logos" pass) and not replaced with any image asset.
function drawHeader(doc: jsPDF, title: string, params: GovernmentReportParams): number {
  let y = MARGIN;
  const textX = PAGE_WIDTH / 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_BODY);
  doc.text('Republic of the Philippines', textX, y + 4, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(params.jurisdictionLabel, textX, y + 9, { align: 'center' });

  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text(title, textX, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT_BODY);
  doc.text(`PERIOD COVERED: ${params.periodLabel}`, textX, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    `Generated via SafeSpace by ${params.generatedByName} (${params.generatedByRole}) — a prepared report; official certification requires the physical signatures below.`,
    PAGE_WIDTH - MARGIN,
    MARGIN,
    { align: 'right' }
  );

  return y + 2;
}

function drawTotalRow(doc: jsPDF, y: number, label: string, total: number): number {
  autoTable(doc, {
    startY: y,
    // Without a bottom margin, autoTable assumes it can use the full
    // page height and would happily place (or split) this mini-table
    // right where the footer/watermark get drawn afterward — this is
    // part of the footer-collision root cause this pass fixes (the
    // main data table already had this margin; this one-row table
    // didn't).
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    body: [[label, String(total)]],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.5, fillColor: '#FCE9B0', textColor: TEXT_BODY, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: CONTENT_WIDTH - 20 }, 1: { halign: 'center', cellWidth: 20 } },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
}

/**
 * ROOT CAUSE of the footer/watermark overlap this fixes: this function
 * used to check ONCE, up front, whether a flat 40mm would fit — but the
 * signatory block (28mm) + Services Provided legend (4 + 3.6mm per
 * code — up to ~37mm for WEDC's 9 codes) + every explanatory note
 * easily exceeds that in the worst case (WEDC specifically), so the
 * tail end of this content could render PAST PAGE_HEIGHT -
 * FOOTER_RESERVE and directly under/through the footer line, "Page X
 * of Y", and watermark that finalizePages draws afterward at fixed
 * coordinates. Fixed by checking room before EACH sub-section
 * individually (mirroring reportDocument.ts's own ensureSpace
 * pattern), so a page break happens exactly where content would
 * otherwise collide with the reserved footer area — never mid-section,
 * never relying on one upfront guess.
 */
function drawCertificationAndFooter(doc: jsPDF, startY: number, params: GovernmentReportParams, extraNotes: string[], serviceCodes: ServiceType[]) {
  let y = startY + 4;
  const pageBottom = PAGE_HEIGHT - FOOTER_RESERVE;
  const ensureRoom = (needed: number) => {
    if (y + needed > pageBottom) {
      doc.addPage('a4', 'landscape');
      y = MARGIN;
    }
  };

  // ---- Signatory block (labels row + signature-line/name/role row) ----
  ensureRoom(28);
  const colWidth = CONTENT_WIDTH / 3;
  const cols: [string, string][] = [
    ['Prepared by:', params.signatories.preparedBy],
    ['Certified Correct:', params.signatories.certifiedCorrectBy],
    ['Noted by:', params.signatories.notedBy],
  ];
  const roleLabels = ['Secretariat/Social Worker', 'MSWDO', 'PNP-WCPD / Chairperson'];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_BODY);
  cols.forEach(([label], i) => {
    doc.text(label, MARGIN + colWidth * i, y);
  });
  y += 14;
  cols.forEach(([, name], i) => {
    const x = MARGIN + colWidth * i;
    doc.setDrawColor(BORDER);
    doc.line(x, y, x + colWidth - 10, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(name || '[Authorized signatory]', x, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text(roleLabels[i], x, y + 8);
    doc.setTextColor(TEXT_BODY);
  });
  y += 14;

  // ---- Services Provided legend ----
  if (serviceCodes.length > 0) {
    ensureRoom(4 + serviceCodes.length * 3.6 + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(BRAND_PRIMARY);
    doc.text('Services Provided:', MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_BODY);
    serviceCodes.forEach((code) => {
      doc.text(`${code} - ${SERVICE_TYPE_LABELS[code]}`, MARGIN, y);
      y += 3.6;
    });
    y += 2;
  }

  // ---- Documented methodology / data-limitation notes — never silent ----
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.8);
  doc.setTextColor(TEXT_MUTED);
  extraNotes.forEach((note) => {
    const wrapped = doc.splitTextToSize(note, CONTENT_WIDTH);
    const noteHeight = wrapped.length * 3 + 2;
    ensureRoom(noteHeight);
    // ensureRoom may have started a new page — font/size/color are
    // page-independent in jsPDF, so nothing needs re-applying here.
    doc.text(wrapped, MARGIN, y);
    y += noteHeight;
  });
}

function finalizePages(doc: jsPDF, footerTitle: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(BORDER);
    doc.line(MARGIN, PAGE_HEIGHT - 11, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`SafeSpace — ${footerTitle} · Confidential — For Authorized Use Only`, MARGIN, PAGE_HEIGHT - 7);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7, { align: 'right' });
    // Watermark — bottom-right (per this report's own brief), directly
    // under "Page X of Y" in its own reserved row below the
    // confidentiality/page-number line, on every page (first through
    // last, including ones created by autoTable's own pagination for
    // the consolidated-cases table, or by drawCertificationAndFooter's
    // own pagination above).
    drawWatermarkFooter(doc, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 3, 'right');
  }
}

type AbuseCell = { psych: boolean; physical: boolean; economic: boolean; stalking: boolean; other: boolean };
function abuseCells(row: GovernmentReportRow): AbuseCell {
  return {
    psych: row.templateColumn === 'Psychological Violence',
    physical: row.templateColumn === 'Physical Abuse',
    economic: row.templateColumn === 'Economic Abuse',
    stalking: row.templateColumn === 'Stalking',
    other: row.templateColumn === 'Other Cases',
  };
}
// Every cell below that should render a checkmark uses CHECKMARK_CELL
// (reportDocument.ts) — a vector tick drawn by checkmarkCellHooks, not
// the literal '✓' character — because jsPDF's standard fonts have no
// real glyph for it at these table font sizes (see that file's own
// header note). The LOGIC that decides whether a cell is marked is
// completely unchanged here — only what an affirmative answer renders
// as changed.
function mark(v: boolean): string {
  return v ? CHECKMARK_CELL : '';
}
const SEXUAL_SUBTYPES = ['Rape', 'AOL', 'Incest', 'AR', 'Seduction', 'Others'] as const;
function sexualCell(row: GovernmentReportRow, subtype: string): string {
  return row.templateColumn === 'Sexual Abuse' && row.sexualAbuseSubtype === subtype ? CHECKMARK_CELL : '';
}
// Only a case_services row whose status is 'Provided' ever lands in
// row.providedServices (see governmentReportRows.ts) — a referral,
// request, or in-progress service renders blank here, never guessed.
function serviceCell(row: GovernmentReportRow, type: ServiceType): string {
  return row.providedServices.has(type) ? CHECKMARK_CELL : '';
}

/** WEDC/VAW — no demographic columns (Birthdate/Age/Sex/Educational
 * Attainment) in the official template; has PPO/TPO/BPO in services. */
export function generateWedcReportPdf(params: GovernmentReportParams): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  setSafeSpaceDocumentMetadata(doc, 'Consolidated Cases of WEDC/VAW', 'Official WEDC/VAW consolidated case report');
  let y = drawHeader(doc, 'CONSOLIDATED CASES of WEDC/VAW', params);

  const head: RowInput[] = [
    [
      { content: 'Name/Alias', rowSpan: 2 },
      { content: 'Address', rowSpan: 2 },
      { content: '', colSpan: 5 },
      { content: 'Sexually Abuse', colSpan: 6 },
      { content: 'SERVICES PROVIDED', colSpan: 9 },
      { content: 'Status/Remarks', rowSpan: 2 },
      { content: 'Source of Data', colSpan: 2 },
    ],
    [
      'Psych.', 'Physical', 'Economic', 'Stalking', 'Other',
      'Rape', 'AOL', 'Incest', 'AR', 'Seduction', 'Others',
      'CS', 'LS', 'PPO', 'TPO', 'BPO', 'LA', 'FA', 'MA', 'TA',
      'MSWDO', 'PNP',
    ],
  ];

  const body = params.rows.map((r) => {
    const a = abuseCells(r);
    return [
      r.nameOrAlias,
      r.address,
      mark(a.psych), mark(a.physical), mark(a.economic), mark(a.stalking), mark(a.other),
      sexualCell(r, 'Rape'), sexualCell(r, 'AOL'), sexualCell(r, 'Incest'), sexualCell(r, 'AR'), sexualCell(r, 'Seduction'), sexualCell(r, 'Others'),
      serviceCell(r, 'CS'), serviceCell(r, 'LS'), serviceCell(r, 'PPO'), serviceCell(r, 'TPO'), serviceCell(r, 'BPO'), serviceCell(r, 'LA'), serviceCell(r, 'FA'), serviceCell(r, 'MA'), serviceCell(r, 'TA'),
      r.statusRemarks,
      CHECKMARK_CELL, '',
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 6.3, cellPadding: 1, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1, halign: 'center', overflow: 'linebreak' },
    headStyles: { fillColor: HEADER_FILL_LIGHT, textColor: BRAND_PRIMARY, fontStyle: 'bold', fontSize: 6, valign: 'middle' },
    columnStyles: { 0: { halign: 'left', cellWidth: 32 }, 1: { halign: 'left', cellWidth: 32 }, 22: { cellWidth: 26 } },
    showHead: 'everyPage',
    ...checkmarkCellHooks(),
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  y = drawTotalRow(doc, y, 'TOTAL', params.rows.length);

  drawCertificationAndFooter(doc, y, params, [SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE], ['CS', 'LS', 'PPO', 'TPO', 'BPO', 'LA', 'FA', 'MA', 'TA']);
  finalizePages(doc, 'Consolidated Cases of WEDC/VAW');
  return doc;
}

/** CNSP — same abuse taxonomy as WEDC, plus demographics (Birthdate/
 * Age/Sex/Educational Attainment); services use EA not PPO/TPO/BPO. */
export function generateCnspReportPdf(params: GovernmentReportParams): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  setSafeSpaceDocumentMetadata(doc, 'Consolidated Cases of CNSP', 'Official CNSP consolidated case report');
  let y = drawHeader(doc, 'CONSOLIDATED CASES of CNSP', params);

  const head: RowInput[] = [
    [
      { content: 'Name/Alias', rowSpan: 2 },
      { content: 'Address', rowSpan: 2 },
      { content: 'Birthdate', rowSpan: 2 },
      { content: 'Age', rowSpan: 2 },
      { content: 'Sex', rowSpan: 2 },
      { content: 'Educational Attainment', rowSpan: 2 },
      { content: 'Type of Violence/Case', colSpan: 5 },
      { content: 'Sexually Abuse', colSpan: 6 },
      { content: 'SERVICES PROVIDED', colSpan: 7 },
      { content: 'Status/Remarks', rowSpan: 2 },
      { content: 'Source of Data', colSpan: 2 },
    ],
    [
      'Psych.', 'Physical', 'Economic', 'Stalking', 'Other',
      'Rape', 'AOL', 'Incest', 'AR', 'Seduction', 'Others',
      'CS', 'LS', 'EA', 'LA', 'FA', 'MA', 'TA',
      'MSWDO', 'PNP',
    ],
  ];

  const body = params.rows.map((r) => {
    const a = abuseCells(r);
    return [
      r.nameOrAlias,
      r.address,
      r.birthdateDisplay,
      r.age ?? '—',
      r.sex,
      r.educationalAttainment,
      mark(a.psych), mark(a.physical), mark(a.economic), mark(a.stalking), mark(a.other),
      sexualCell(r, 'Rape'), sexualCell(r, 'AOL'), sexualCell(r, 'Incest'), sexualCell(r, 'AR'), sexualCell(r, 'Seduction'), sexualCell(r, 'Others'),
      serviceCell(r, 'CS'), serviceCell(r, 'LS'), serviceCell(r, 'EA'), serviceCell(r, 'LA'), serviceCell(r, 'FA'), serviceCell(r, 'MA'), serviceCell(r, 'TA'),
      r.statusRemarks,
      CHECKMARK_CELL, '',
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 6, cellPadding: 1, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1, halign: 'center', overflow: 'linebreak' },
    headStyles: { fillColor: HEADER_FILL_LIGHT, textColor: BRAND_PRIMARY, fontStyle: 'bold', fontSize: 5.8, valign: 'middle' },
    columnStyles: { 0: { halign: 'left', cellWidth: 24 }, 1: { halign: 'left', cellWidth: 24 }, 5: { cellWidth: 18 } },
    showHead: 'everyPage',
    ...checkmarkCellHooks(),
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  y = drawTotalRow(doc, y, 'TOTAL', params.rows.length);

  drawCertificationAndFooter(doc, y, params, [SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE], ['CS', 'LS', 'EA', 'LA', 'FA', 'MA', 'TA']);
  finalizePages(doc, 'Consolidated Cases of CNSP');
  return doc;
}

/** CICL/CAR — a Type of Offense + Discernment (With/Without) structure
 * instead of the abuse taxonomy. Always rendered with zero data rows
 * today — see CICL_NOT_AVAILABLE_NOTE / governmentReportMapping.ts's
 * file header for exactly why, rather than silently showing an empty
 * table with no explanation. */
export function generateCiclReportPdf(params: GovernmentReportParams): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  setSafeSpaceDocumentMetadata(doc, 'Consolidated Cases of CICL/CAR', 'Official CICL/CAR consolidated case report');
  let y = drawHeader(doc, 'CONSOLIDATED CASES of CICL/CAR', params);

  const head: RowInput[] = [
    [
      { content: 'Name/Alias', rowSpan: 2 },
      { content: 'Address', rowSpan: 2 },
      { content: 'Birthdate', rowSpan: 2 },
      { content: 'Age', rowSpan: 2 },
      { content: 'Sex', rowSpan: 2 },
      { content: 'Educational Attainment', rowSpan: 2 },
      { content: 'Type of Offense', rowSpan: 2 },
      { content: 'Discernment', colSpan: 2 },
      { content: 'SERVICES PROVIDED', colSpan: 7 },
      { content: 'Status/Remarks', rowSpan: 2 },
      { content: 'Source of Data', colSpan: 2 },
    ],
    ['With', 'Without', 'CS', 'LS', 'EA', 'LA', 'FA', 'MA', 'TA', 'MSWDO', 'PNP'],
  ];

  // Always empty — see function header comment.
  const body: RowInput[] = [];

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 6.3, cellPadding: 1, textColor: TEXT_BODY, lineColor: BORDER, lineWidth: 0.1, halign: 'center' },
    headStyles: { fillColor: HEADER_FILL_LIGHT, textColor: BRAND_PRIMARY, fontStyle: 'bold', fontSize: 6, valign: 'middle' },
    columnStyles: { 0: { halign: 'left', cellWidth: 30 }, 1: { halign: 'left', cellWidth: 30 } },
    showHead: 'everyPage',
    // body is always [] today (see this function's own header note),
    // but wired identically to WEDC/CNSP so this report benefits the
    // moment a real derivation path exists, rather than needing this
    // fix applied a second time later.
    ...checkmarkCellHooks(),
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  y = drawTotalRow(doc, y, 'TOTAL', 0);

  drawCertificationAndFooter(doc, y, params, [CICL_NOT_AVAILABLE_NOTE, SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE], ['CS', 'LS', 'EA', 'LA', 'FA', 'MA', 'TA']);
  finalizePages(doc, 'Consolidated Cases of CICL/CAR');
  return doc;
}

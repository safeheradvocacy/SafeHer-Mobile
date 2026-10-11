import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { BORDER, BRAND_ACCENT, BRAND_PRIMARY, MARGIN, PAGE_WIDTH, TEXT_MUTED, loadSafeherLogoDataUrl } from './reportDocument';

/**
 * Builds the printable "Client Case Access" QR sheet — a real,
 * standalone jsPDF document (reusing the exact brand palette/logo
 * helper already built for Case Management Reports, lib/reportDocument.ts),
 * never a screenshot of the admin dashboard. Deliberately carries NO
 * survivor name, phone number, address, or incident detail — only the
 * case reference, the QR itself, instructions, and a confidentiality
 * notice, per the approved design (the QR must never be the only thing
 * standing between "printed paper" and "case information").
 *
 * `deepLink` is the raw `safeher://case-access/<token>` URL — the ONLY
 * place the raw token is ever handled client-side, for exactly as long
 * as it takes to render this one document. Nothing here persists it.
 */
export async function buildClientAccessQrSheet(params: {
  caseNumber: string;
  deepLink: string;
  issuedAt: Date;
  issuedByName: string;
  scopeLabel: string; // e.g. "Baler — MSWDO" or "Barangay Sabang"
}): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const [logoDataUrl, qrDataUrl] = await Promise.all([
    loadSafeherLogoDataUrl(),
    QRCode.toDataURL(params.deepLink, { errorCorrectionLevel: 'M', margin: 1, width: 480 }),
  ]);

  let y = MARGIN;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', MARGIN, y, 18, 18 * (381 / 482));
    } catch {
      // enhancement only — never block the document over an image error
    }
  }
  const textX = logoDataUrl ? MARGIN + 22 : MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BRAND_PRIMARY);
  doc.text('SAFESPACE', textX, y + 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_ACCENT);
  doc.text('CLIENT CASE ACCESS', textX, y + 15);

  y += 26;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Case Reference', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor('#2B2530');
  doc.text(params.caseNumber, PAGE_WIDTH / 2, y, { align: 'center' });
  y += 14;

  const qrSize = 70;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  doc.setDrawColor(BORDER);
  doc.rect(qrX - 4, y - 4, qrSize + 8, qrSize + 8);
  doc.addImage(qrDataUrl, 'PNG', qrX, y, qrSize, qrSize);
  y += qrSize + 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor('#2B2530');
  const instructions = 'Scan this QR code using the SafeSpace mobile application to link this case to your account.';
  const wrappedInstructions = doc.splitTextToSize(instructions, PAGE_WIDTH - MARGIN * 2 - 20);
  doc.text(wrappedInstructions, PAGE_WIDTH / 2, y, { align: 'center' });
  y += wrappedInstructions.length * 5.5 + 6;

  doc.setDrawColor(BRAND_ACCENT);
  doc.setLineWidth(0.6);
  doc.line(MARGIN + 20, y, PAGE_WIDTH - MARGIN - 20, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BRAND_ACCENT);
  doc.text('IMPORTANT', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor('#2B2530');
  const notice =
    'A SafeSpace account and identity verification are required before any case information can be accessed. ' +
    'This code alone does not grant access to your case — a SafeSpace administrator must verify your identity first.';
  const wrappedNotice = doc.splitTextToSize(notice, PAGE_WIDTH - MARGIN * 2 - 30);
  doc.text(wrappedNotice, PAGE_WIDTH / 2, y, { align: 'center' });
  y += wrappedNotice.length * 5 + 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text(`Issued: ${params.issuedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`, PAGE_WIDTH / 2, y, {
    align: 'center',
  });
  y += 5;
  doc.text(`Issued by: ${params.issuedByName} · ${params.scopeLabel}`, PAGE_WIDTH / 2, y, { align: 'center' });

  // Footer confidentiality notice — every page (only one page here, but
  // keeps the same footer convention as the Reports module's PDF).
  doc.setDrawColor(BORDER);
  doc.line(MARGIN, 277, PAGE_WIDTH - MARGIN, 277);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text('CONFIDENTIAL — For authorized client use only. Do not photograph or share this code publicly.', PAGE_WIDTH / 2, 283, {
    align: 'center',
  });

  return doc;
}

/** Uses the real case reference, never a generic name — matches the
 * centralized-filename convention already established for Reports
 * exports (lib/reportFilename.ts), applied here for the QR sheet. */
export function buildQrSheetFilename(caseNumber: string): string {
  const safe = caseNumber.replace(/[\\/:*?"<>|]/g, '');
  return `SafeSpace_Client_Access_${safe}.pdf`;
}

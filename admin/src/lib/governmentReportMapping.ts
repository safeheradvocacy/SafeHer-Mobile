import type { CaseReport, CaseType, Survivor } from '../types/database.types';

/**
 * The single place the "which government template does this case
 * belong to" decision lives — the brief explicitly warns against
 * letting Case Type / Report Type / Government Type drift into
 * independent, disagreeing concepts. Everything here is a pure
 * function over already-real columns; nothing is stored, nothing is
 * fabricated.
 *
 * WEDC/VAW and CNSP are the SAME abuse taxonomy (Psychological/
 * Physical/Economic/Stalking/Sexual-abuse-subtype/Other Cases),
 * split only by the survivor's age at the time the case was
 * reported — an adult woman's case is WEDC/VAW, a minor's is CNSP.
 * That split is genuinely derivable from survivors.date_of_birth +
 * case_reports.reported_at; nothing new had to be added for it.
 *
 * CICL/CAR is NOT a third bucket of this same taxonomy — it's a
 * structurally different case shape (a child as the alleged
 * OFFENDER, not a victim of abuse). SafeSpace's entire case model is
 * victim-reporting-centric; there is no "offender", "offense type",
 * or "discernment" concept anywhere in the schema or the mobile
 * intake flow. classifyForGovernmentReport() below NEVER returns
 * 'CICL' as a result — there is no real data path that could make
 * that classification honest. CICL stays in the type union (and the
 * PDF/CSV generators support it) purely so the report STRUCTURE is
 * ready the moment real CICL intake exists; see governmentReportRows.ts
 * for where this is made explicit to the people using the report.
 */
export type GovernmentReportClassification = 'WEDC' | 'CNSP' | 'CICL' | 'Unclassified';

const ADULT_AGE_THRESHOLD = 18;

/** Age in whole years at a given reference date — null when date_of_birth
 * isn't on file, never silently assumed. */
export function ageAt(dateOfBirth: string | null, referenceIso: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const ref = new Date(referenceIso);
  let age = ref.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear = ref.getMonth() > dob.getMonth() || (ref.getMonth() === dob.getMonth() && ref.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * WEDC when the survivor was an adult (18+) at the time the case was
 * reported; CNSP when a minor. 'Unclassified' when date_of_birth isn't
 * on file — shown as its own bucket in the UI, never guessed into
 * either template. Never returns 'CICL' — see file header.
 */
export function classifyForGovernmentReport(caseReport: CaseReport, survivor: Survivor | null): GovernmentReportClassification {
  const age = ageAt(survivor?.date_of_birth ?? null, caseReport.reported_at);
  if (age === null) return 'Unclassified';
  return age >= ADULT_AGE_THRESHOLD ? 'WEDC' : 'CNSP';
}

/**
 * The template's abuse-type columns, shared by WEDC and CNSP:
 * Psychological / Physical / Economic / Stalking / Other Cases, plus
 * the 6-way Sexual Abuse breakdown. case_type === 'Neglect' has no
 * dedicated column in either official template — mapped to "Other
 * Cases" rather than dropped or forced into an unrelated column.
 * This mapping is intentionally the ONLY place that decision is made.
 */
export type TemplateAbuseColumn =
  | 'Psychological Violence'
  | 'Physical Abuse'
  | 'Economic Abuse'
  | 'Stalking'
  | 'Other Cases'
  | 'Sexual Abuse';

export function mapCaseTypeToTemplateColumn(caseType: CaseType): TemplateAbuseColumn {
  switch (caseType) {
    case 'Psychological Abuse':
      return 'Psychological Violence';
    case 'Physical Abuse':
      return 'Physical Abuse';
    case 'Economic Abuse':
      return 'Economic Abuse';
    case 'Stalking':
      return 'Stalking';
    case 'Sexual Abuse':
      return 'Sexual Abuse';
    case 'Neglect':
    case 'Others':
    default:
      return 'Other Cases';
  }
}

/**
 * SOURCE OF DATA — the templates offer exactly two columns, MSWDO and
 * PNP. Every SafeSpace case enters through the welfare-office intake
 * chain (a survivor's own mobile self-report, or a Walk-In entered by
 * MSWDO-tier staff — see case_reports.source_channel, module14) —
 * there is no path for a case to originate FROM the PNP in this
 * system; police only ever appear later, as a referral/response
 * participant (law_enforcement_referrals), never as the reporting
 * source. Rather than leave the column blank or guess, every
 * case-sourced row is documented and labeled as MSWDO; the PNP column
 * is always left blank for case reports. This is a reporting-policy
 * decision, stated here once and surfaced as a footnote on every
 * generated PDF (see governmentReportDocument.ts), not a silent
 * assumption.
 */
export const SOURCE_OF_DATA_NOTE =
  'Source of Data: every case record originates through SafeSpace case intake (self-report or Walk-In to a welfare office) and is shown under MSWDO. SafeSpace has no case-intake path that originates from PNP — a case with police involvement is a later referral/response action, not its source — so the PNP column is intentionally left blank for case-level rows.';

export function sourceOfDataFor(_caseReport: CaseReport): { mswdo: boolean; pnp: boolean } {
  return { mswdo: true, pnp: false };
}

/**
 * SERVICES PROVIDED — tracked via case_services (module22). A column
 * is marked only when a case has a case_services row of that type
 * whose status is exactly 'Provided' (see serviceTypes.ts's
 * isServiceProvided() and governmentReportRows.ts) — a referral,
 * request, schedule, or in-progress service is never counted, and
 * never silently treated as completed. This is the one rule this note
 * exists to make explicit on every generated report, not a data
 * gap disclaimer anymore.
 */
export const SERVICES_PROVIDED_NOTE =
  'Services Provided: a column is marked only when the case has a service record explicitly marked "Provided" in case management. A referral, request, or in-progress service is not counted as provided.';

/** CICL/CAR — always empty; see file header for why. Exported as a named
 * constant (not inlined) so the "this is a known, documented gap, not a
 * bug" reasoning is visible at every call site that checks it. */
export const CICL_NOT_AVAILABLE_NOTE =
  'No CICL/CAR-classified cases are shown because SafeSpace does not yet capture the offender/offense/discernment information a Child in Conflict with the Law case requires — the entire case model here is victim-reporting-centric. This report renders the official CICL/CAR structure correctly so it is ready the moment that intake capability exists; it does not reclassify any abuse case as CICL.';

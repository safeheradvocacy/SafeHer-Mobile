import { downloadCsv } from './exportCsv';
import { buildGovernmentReportFilename } from './reportFilename';
import { SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE } from './governmentReportMapping';
import { SERVICE_TYPE_OPTIONS } from './serviceTypes';
import type { GovernmentReportRow } from './governmentReportRows';

/**
 * One case per logical row, matching the official templates' columns —
 * a Services Provided column is "Yes" only when the case has a
 * case_services row of that type marked 'Provided' (module22), never a
 * referral or pending request; Source of Data is always MSWDO (see
 * governmentReportMapping.ts for why). UTF-8 with BOM + proper escaping
 * comes from the existing downloadCsv() helper
 * (admin/src/lib/exportCsv.ts) — reused as-is, not reimplemented.
 */
export function exportGovernmentReportCsv(
  reportType: 'General' | 'WEDC' | 'CNSP' | 'CICL',
  rows: GovernmentReportRow[],
  dateFrom: string,
  dateTo: string
) {
  const filename = buildGovernmentReportFilename(reportType, dateFrom, dateTo, 'csv');

  const data = rows.map((r) => {
    const serviceColumns: Record<string, string> = {};
    SERVICE_TYPE_OPTIONS.forEach((code) => {
      serviceColumns[`service_${code}`] = r.providedServices.has(code) ? 'Yes' : '';
    });
    return {
      case_number: r.caseNumber,
      date_reported: r.dateReportedIso,
      classification: r.classification,
      name_or_alias: r.nameOrAlias,
      address: r.address,
      birthdate: r.birthdateDisplay,
      age: r.age ?? '',
      sex: r.sex,
      educational_attainment: r.educationalAttainment,
      case_classification_column: r.templateColumn,
      sexual_abuse_subtype: r.sexualAbuseSubtype ?? '',
      ...serviceColumns,
      status_remarks: r.statusRemarks,
      source_mswdo: 'Yes',
      source_pnp: '',
    };
  });

  const columns = [
    { key: 'case_number', label: 'Case #' },
    { key: 'date_reported', label: 'Date Reported' },
    { key: 'classification', label: 'Report Classification' },
    { key: 'name_or_alias', label: 'Name/Alias' },
    { key: 'address', label: 'Address' },
    { key: 'birthdate', label: 'Birthdate' },
    { key: 'age', label: 'Age' },
    { key: 'sex', label: 'Sex' },
    { key: 'educational_attainment', label: 'Educational Attainment' },
    { key: 'case_classification_column', label: 'Type of Violence/Case' },
    { key: 'sexual_abuse_subtype', label: 'Sexual Abuse Subtype' },
    ...SERVICE_TYPE_OPTIONS.map((code) => ({ key: `service_${code}`, label: `Service — ${code}` })),
    { key: 'status_remarks', label: 'Status/Remarks' },
    { key: 'source_mswdo', label: 'Source — MSWDO' },
    { key: 'source_pnp', label: 'Source — PNP' },
  ];

  downloadCsv(filename, data, columns);
  return filename;
}

export { SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE };

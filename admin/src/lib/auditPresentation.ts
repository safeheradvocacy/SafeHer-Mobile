import type { AuditLog } from '../types/database.types';

/**
 * Audit Log hardening (module16) — the one place raw audit_logs rows
 * get translated into something safe and human-readable. Nothing in
 * AuditLogPage.tsx (or any future audit consumer) should read
 * `old_values`/`new_values` directly without going through
 * `sanitizeValues`/`fieldChanges` first — that is what guarantees a
 * `token_hash` or similar secret-shaped field can never reach the
 * screen, even under the "technical details" toggle.
 */

const RESOURCE_LABEL: Record<string, string> = {
  case_access_tokens: 'Client Access Credential',
  case_client_links: 'Case Access Request',
  user_profiles: 'Administrator Account',
  user_verifications: 'Identity Verification',
  barangays: 'Geographic Reference Data',
  municipalities: 'Geographic Reference Data',
  shelters: 'Shelter Reference Data',
  system_backups: 'System Backup',
  backup_schedule: 'Backup Schedule',
  case_referrals: 'Case Referral',
  case_reports: 'Case Record',
  case_assignments: 'Case Assignment',
  case_status_history: 'Case Status Update',
  shelter_referrals: 'Shelter Referral',
  shelter_requests: 'Shelter Request',
  // Table name is unchanged (still backs case-referral-to-police only,
  // module19) — only the human-readable label here is renamed.
  law_enforcement_referrals: 'Police Officer Referral',
  saved_reports: 'Saved Report',
  evidence: 'Case Evidence',
  sos_alerts: 'SOS Alert',
  expert_support_requests: 'Support Request',
};

function humanizeTableName(table: string): string {
  return RESOURCE_LABEL[table] ?? table.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACTION_VERB: Record<string, string> = {
  INSERT: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
};

const CUSTOM_TITLE: Record<string, string> = {
  PROFILE_UPDATE: 'Profile Updated',
  PASSWORD_CHANGE: 'Password Changed',
  SESSION_REVOKE_OTHERS: 'Other Sessions Signed Out',
  SESSION_TIMEOUT_UPDATE: 'Session Timeout Setting Changed',
  REPORT_EXPORT_CSV: 'Report Exported (CSV)',
  REPORT_EXPORT_PDF: 'Report Exported (PDF)',
  REPORT_PREVIEW_PDF: 'Report Previewed (PDF)',
  BACKUP_CREATED: 'System Backup Created',
  BACKUP_FAILED: 'System Backup Failed',
  BACKUP_VALIDATED: 'System Backup Validated',
  BACKUP_DOWNLOADED: 'System Backup Downloaded',
};

/** e.g. "Client Access Credential Updated" instead of "UPDATE ·
 * case_access_tokens" — task's own recommended presentation. */
export function auditTitle(log: AuditLog): string {
  if (CUSTOM_TITLE[log.action]) return CUSTOM_TITLE[log.action];
  const resource = humanizeTableName(log.table_name);
  const verb = ACTION_VERB[log.action] ?? log.action.replace(/_/g, ' ').toLowerCase();
  return `${resource} ${verb}`;
}

export function auditResource(log: AuditLog): string {
  return humanizeTableName(log.table_name);
}

/** Derived from the record_id UUID only — never from a token/secret
 * value. e.g. "••••7F21". */
export function maskedReference(recordId: string | null): string {
  if (!recordId) return '—';
  const clean = recordId.replace(/-/g, '');
  return `••••${clean.slice(-6).toUpperCase()}`;
}

export function resultLabel(log: AuditLog): 'Successful' | 'Failed' {
  return log.action === 'BACKUP_FAILED' ? 'Failed' : 'Successful';
}

const SENSITIVE_KEY_PATTERN = /token|password|secret|api[_-]?key|service[_-]?role|authorization/i;

/** Redacts any key that looks secret-shaped. Applied BEFORE anything
 * from old_values/new_values is ever rendered, including under the
 * per-row "technical details" toggle — there is no path that skips
 * this. */
export function sanitizeValues(values: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!values) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

// Bookkeeping columns that are never useful as a "what changed" line.
const SKIP_FIELDS = new Set(['updated_at', 'created_at']);

/** A field-level "what changed" list (e.g. `status: pending → verified`)
 * — never a raw JSON dump of the row. Built entirely from the already-
 * sanitized values. */
export function fieldChanges(
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null
): { field: string; from: unknown; to: unknown }[] {
  const oldS = sanitizeValues(oldValues);
  const newS = sanitizeValues(newValues);
  const keys = new Set([...Object.keys(oldS), ...Object.keys(newS)]);
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const a = oldS[key];
    const b = newS[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: key, from: a ?? '—', to: b ?? '—' });
    }
  }
  return changes;
}

export type AuditCategory = 'all' | 'security' | 'accounts' | 'access' | 'cases' | 'backups' | 'system';

const SECURITY_ACTIONS = new Set(['PASSWORD_CHANGE', 'SESSION_REVOKE_OTHERS', 'SESSION_TIMEOUT_UPDATE']);
const ACCESS_TABLES = new Set(['case_access_tokens', 'case_client_links', 'user_verifications']);
const CASE_TABLES = new Set([
  'case_reports', 'case_assignments', 'case_referrals', 'case_status_history',
  'shelter_referrals', 'shelter_requests', 'expert_support_requests', 'law_enforcement_referrals',
]);
const BACKUP_TABLES = new Set(['system_backups', 'backup_schedule']);

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  all: 'All',
  security: 'Security',
  accounts: 'Accounts',
  access: 'Access',
  cases: 'Cases',
  backups: 'Backups',
  system: 'System',
};

export function categorize(log: AuditLog): Exclude<AuditCategory, 'all'> {
  if (SECURITY_ACTIONS.has(log.action)) return 'security';
  if (BACKUP_TABLES.has(log.table_name)) return 'backups';
  if (log.table_name === 'user_profiles') return 'accounts';
  if (ACCESS_TABLES.has(log.table_name)) return 'access';
  if (CASE_TABLES.has(log.table_name)) return 'cases';
  return 'system';
}

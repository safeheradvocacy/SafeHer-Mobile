import { supabase } from './supabase';

/**
 * Writes one row to the existing `audit_logs` table. Call this after any
 * create/update/delete that touches sensitive data (case_reports, evidence,
 * sos_alerts, survivors, user_profiles) — required by the SafeHer spec and
 * by RA 10173 accountability requirements.
 */
export async function logAudit(params: {
  profileId: string;
  action: string; // e.g. 'INSERT', 'UPDATE', 'STATUS_CHANGE'
  tableName: string;
  recordId: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}) {
  const { error } = await supabase.from('audit_logs').insert({
    profile_id: params.profileId,
    action: params.action,
    table_name: params.tableName,
    record_id: params.recordId,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
  });
  // Audit logging failures should never block the user's action, but should
  // never be silent either — surface to whatever crash/log reporting exists.
  if (error) {
    console.warn('audit log write failed', error.message);
  }
}

/**
 * Generates a human-readable case number. Assumes the existing
 * `case_reports.case_number` column has no DB-side default/trigger yet.
 * If the live Supabase project already generates this server-side, this
 * function becomes unused dead code — delete it rather than fight it.
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

import { supabase } from './supabase';

export async function logAudit(params: {
  profileId: string;
  action: string;
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
  if (error) {
    console.warn('audit log write failed', error.message);
  }
}

/**
 * Shared helpers for every page that calls the create-admin-user /
 * admin-user-metadata Edge Functions — originally private to
 * UserManagementPage.tsx, extracted (module32) so PoliceManagementPage.tsx
 * reuses the exact same error-extraction and date-formatting logic
 * instead of a second, slightly-different copy.
 */

export type AdminMetadata = { last_sign_in_at: string | null; email: string | null; email_confirmed_at: string | null };

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never signed in';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export async function extractInvokeError(data: unknown, error: unknown): Promise<string | undefined> {
  let message = (data as { error?: string } | null)?.error;
  if (!message && error) {
    console.error('[adminUserHelpers] invoke error:', error);
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      console.error('[adminUserHelpers] error HTTP status:', ctx.status, ctx.statusText);
      try {
        const body = await ctx.clone().json();
        console.error('[adminUserHelpers] error body (json):', body);
        // Our own function returns {error}; Supabase's edge gateway (JWT
        // verification failures etc., which never reach our code) uses
        // {message} instead — check both rather than assuming our shape.
        message = body?.error || body?.message || JSON.stringify(body);
      } catch {
        const text = await ctx.clone().text().catch(() => '');
        console.error('[adminUserHelpers] error body (text):', text);
        message = text || `Request failed (HTTP ${ctx.status}${ctx.statusText ? ' ' + ctx.statusText : ''}).`;
      }
    } else {
      message = (error as Error)?.message;
    }
  }
  return message;
}

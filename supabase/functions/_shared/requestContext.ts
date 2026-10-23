// supabase/functions/_shared/requestContext.ts
//
// Client request context for audit rows written by Edge Functions.
//
// WHY THIS EXISTS AS A SEPARATE PATH FROM THE DATABASE DEFAULT:
// module45 puts `current_audit_ip()` on audit_logs.ip_address as a
// column DEFAULT, which transparently captures the caller's IP for all
// 22 trg_audit_* triggers and for the admin app's own logAudit()
// insert — because those all run inside the operator's PostgREST
// request, where `request.headers` is in scope.
//
// An Edge Function is different. It makes its OWN HTTP call to
// PostgREST, so `request.headers` there describes the Edge Function's
// request, not the operator's browser — the default would record
// Supabase's internal address, which is worse than recording nothing
// because it looks like a real answer. These helpers read the
// operator's address off the inbound request instead, and the calling
// function passes it explicitly.
//
// TRUST: x-forwarded-for is a proxy header. A caller can send one, and
// intermediaries append rather than replace. Everything here is
// "what was reported", never "where the request verifiably came from".
// The audit column comment and the admin UI both say so.

/**
 * Best-effort client IP from the inbound request.
 *
 * Tries the proxy chain first and falls back to Supabase's own
 * `x-real-ip`. Returns null rather than a placeholder string when
 * nothing is available — an empty column is honest, "unknown" is a
 * value that will eventually be mistaken for one.
 */
export function clientIpFrom(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // "client, proxy1, proxy2" — leftmost is the originating client as
    // reported, which is also precisely the entry a caller can forge.
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 100);
  }
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 100);
  return null;
}

export function userAgentFrom(req: Request): string | null {
  const ua = req.headers.get('user-agent')?.trim();
  return ua ? ua.slice(0, 300) : null;
}

/** Both at once, shaped for spreading straight into an audit_logs insert. */
export function auditContextFrom(req: Request): { ip_address: string | null; user_agent: string | null } {
  return { ip_address: clientIpFrom(req), user_agent: userAgentFrom(req) };
}

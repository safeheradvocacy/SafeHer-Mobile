// supabase/functions/security-passcode/index.ts
//
// Deploy with:
//   supabase functions deploy security-passcode
//
// Mobile-only security passcode enrollment/verification/change/recovery.
// Never called from, and never grants anything to, the admin web portal —
// every action here operates purely on the CALLING user's own profile via
// current_profile_id(), with no concept of "someone else's account" at
// all, so there is no admin-vs-survivor distinction to even enforce here:
// this function cannot act on any profile but the caller's own.
//
// Follows this project's existing Edge Function conventions exactly (see
// create-admin-user/index.ts): same CORS headers, same OPTIONS/try-catch/
// error-JSON shape, same deno.land/std + esm.sh imports (no npm:
// specifier — none exist anywhere in this repo's functions).
//
// Deliberately does NOT create a service-role client. Every operation
// here is performed through a client scoped to the CALLER's own JWT
// (`callerClient` below) — the actual privilege elevation (writing to the
// locked-down security_passcodes/protected_access_grants tables) happens
// entirely inside the SECURITY DEFINER SQL functions this calls
// (module33_security_passcode.sql), not in this function. If this
// function had a bug, it could still never do anything beyond what the
// authenticated caller's own RLS-scoped session already permits plus
// those specific, narrowly-scoped SQL functions — there is no
// service-role escalation surface here at all.
//
// Passcode values are read once into a local variable for the duration
// of one request, passed only to Supabase (as an RPC parameter, over the
// function's own already-HTTPS invocation), and never otherwise touched:
// never logged (console.error below logs only error.message/status, and
// request bodies are never dumped), never echoed back in any response,
// never written to audit_logs (which records only event/outcome
// metadata — see logEvent below).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Action = 'enroll' | 'verify' | 'change' | 'forgot';

interface RequestBody {
  action: Action;
  passcode?: string; // 'verify'
  newPasscode?: string; // 'enroll' | 'change' | 'forgot'
  password?: string; // 'forgot' only -- the caller's Supabase Auth password
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const res = await handleRequest(req);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers.entries()), ...corsHeaders },
    });
  } catch (e) {
    // Fixed alongside the diagnosis pass that found the 42501 grants bug
    // below: this previously returned the raw caught exception's own
    // message directly to the client, which could echo back internal
    // detail (e.g. a raw Postgres error string) for whatever uncaught
    // case reached here. Logged in full server-side (with a correlation
    // id so it's findable), generic to the client.
    const correlationId = newCorrelationId();
    console.error(`[security-passcode][${correlationId}] unhandled error:`, e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.', requestId: correlationId }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Diagnostics (Phase 9 of the governing spec): every response below
// carries this short, non-sensitive id so a user-reported failure can be
// matched to its exact `supabase functions logs` entry without needing
// to log (or the user needing to share) anything sensitive. Never
// contains a passcode, token, or identifying content -- it's an opaque
// correlation handle only.
function newCorrelationId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// Postgres/PostgREST error codes this function specifically distinguishes,
// so a genuine infrastructure problem (a missing grant, a missing
// function -- i.e. a deployment defect) is never silently flattened into
// the same generic message/log line as an expected business outcome (a
// wrong passcode, an already-enrolled account). This is exactly the class
// of bug this diagnosis pass found: enroll/verify/reset were being
// REVOKEd from `authenticated` while the Edge Function calls them AS
// `authenticated` -- every call failed with 42501, which prior error
// handling here reported identically to a generic "please try again",
// making the real cause invisible in both the UI and (without checking
// `error.code` specifically) easy to miss in the logs too.
type PgErrorCategory = 'permission_denied' | 'missing_object' | 'not_authenticated' | 'conflict' | 'validation' | 'unknown';

function classifyPgError(error: { code?: string; message?: string } | null | undefined): PgErrorCategory {
  const code = error?.code;
  if (code === '42501') return 'permission_denied'; // GRANT missing -- a deployment defect, not a user error
  if (code === 'PGRST202' || code === '42883') return 'missing_object'; // function/migration missing entirely
  if (code === '28000') return 'not_authenticated'; // this function's own raised "not authenticated" / "grant required"
  if (code === '23505') return 'conflict'; // already enrolled
  if (code === '22023') return 'validation'; // passcode too short (SQL-level backstop)
  return 'unknown';
}

// Logs loudly and consistently for the two categories that mean "this
// deployment is misconfigured" (permission_denied, missing_object) --
// these should never be mistaken for ordinary user-facing failures by
// whoever is reading `supabase functions logs`.
function logPgError(correlationId: string, action: string, error: { code?: string; message?: string }): PgErrorCategory {
  const category = classifyPgError(error);
  if (category === 'permission_denied' || category === 'missing_object') {
    console.error(
      `[security-passcode][${correlationId}] DEPLOYMENT DEFECT during '${action}': ${category} (code=${error.code}) -- ${error.message}. This is not a user-caused failure; check that module33/module34's grants and functions actually exist on this project.`
    );
  } else {
    console.error(`[security-passcode][${correlationId}] '${action}' failed: code=${error.code ?? 'n/a'} ${error.message ?? ''}`);
  }
  return category;
}

async function handleRequest(req: Request): Promise<Response> {
  const correlationId = newCorrelationId();

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonOrServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Scoped to the CALLER's JWT -- RLS applies to every query this client
  // makes exactly as if the mobile app had made it directly. See the file
  // header: there is no separate service-role client anywhere in this
  // function.
  const callerClient = createClient(supabaseUrl, anonOrServiceKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
  } = await callerClient.auth.getUser();
  if (!callerUser) {
    return json({ error: 'Invalid session' }, 401);
  }

  const { data: callerProfile } = await callerClient
    .from('user_profiles')
    .select('profile_id, role')
    .eq('auth_user_id', callerUser.id)
    .single();

  if (!callerProfile) {
    return json({ error: 'Account not found' }, 404);
  }

  // Mobile-only feature -- a caller authenticated as any admin/staff role
  // has nothing to enroll or verify here. This can only happen if an
  // admin's own session token were somehow pointed at this endpoint
  // (never done by the admin web portal itself, which has no code path
  // that calls this function) -- refused outright either way, matching
  // the governing spec's "Do not introduce passcode requirements for
  // administrator accounts."
  if (callerProfile.role !== 'survivor') {
    return json({ error: 'This feature is only available to survivor accounts.' }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  async function logEvent(action: string, outcome: 'success' | 'failure', extra?: Record<string, unknown>) {
    const { error } = await callerClient.from('audit_logs').insert({
      profile_id: callerProfile!.profile_id,
      action: `SECURITY_PASSCODE_${action.toUpperCase()}_${outcome.toUpperCase()}`,
      table_name: 'security_passcodes',
      record_id: callerProfile!.profile_id,
      new_values: extra ?? null,
    });
    // Audit logging failures never block the actual security outcome
    // (already decided and applied by this point) -- same policy as the
    // client-side logAudit() helper -- but are never silent.
    if (error) {
      console.error('[security-passcode] audit log write failed:', error.message);
    }
  }

  switch (body.action) {
    case 'enroll': {
      if (!body.newPasscode || typeof body.newPasscode !== 'string') {
        return json({ error: 'A passcode is required.' }, 400);
      }
      const strengthError = validatePasscodeStrength(body.newPasscode);
      if (strengthError) {
        return json({ error: strengthError }, 400);
      }
      const { error } = await callerClient.rpc('enroll_security_passcode', { p_passcode: body.newPasscode });
      if (error) {
        const category = logPgError(correlationId, 'enroll', error);
        await logEvent('enroll', 'failure', { reason: category, requestId: correlationId });
        if (category === 'conflict') {
          return json({ error: 'A security passcode is already set up for this account.', requestId: correlationId }, 409);
        }
        // permission_denied/missing_object/unknown all reach the user as
        // the same generic, retry-suggesting message -- distinguishing
        // them is for the server-side log (logPgError above), not for
        // what's shown here, since none of those are something the user
        // can fix by retrying differently. requestId lets support/dev
        // correlate a report to the real cause without needing to expose
        // it in the UI.
        return json({ error: "We couldn't set up your passcode. Please try again.", requestId: correlationId }, 500);
      }
      await logEvent('enroll', 'success');
      return json({ success: true }, 200);
    }

    case 'verify': {
      if (!body.passcode || typeof body.passcode !== 'string') {
        return json({ error: 'A passcode is required.' }, 400);
      }
      const { data, error } = await callerClient.rpc('verify_security_passcode', { p_passcode: body.passcode }).single();
      if (error) {
        logPgError(correlationId, 'verify', error);
        await logEvent('verify', 'failure', { reason: classifyPgError(error), requestId: correlationId });
        return json({ error: "We couldn't verify your passcode right now. Please try again.", requestId: correlationId }, 500);
      }
      const result = data as { success: boolean; locked: boolean; retry_after_seconds: number | null };
      if (result.success) {
        await logEvent('verify', 'success');
        return json({ success: true }, 200);
      }
      await logEvent('verify', 'failure', { locked: result.locked, retry_after_seconds: result.retry_after_seconds });
      if (result.locked) {
        return json(
          { success: false, locked: true, retryAfterSeconds: result.retry_after_seconds, error: 'Too many incorrect attempts. Please wait before trying again.' },
          429
        );
      }
      return json({ success: false, locked: false, error: 'Incorrect passcode. Please try again.' }, 401);
    }

    case 'change': {
      if (!body.newPasscode || typeof body.newPasscode !== 'string') {
        return json({ error: 'A new passcode is required.' }, 400);
      }
      const strengthError = validatePasscodeStrength(body.newPasscode);
      if (strengthError) {
        return json({ error: strengthError }, 400);
      }
      // p_require_active_grant = true -- the SQL function itself checks
      // has_active_protected_access() and refuses otherwise. The caller
      // must have already verified their CURRENT passcode (action:
      // 'verify') before this can succeed -- not trusted from any client
      // claim, re-checked server-side on every call.
      const { error } = await callerClient.rpc('reset_security_passcode', {
        p_new_passcode: body.newPasscode,
        p_require_active_grant: true,
      });
      if (error) {
        const category = logPgError(correlationId, 'change', error);
        const needsVerification = category === 'not_authenticated'; // this RPC's own raised "active protected-access grant is required" uses errcode 28000
        await logEvent('change', 'failure', { reason: needsVerification ? 'not_verified' : category, requestId: correlationId });
        return json(
          {
            error: needsVerification ? 'Please verify your current passcode first.' : "We couldn't change your passcode. Please try again.",
            requestId: correlationId,
          },
          needsVerification ? 403 : 500
        );
      }
      await logEvent('change', 'success');
      return json({ success: true }, 200);
    }

    case 'forgot': {
      if (!body.newPasscode || typeof body.newPasscode !== 'string' || !body.password || typeof body.password !== 'string') {
        return json({ error: 'Your account password and a new passcode are both required.' }, 400);
      }
      const strengthError = validatePasscodeStrength(body.newPasscode);
      if (strengthError) {
        return json({ error: strengthError }, 400);
      }
      // Independently re-verifies the caller's Supabase Auth password
      // server-side -- this function never trusts a prior client-side
      // signInWithPassword() call as proof, since that call (and its
      // result) never actually reaches this function otherwise. This IS
      // the "appropriate reauthentication" recovery path the governing
      // spec calls for, performed fresh, here.
      const reauthClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? anonOrServiceKey);
      const { error: reauthError } = await reauthClient.auth.signInWithPassword({
        email: callerUser.email!,
        password: body.password,
      });
      if (reauthError) {
        await logEvent('forgot', 'failure', { reason: 'password_reauth_failed', requestId: correlationId });
        return json({ error: 'Incorrect account password.', requestId: correlationId }, 401);
      }
      const { error } = await callerClient.rpc('reset_security_passcode', {
        p_new_passcode: body.newPasscode,
        p_require_active_grant: false,
      });
      if (error) {
        const category = logPgError(correlationId, 'forgot', error);
        await logEvent('forgot', 'failure', { reason: category, requestId: correlationId });
        return json({ error: "We couldn't reset your passcode. Please try again.", requestId: correlationId }, 500);
      }
      await logEvent('forgot', 'success');
      return json({ success: true }, 200);
    }

    default:
      return json({ error: 'Unknown action', requestId: correlationId }, 400);
  }
}

// Mirrors the policy enforced client-side (see
// mobile/src/lib/passcodeStrength.ts) as a trusted-backend backstop — a
// client that skipped or patched the UI check must still be refused here.
// Deliberately conservative/simple (length + a couple of pattern checks)
// rather than re-implementing a full zxcvbn-equivalent estimator
// server-side in Deno; the real strength bar (entropy estimate, common-
// password list) is enforced client-side where a proper estimator library
// is available, same division of labor as this project's existing
// "client does the rich UX check, server does a blunt but real backstop"
// pattern (e.g. ReportIncidentScreen's identity-verification re-check).
function validatePasscodeStrength(passcode: string): string | null {
  if (passcode.length < 8) {
    return 'Your passcode must be at least 8 characters.';
  }
  if (/^(.)\1+$/.test(passcode)) {
    return 'Your passcode cannot be the same character repeated.';
  }
  const lower = passcode.toLowerCase();
  const commonWeak = ['password', 'passcode', '12345678', '123456789', 'qwertyui', 'letmein1', 'iloveyou', 'abc12345'];
  if (commonWeak.some((w) => lower === w || lower.startsWith(w))) {
    return 'That passcode is too common. Please choose a less predictable one.';
  }
  return null;
}

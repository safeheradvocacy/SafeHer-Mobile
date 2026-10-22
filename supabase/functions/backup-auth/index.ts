// supabase/functions/backup-auth/index.ts
//
// Deploy with:
//   supabase functions deploy backup-auth
// (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are already available to
// Edge Functions automatically. This function needs no new secret —
// the dedicated password's verifier lives only in the database, and
// the archive encryption key belongs to backup-create, not here.)
//
// Module 42 — the ONLY place a dedicated backup authorization password
// is accepted, verified, or changed. Four actions:
//
//   'status'    — is a dedicated password provisioned? is it locked?
//                 (booleans only; never the hash)
//   'provision' — first-time setup, when none exists yet
//   'rotate'    — change it, requires the current password
//   'authorize' — verify it and mint ONE single-use, operation-scoped,
//                 short-lived grant the other backup functions consume
//
// WHY THE PASSWORD TERMINATES HERE AND NOT IN SQL FROM THE BROWSER:
// module42's verify_backup_password_and_grant() and
// set_backup_password() are REVOKEd from `authenticated` on purpose, so
// a browser cannot reach them over PostgREST even with a valid admin
// JWT. They are callable only by this function's service-role client.
// The plaintext password therefore exists only (a) in the HTTPS request
// body, and (b) as a bound parameter inside one SQL call. It is never
// logged, never echoed back, never written to audit_logs, and never
// placed in a URL or query string.
//
// THE module33/34 LESSON, APPLIED DELIBERATELY:
// security-passcode/index.ts documents a real past bug — its RPCs were
// REVOKEd from `authenticated` while that function called them AS
// `authenticated`, so every call failed 42501 and the real cause was
// invisible. This function is built the other way round from the start:
// identity is resolved with the CALLER's client (so auth.uid() is the
// operator for the one RPC that is gated that way, 'status'), but every
// privileged RPC is invoked with the SERVICE-ROLE client and the
// operator's profile_id passed explicitly as a parameter and re-verified
// inside the function against user_profiles. classifyPgError below still
// distinguishes a 42501/42883 deployment defect from an ordinary wrong
// password, for the same reason.
//
// A NOTE ON WHAT THIS IS: a second knowledge factor controlled by the
// technical Super Admin tier. It is NOT multi-factor authentication —
// it proves the operator knows a separately-held secret, not that they
// hold a second device. The UI must not call it 2FA.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROTECTED_OPERATIONS = [
  'create',
  'schedule_create',
  'schedule_modify',
  'schedule_trigger',
  'download',
  'validate',
  'restore_begin',
  'restore_execute',
  'delete',
  'security_settings',
] as const;

// Deliberately short. A restore-execute grant in particular should be
// minted immediately before execution, not held open while an operator
// reads a long confirmation screen — the restore flow re-authorizes at
// the execution step for exactly this reason.
const TTL_BY_OPERATION: Record<string, number> = {
  create: 300,
  schedule_create: 300,
  schedule_modify: 300,
  schedule_trigger: 300,
  download: 120,
  validate: 300,
  restore_begin: 300,
  restore_execute: 120,
  delete: 120,
  security_settings: 300,
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function newCorrelationId(): string {
  return crypto.randomUUID().slice(0, 8);
}

type PgErrorCategory = 'permission_denied' | 'missing_object' | 'not_authenticated' | 'unknown';

function classifyPgError(error: { code?: string; message?: string } | null | undefined): PgErrorCategory {
  const code = error?.code;
  if (code === '42501') return 'permission_denied';
  if (code === 'PGRST202' || code === '42883') return 'missing_object';
  if (code === '28000') return 'not_authenticated';
  return 'unknown';
}

function logPgError(correlationId: string, action: string, error: { code?: string; message?: string }): PgErrorCategory {
  const category = classifyPgError(error);
  if (category === 'permission_denied' || category === 'missing_object') {
    console.error(
      `[backup-auth][${correlationId}] DEPLOYMENT DEFECT during '${action}': ${category} (code=${error.code}) — ${error.message}. Not a user-caused failure; check that module42's functions and grants actually exist on this project.`
    );
  } else {
    console.error(`[backup-auth][${correlationId}] '${action}' failed: code=${error.code ?? 'n/a'} ${error.message ?? ''}`);
  }
  return category;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const correlationId = newCorrelationId();
  try {
    const res = await handleRequest(req, correlationId);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers.entries()), ...corsHeaders },
    });
  } catch (e) {
    // Never surface a raw error: the thrown value could contain a
    // parameter value from a failed RPC call.
    console.error(`[backup-auth][${correlationId}] unhandled error:`, e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: 'An unexpected error occurred.', correlationId }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }
});

interface Caller {
  profileId: string;
  callerClient: SupabaseClient;
}

async function authorizeTechnicalAdmin(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<Caller | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  const {
    data: { user: callerUser },
  } = await callerClient.auth.getUser();
  if (!callerUser) return json({ error: 'Invalid session' }, 401);

  const { data: callerProfile } = await callerClient
    .from('user_profiles')
    .select('profile_id, role, is_active')
    .eq('auth_user_id', callerUser.id)
    .single();

  // Same boundary and wording as backup-create/backup-restore, plus the
  // is_active check module42's own SQL enforces — a deactivated
  // administrator must not be able to authorize a backup operation.
  if (!callerProfile || !['provincial_admin', 'super_admin'].includes(callerProfile.role) || !callerProfile.is_active) {
    return json({ error: 'Not authorized — technical administrator access required' }, 403);
  }
  return { profileId: callerProfile.profile_id, callerClient };
}

async function handleRequest(req: Request, correlationId: string): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const body = await req.json().catch(() => null);
  const action: string | undefined = body?.action;
  if (!action || !['status', 'provision', 'rotate', 'authorize'].includes(action)) {
    return json({ error: 'Unknown action', correlationId }, 400);
  }

  const caller = await authorizeTechnicalAdmin(req, supabaseUrl, serviceRoleKey);
  if (caller instanceof Response) return caller;

  switch (action) {
    case 'status':
      return handleStatus(caller, correlationId);
    case 'provision':
      return handleSetPassword(adminClient, caller, body, correlationId, false);
    case 'rotate':
      return handleSetPassword(adminClient, caller, body, correlationId, true);
    default:
      return handleAuthorize(adminClient, caller, body, correlationId);
  }
}

// ---------------------------------------------------------
// status — booleans only.
// ---------------------------------------------------------
async function handleStatus(caller: Caller, correlationId: string): Promise<Response> {
  // has_backup_password() IS granted to authenticated and gates itself
  // on is_provincial_technical_admin(), so it is called as the caller —
  // auth.uid() must resolve to the operator for that internal check.
  const { data, error } = await caller.callerClient.rpc('has_backup_password').single();
  if (error) {
    const category = logPgError(correlationId, 'status', error);
    return json({ error: 'Could not read backup security status.', category, correlationId }, 500);
  }
  const row = data as { configured: boolean; locked: boolean; retry_after_seconds: number | null };
  return json(
    { configured: row.configured, locked: row.locked, retryAfterSeconds: row.retry_after_seconds, correlationId },
    200
  );
}

// ---------------------------------------------------------
// provision / rotate
// ---------------------------------------------------------
async function handleSetPassword(
  adminClient: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown> | null,
  correlationId: string,
  isRotation: boolean
): Promise<Response> {
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : null;

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return json({ error: strengthError, correlationId }, 400);

  if (isRotation && !currentPassword) {
    return json({ error: 'The current backup password is required to change it.', correlationId }, 400);
  }

  const { data, error } = await adminClient
    .rpc('set_backup_password', {
      p_profile_id: caller.profileId,
      p_new_password: newPassword,
      p_current_password: isRotation ? currentPassword : null,
    })
    .single();

  if (error) {
    const category = logPgError(correlationId, isRotation ? 'rotate' : 'provision', error);
    return json({ error: 'Could not update the backup password.', category, correlationId }, 500);
  }

  const row = data as { ok: boolean; reason: string };
  if (!row.ok) {
    // Audited as a failure, with the REASON CODE only — never the
    // submitted password, and never the stored verifier.
    await writeAudit(adminClient, caller.profileId, 'BACKUP_PASSWORD_CHANGE_DENIED', { reason: row.reason, correlationId });

    const messages: Record<string, string> = {
      not_authorized: 'Not authorized — technical administrator access required.',
      too_short: 'The backup password must be at least 12 characters.',
      locked: 'Backup authorization is temporarily locked after repeated failed attempts.',
      current_password_incorrect: 'The current backup password is incorrect.',
    };
    const status = row.reason === 'not_authorized' ? 403 : row.reason === 'locked' ? 429 : 400;
    return json({ error: messages[row.reason] ?? 'Could not update the backup password.', reason: row.reason, correlationId }, status);
  }

  await writeAudit(
    adminClient,
    caller.profileId,
    row.reason === 'rotated' ? 'BACKUP_PASSWORD_ROTATED' : 'BACKUP_PASSWORD_PROVISIONED',
    { correlationId }
  );

  return json({ ok: true, outcome: row.reason, correlationId }, 200);
}

// ---------------------------------------------------------
// authorize — mint one single-use, operation-scoped grant.
// ---------------------------------------------------------
async function handleAuthorize(
  adminClient: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown> | null,
  correlationId: string
): Promise<Response> {
  const password = typeof body?.password === 'string' ? body.password : '';
  const operation = typeof body?.operation === 'string' ? body.operation : '';
  const targetId = typeof body?.targetId === 'string' && body.targetId.length > 0 ? body.targetId : null;

  if (!PROTECTED_OPERATIONS.includes(operation as (typeof PROTECTED_OPERATIONS)[number])) {
    return json({ error: 'Unknown protected operation', correlationId }, 400);
  }
  if (!password) {
    return json({ error: 'The backup authorization password is required.', correlationId }, 400);
  }

  const { data, error } = await adminClient
    .rpc('verify_backup_password_and_grant', {
      p_profile_id: caller.profileId,
      p_password: password,
      p_operation: operation,
      p_target_id: targetId,
      p_ttl_seconds: TTL_BY_OPERATION[operation] ?? 300,
    })
    .single();

  if (error) {
    const category = logPgError(correlationId, 'authorize', error);
    return json({ error: 'Could not verify backup authorization.', category, correlationId }, 500);
  }

  const row = data as {
    ok: boolean;
    grant_id: string | null;
    expires_at: string | null;
    locked: boolean;
    retry_after_seconds: number | null;
    reason: string;
  };

  if (!row.ok) {
    // Every failed attempt is recorded — actor, operation, target,
    // outcome — with no password content, per §12 of the brief.
    await writeAudit(adminClient, caller.profileId, row.locked ? 'BACKUP_AUTH_LOCKED' : 'BACKUP_AUTH_FAILED', {
      operation,
      target_id: targetId,
      reason: row.reason,
      retry_after_seconds: row.retry_after_seconds,
      correlationId,
    });

    if (row.reason === 'not_configured') {
      return json(
        { error: 'No backup authorization password has been set up yet.', reason: row.reason, correlationId },
        409
      );
    }
    if (row.reason === 'not_authorized') {
      return json({ error: 'Not authorized — technical administrator access required.', reason: row.reason, correlationId }, 403);
    }
    return json(
      {
        error: row.locked
          ? 'Too many failed attempts. Backup authorization is temporarily locked.'
          : 'Incorrect backup authorization password.',
        reason: row.reason,
        locked: row.locked,
        retryAfterSeconds: row.retry_after_seconds,
        correlationId,
      },
      row.locked ? 429 : 401
    );
  }

  await writeAudit(adminClient, caller.profileId, 'BACKUP_AUTH_GRANTED', {
    operation,
    target_id: targetId,
    grant_id: row.grant_id,
    expires_at: row.expires_at,
    correlationId,
  });

  return json({ ok: true, grantId: row.grant_id, expiresAt: row.expires_at, operation, correlationId }, 200);
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

// Metadata only. There is no code path in this file that puts a
// password — submitted, current, or new — into audit_logs, a console
// line, or a response body.
async function writeAudit(
  adminClient: SupabaseClient,
  profileId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await adminClient.from('audit_logs').insert({
    profile_id: profileId,
    action,
    table_name: 'backup_authorization',
    new_values: metadata,
  });
  if (error) console.error(`[backup-auth] failed to write audit row for '${action}':`, error.message);
}

function validatePasswordStrength(password: string): string | null {
  if (!password) return 'A backup password is required.';
  if (password.length < 12) return 'The backup password must be at least 12 characters.';
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  // Deliberately NOT a symbol requirement on top of the above: length
  // plus three character classes at 12+ characters is already past the
  // point where added class rules mostly push operators toward
  // predictable substitutions. The real defence here is the server-side
  // lockout in module42, not composition theatre.
  return null;
}

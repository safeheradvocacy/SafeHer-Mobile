// supabase/functions/create-admin-user/index.ts
//
// Deploy with:
//   supabase functions deploy create-admin-user
// (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are already available to
// Edge Functions automatically — never set the service role key in the
// admin dashboard's .env, only here.)
//
// Called from the admin dashboard's "Add administrator" flow once deployed.
// Rejects the request unless the caller's own JWT belongs to an active
// provincial_admin/super_admin (may create any role, for any municipality/
// barangay/shelter), or a municipal_admin creating a municipal_admin or
// barangay_admin account scoped to their own municipality. barangay_admin
// can never create other admin accounts itself. shelter_admin creation is
// restricted to provincial_admin/super_admin only (not municipal_admin) —
// a shelter can receive referrals across municipality lines, so shelter
// administration sits at the provincial level, unlike barangay_admin
// which is scoped to a single municipality.
//
// shelter_admin is NOT a caller of this function (role consolidation,
// module24_retire_shelter_staff_role.sql) — its one-and-only authorized
// action here used to be creating a shelter_staff account for its own
// shelter; now that shelter_staff is retired, shelter_admin has nothing
// left to do through this endpoint. See the 'shelter_staff' rejection
// below.
//
// 'provincial_staff' (RBAC split, module11) is a province-wide
// OPERATIONAL role — it reaches this function only as a CREATE target
// (created by provincial_admin/super_admin, same as municipal_admin),
// never as a caller: Administrator Management is a technical-admin-only
// surface, so 'provincial_staff' never calls this endpoint itself.
//
// body.action selects the operation: 'create' (default, unchanged
// behavior — every existing caller, including ShelterAdminDashboard.tsx's
// inline staff-creation call, omits `action` entirely) or 'update' (RBAC
// split addition — edits an EXISTING profile's role/jurisdiction/name/
// phone). 'update' re-runs the exact same caller-authorization and
// jurisdiction-validation checks as 'create' against the target's NEW
// role/jurisdiction, so a caller can never use edit to grant a role or
// jurisdiction they couldn't have created directly — this is what
// prevents privilege escalation via the edit path. A caller may never
// edit their own profile_id through this function (self-service profile
// edits stay in Settings) — this is enforced before any other check.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Required for browser callers. Without these headers on every response
// (including the OPTIONS preflight and error responses), the browser's own
// CORS policy silently blocks the request before it's even sent — the page
// never sees an HTTP status or body at all, just a generic network-level
// failure ("Failed to send a request to the Edge Function"). curl/CLI
// testing never surfaces this, since CORS is enforced by browsers, not by
// the server or by command-line HTTP clients — that's why this looked like
// the function was working fine right up until it was actually called from
// the admin dashboard.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    // Without this, an uncaught exception anywhere below produces a raw,
    // non-JSON 500 from the Deno runtime — the admin dashboard's error
    // banner can't extract a message from that, so it always falls back
    // to a generic "Could not create this account" with no way to
    // diagnose the real cause from the client side. Logging here also
    // means the message shows up in `supabase functions logs`.
    console.error('[create-admin-user] unhandled error:', e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders },
    });
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client scoped to the CALLER's JWT, only used to verify who's asking.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
  } = await callerClient.auth.getUser();
  if (!callerUser) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  }

  const { data: callerProfile } = await callerClient
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', callerUser.id)
    .single();

  // barangay_admin can only be created by someone above it in the
  // hierarchy — it never appears in this "who's allowed to create admin
  // accounts at all" check. shelter_admin was briefly added here for
  // shelter_staff creation (module7) — removed now that shelter_staff is
  // retired (module24_retire_shelter_staff_role.sql); shelter_admin has
  // no other authorized action through this endpoint.
  if (!callerProfile || !['municipal_admin', 'provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    return new Response(JSON.stringify({ error: 'Not authorized to create admin accounts' }), { status: 403 });
  }

  const body = await req.json();
  // 'update' (RBAC split addition) edits an EXISTING profile instead of
  // creating a new auth.users row — every field below except
  // email/password applies to both actions identically. Defaulting to
  // 'create' preserves every existing caller (including
  // ShelterAdminDashboard.tsx's inline staff-creation call) unchanged.
  const action: 'create' | 'update' = body.action === 'update' ? 'update' : 'create';
  const { email, password, firstName, lastName, phoneNumber, role } = body;
  // Normalized at this boundary rather than trusted verbatim from the
  // request: a client (correctly) omitting a jurisdiction field for a
  // role that doesn't need one can still send '' instead of undefined/
  // null (e.g. an unset <select> defaulting to an empty string) — an
  // empty string is not null/undefined, so every `?? null`/ternary
  // below would otherwise pass it straight through into a uuid column
  // and fail with "invalid input syntax for type uuid: ''" instead of
  // cleanly resolving to "no jurisdiction". This is exactly the failure
  // this project's own admin UI hit for a newly added no-jurisdiction
  // role before this normalization existed.
  const municipalityId: string | null = body.municipalityId || null;
  const barangayId: string | null = body.barangayId || null;
  const shelterId: string | null = body.shelterId || null;
  const targetProfileId: string | null = body.profileId || null;

  if (action === 'update') {
    if (!targetProfileId) {
      return new Response(JSON.stringify({ error: 'profileId is required to update an administrator account' }), { status: 400 });
    }
    // Editing your own account through this admin-management path could
    // otherwise be used to quietly change your own role/jurisdiction —
    // self-service profile edits (name/phone) stay in Settings instead,
    // where they can never touch role or jurisdiction at all.
    if (targetProfileId === callerProfile.profile_id) {
      return new Response(JSON.stringify({ error: 'Use your Profile/Settings page to edit your own account' }), { status: 403 });
    }
    if (!firstName || !lastName || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
  } else if (!email || !password || !firstName || !lastName || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // 'super_admin' is retired as a creatable target role (RBAC finalization
  // pass) — confirmed live to be 100% functionally identical to
  // 'provincial_admin' in every RLS policy and authorization check in this
  // codebase (this function included: nothing below ever distinguished
  // between the two). Rather than leave two labels for one permission set
  // reachable only by omission from the admin UI, this is enforced here
  // too, so a direct API call can't recreate the redundancy the UI now
  // hides. The enum value itself, and every existing 'provincial_admin',
  // 'super_admin' check elsewhere, are left untouched — this only blocks
  // NEW accounts from being minted with the retired label.
  if (role === 'super_admin') {
    return new Response(
      JSON.stringify({ error: "'super_admin' is retired — use 'provincial_admin' instead (identical privileges)." }),
      { status: 400 }
    );
  }

  // 'shelter_staff' is retired (role consolidation — shelter_admin is now
  // the single official shelter role; existing shelter_staff accounts are
  // migrated to shelter_admin by module24_retire_shelter_staff_role.sql,
  // a one-time SQL migration, not by this function). Blocked here for
  // BOTH 'create' and 'update' so a direct API call can't mint or
  // restore the role even though it's no longer offered anywhere in the
  // admin UI. Mirrors the 'super_admin' block above exactly — the enum
  // value itself is left in place (Postgres can't cheaply drop a single
  // enum label), this only blocks new use of it.
  if (role === 'shelter_staff') {
    return new Response(
      JSON.stringify({ error: "'shelter_staff' is retired — use 'shelter_admin' instead." }),
      { status: 400 }
    );
  }

  if (role === 'shelter_admin' && !['provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    return new Response(
      JSON.stringify({ error: 'Only provincial administrators can create Shelter Admin accounts' }),
      { status: 403 }
    );
  }

  // support_expert (confidential survivor<->expert chat) is deliberately
  // as tightly scoped as shelter_admin creation — province-tier only. It
  // also carries no municipality/barangay/shelter jurisdiction at all
  // (see module6_ai_support.sql's file header): a support_expert can be
  // assigned to any survivor's request regardless of municipality, so
  // unlike barangay_admin there is nothing to resolve/validate here.
  if (role === 'support_expert' && !['provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    return new Response(
      JSON.stringify({ error: 'Only provincial administrators can create Support Expert accounts' }),
      { status: 403 }
    );
  }

  // law_enforcement is province-tier-only to create, matching the
  // shelter_admin/support_expert precedent — per the explicit RBAC
  // design decision for this role (Provincial Admin -> Authorized Law
  // Enforcement Account). Like support_expert, it carries no
  // municipality/barangay/shelter jurisdiction (see
  // module9_law_enforcement.sql's file header): access is granted
  // per-referral by whichever case-admin currently owns a case, not by
  // geography, so there is nothing to resolve/validate here either.
  if (role === 'law_enforcement' && !['provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    return new Response(
      JSON.stringify({ error: 'Only provincial administrators can create Law Enforcement accounts' }),
      { status: 403 }
    );
  }

  if (!['municipal_admin', 'barangay_admin'].includes(role) && callerProfile.role === 'municipal_admin') {
    return new Response(
      JSON.stringify({ error: 'Municipal admins can only create municipal_admin or barangay_admin accounts within their own municipality' }),
      { status: 403 }
    );
  }

  // Admin client with the service role key — server-side only, this is the
  // one legitimate place that key is ever used in the whole SafeHer system.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Resolved server-side, never trusted from the request body — a
  // barangay_admin's/shelter_admin's municipality_id and shelter_id are
  // derived from the barangay/shelter row itself, so a
  // caller can't claim one under a different municipality/shelter while
  // asserting a mismatched id in the request body.
  let resolvedMunicipalityId: string | null = municipalityId ?? null;
  let resolvedShelterId: string | null = null;

  if (role === 'barangay_admin') {
    if (!barangayId) {
      return new Response(JSON.stringify({ error: 'barangayId is required to create a barangay_admin account' }), { status: 400 });
    }
    const { data: barangayRow, error: barangayErr } = await adminClient
      .from('barangays')
      .select('barangay_id, municipality_id')
      .eq('barangay_id', barangayId)
      .single();
    if (barangayErr || !barangayRow) {
      return new Response(JSON.stringify({ error: 'Barangay not found' }), { status: 400 });
    }
    resolvedMunicipalityId = barangayRow.municipality_id;

    if (callerProfile.role === 'municipal_admin' && resolvedMunicipalityId !== callerProfile.municipality_id) {
      return new Response(
        JSON.stringify({ error: 'Municipal admins can only create barangay_admin accounts for barangays within their own municipality' }),
        { status: 403 }
      );
    }
  } else if (role === 'shelter_admin') {
    if (!shelterId) {
      return new Response(JSON.stringify({ error: 'shelterId is required to create a shelter_admin account' }), { status: 400 });
    }
    const { data: shelterRow, error: shelterErr } = await adminClient
      .from('shelters')
      .select('shelter_id, municipality_id')
      .eq('shelter_id', shelterId)
      .single();
    if (shelterErr || !shelterRow) {
      return new Response(JSON.stringify({ error: 'Shelter not found' }), { status: 400 });
    }
    resolvedMunicipalityId = shelterRow.municipality_id;
    resolvedShelterId = shelterId;
    // No municipal_admin branch here — the authorization check above
    // already rejects any municipal_admin caller for role==='shelter_admin'
    // before this point is ever reached.
  } else if (callerProfile.role === 'municipal_admin' && municipalityId !== callerProfile.municipality_id) {
    return new Response(
      JSON.stringify({ error: 'Municipal admins can only create municipal_admin accounts within their own municipality' }),
      { status: 403 }
    );
  }

  if (action === 'update') {
    const { data: targetBefore, error: targetErr } = await adminClient
      .from('user_profiles')
      .select('*')
      .eq('profile_id', targetProfileId)
      .single();
    if (targetErr || !targetBefore) {
      return new Response(JSON.stringify({ error: 'Administrator account not found' }), { status: 404 });
    }

    // Deliberately does not touch is_active (that's the separate
    // Activate/Deactivate button's job) or email/password (not editable
    // through this admin-management path this pass).
    const { data: profileRow, error: profileErr } = await adminClient
      .from('user_profiles')
      .update({
        municipality_id: resolvedMunicipalityId,
        barangay_id: role === 'barangay_admin' ? barangayId : null,
        shelter_id: role === 'shelter_admin' ? resolvedShelterId : null,
        role,
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber ?? null,
      })
      .eq('profile_id', targetProfileId)
      .select()
      .single();

    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), { status: 400 });
    }

    await adminClient.from('audit_logs').insert({
      profile_id: callerProfile.profile_id,
      action: 'UPDATE',
      table_name: 'user_profiles',
      record_id: profileRow.profile_id,
      old_values: targetBefore,
      new_values: profileRow,
    });

    return new Response(JSON.stringify({ profile: profileRow }), { headers: { 'content-type': 'application/json' } });
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    return new Response(JSON.stringify({ error: createErr?.message ?? 'Could not create user' }), { status: 400 });
  }

  // handle_new_user() (see module1_auth.sql) fires on every auth.users
  // INSERT — including this admin-API one — and already created a bare
  // user_profiles row (role: 'survivor', auth_user_id: created.user.id)
  // before this line ever runs. Inserting a second row for the same
  // auth_user_id would violate user_profiles_auth_user_id_key, so this
  // updates that auto-created row into the real admin profile instead.
  const { data: profileRow, error: profileErr } = await adminClient
    .from('user_profiles')
    .update({
      municipality_id: resolvedMunicipalityId,
      barangay_id: role === 'barangay_admin' ? barangayId : null,
      shelter_id: role === 'shelter_admin' ? resolvedShelterId : null,
      role,
      first_name: firstName,
      last_name: lastName,
      phone_number: phoneNumber ?? null,
      is_active: true,
    })
    .eq('auth_user_id', created.user.id)
    .select()
    .single();

  if (profileErr) {
    return new Response(JSON.stringify({ error: profileErr.message }), { status: 400 });
  }

  await adminClient.from('audit_logs').insert({
    profile_id: callerProfile.profile_id,
    action: 'INSERT',
    table_name: 'user_profiles',
    record_id: profileRow.profile_id,
    new_values: profileRow,
  });

  return new Response(JSON.stringify({ profile: profileRow }), { headers: { 'content-type': 'application/json' } });
}

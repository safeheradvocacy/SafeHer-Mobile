// supabase/functions/admin-user-metadata/index.ts
//
// Deploy with:
//   supabase functions deploy admin-user-metadata
// (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are already available to
// Edge Functions automatically.)
//
// RBAC split (module11) addition — Administrator Management's "Last
// sign-in" column needs auth.users.last_sign_in_at, which isn't exposed
// through any RLS-reachable table (see UserManagementPage.tsx). This is
// the one legitimate place that data is read, using the service role —
// never exposed to the client directly.
//
// Takes a list of profile_ids and returns { [profile_id]: { last_sign_in_at,
// email, email_confirmed_at } } — but ONLY for profile_ids the caller is
// actually authorized to see, re-deriving that scope server-side (same
// province-tier-sees-all / municipal-tier-sees-own-municipality rule as
// create-admin-user) rather than trusting the client's own filtering.
// Any requested profile_id outside the caller's scope is silently
// omitted from the response, not an error.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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
    console.error('[admin-user-metadata] unhandled error:', e);
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

  // Same caller set as create-admin-user's "who manages admin accounts
  // at all" gate, minus shelter_admin (this endpoint backs
  // UserManagementPage.tsx only, which shelter_admin never opens).
  //
  // 'provincial_staff' (Police Management module) added here too — it
  // only ever requests profile_ids for law_enforcement officers (see
  // PoliceManagementPage.tsx), and the authorization re-derivation
  // below already re-checks scope per target rather than trusting the
  // client's own filtering, same as every other caller.
  if (!callerProfile || !['municipal_admin', 'provincial_admin', 'super_admin', 'provincial_staff'].includes(callerProfile.role)) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 });
  }

  const body = await req.json();
  const profileIds: string[] = Array.isArray(body.profileIds) ? body.profileIds.filter((x: unknown) => typeof x === 'string') : [];
  if (profileIds.length === 0) {
    return new Response(JSON.stringify({ metadata: {} }), { headers: { 'content-type': 'application/json' } });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const isProvincial = ['provincial_admin', 'super_admin', 'provincial_staff'].includes(callerProfile.role);
  const { data: targets } = await adminClient
    .from('user_profiles')
    .select('profile_id, auth_user_id, municipality_id')
    .in('profile_id', profileIds);

  // Re-derive authorization server-side rather than trusting that every
  // id the client sent is one it was legitimately allowed to fetch —
  // province tier sees any target; municipal tier only sees targets in
  // its own municipality (matches create-admin-user's jurisdiction
  // model and UserManagementPage.tsx's own list query).
  const authorized = (targets ?? []).filter(
    (t) => isProvincial || (callerProfile.municipality_id && t.municipality_id === callerProfile.municipality_id)
  );

  const metadata: Record<string, { last_sign_in_at: string | null; email: string | null; email_confirmed_at: string | null }> = {};
  await Promise.all(
    authorized.map(async (t) => {
      const { data } = await adminClient.auth.admin.getUserById(t.auth_user_id);
      if (data?.user) {
        metadata[t.profile_id] = {
          last_sign_in_at: data.user.last_sign_in_at ?? null,
          email: data.user.email ?? null,
          email_confirmed_at: data.user.email_confirmed_at ?? null,
        };
      }
    })
  );

  return new Response(JSON.stringify({ metadata }), { headers: { 'content-type': 'application/json' } });
}

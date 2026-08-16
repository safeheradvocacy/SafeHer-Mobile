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
// provincial_admin/super_admin, or a municipal_admin creating an account
// within their own municipality.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

serve(async (req) => {
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

  if (!callerProfile || !['municipal_admin', 'provincial_admin', 'super_admin'].includes(callerProfile.role)) {
    return new Response(JSON.stringify({ error: 'Not authorized to create admin accounts' }), { status: 403 });
  }

  const body = await req.json();
  const { email, password, firstName, lastName, phoneNumber, role, municipalityId } = body;

  if (!email || !password || !firstName || !lastName || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  if (callerProfile.role === 'municipal_admin') {
    if (role !== 'municipal_admin' || municipalityId !== callerProfile.municipality_id) {
      return new Response(
        JSON.stringify({ error: 'Municipal admins can only create municipal_admin accounts within their own municipality' }),
        { status: 403 }
      );
    }
  }

  // Admin client with the service role key — server-side only, this is the
  // one legitimate place that key is ever used in the whole SafeHer system.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    return new Response(JSON.stringify({ error: createErr?.message ?? 'Could not create user' }), { status: 400 });
  }

  const { data: profileRow, error: profileErr } = await adminClient
    .from('user_profiles')
    .insert({
      auth_user_id: created.user.id,
      municipality_id: municipalityId ?? null,
      role,
      first_name: firstName,
      last_name: lastName,
      phone_number: phoneNumber ?? null,
      is_active: true,
    })
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
});

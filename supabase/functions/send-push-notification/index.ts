// supabase/functions/send-push-notification/index.ts
//
// Deploy with:
//   supabase functions deploy send-push-notification --no-verify-jwt
// then:
//   supabase secrets set PUSH_DISPATCH_SECRET=<random value>
// and, once, against the live database (see module8_notifications_push.sql):
//   alter database postgres set app.settings.push_dispatch_url = 'https://<ref>.supabase.co/functions/v1/send-push-notification';
//   alter database postgres set app.settings.push_dispatch_secret = '<same random value>';
//
// This function has NO end-user caller. It is invoked exactly once,
// internally, by the `trg_dispatch_push_for_notification` trigger on
// the `notifications` table (via pg_net) immediately after a
// high-priority notification row is inserted — never directly from
// the mobile or admin app. --no-verify-jwt is required because that
// trigger call carries no Supabase Auth JWT (there is no "calling
// user" for a background dispatch); in its place, every request must
// present the shared `x-internal-secret` header matching this
// function's own PUSH_DISPATCH_SECRET, which only the database (via
// the operator-configured Postgres setting) and this function's own
// environment ever know. This is why the actual Supabase service role
// key is never placed in Postgres: this generated secret only ever
// authorizes calling THIS one internal endpoint, nothing else.
//
// Recipient selection is never trusted from the request body — the
// only input accepted is a notification_id, and every recipient is
// derived by reading that row (and that row's already-authorized
// profile_id) back out of the database with the service role key.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Kept intentionally generic — no case description, referral detail,
// chat content, address, or phone number ever leaves this function in
// a push payload. The recipient must open the authenticated SafeHer
// interface to see anything beyond this. SOS notifications are the one
// exception to genericizing: both places that create an 'SOS' row
// (notify_on_sos_created and the admin SOS status-update flow) already
// write safe, non-sensitive title/message text at the source, so this
// function forwards those verbatim instead of double-genericizing them.
const GENERIC_COPY: Record<string, { title: string; body: string }> = {
  'Case Update': { title: 'SafeSpace Case Update', body: 'Your case status has been updated. Open SafeSpace to view details.' },
  Referral: { title: 'SafeSpace Referral Update', body: 'You have a referral update. Open SafeSpace to view details.' },
  Assignment: { title: 'SafeSpace Assignment', body: 'You have a new assignment. Open SafeSpace to view details.' },
  Support: { title: 'SafeSpace Support', body: 'You have a new message from SafeSpace Support. Open SafeSpace to view details.' },
};

serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (e) {
    console.error('[send-push-notification] unhandled error:', e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const expectedSecret = Deno.env.get('PUSH_DISPATCH_SECRET');
  const providedSecret = req.headers.get('x-internal-secret');
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const notificationId = body?.notification_id;
  if (!notificationId) {
    return new Response(JSON.stringify({ error: 'notification_id is required' }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: notification, error: notifErr } = await db
    .from('notifications')
    .select('*')
    .eq('notification_id', notificationId)
    .single();

  if (notifErr || !notification) {
    // Nothing to dispatch — do not error the trigger's fire-and-forget
    // call over a race/typo; just record that nothing happened.
    return new Response(JSON.stringify({ status: 'not_found' }), { status: 200 });
  }

  // Recipient is whatever the notification row's own (already RLS/
  // trigger-authorized) profile_id says — never taken from the request.
  const { data: tokenRows } = await db
    .from('push_tokens')
    .select('token_id, expo_push_token')
    .eq('profile_id', notification.profile_id)
    .eq('is_active', true);

  if (!tokenRows || tokenRows.length === 0) {
    await db
      .from('notifications')
      .update({ push_dispatched_at: new Date().toISOString(), push_delivery_status: 'no_recipients' })
      .eq('notification_id', notificationId);
    return new Response(JSON.stringify({ status: 'no_recipients' }), { status: 200 });
  }

  const copy = GENERIC_COPY[notification.notification_type];
  const title = copy ? copy.title : notification.title;
  const messageBody = copy ? copy.body : notification.message ?? notification.title;

  const messages = tokenRows.map((t) => ({
    to: t.expo_push_token,
    title,
    body: messageBody,
    sound: 'default',
    priority: 'high',
    data: {
      notification_id: notification.notification_id,
      notification_type: notification.notification_type,
      case_id: notification.case_id,
      sos_id: notification.sos_id,
    },
  }));

  let deliveryStatus = 'sent';
  try {
    const expoRes = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const expoJson = await expoRes.json().catch(() => null);
    const tickets: Array<{ status: string; details?: { error?: string } }> = expoJson?.data ?? [];

    // Invalid/expired/revoked tokens are reported per-message, in the
    // same order the messages array was sent — deactivate exactly
    // those rows so future dispatches to this profile stop retrying a
    // device that will never receive them again, without touching the
    // user's other, still-valid devices.
    const deactivations: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        deactivations.push(tokenRows[i].token_id);
      }
    });
    if (deactivations.length > 0) {
      await db.from('push_tokens').update({ is_active: false }).in('token_id', deactivations);
    }

    if (!expoRes.ok) {
      deliveryStatus = 'error';
    }
  } catch (e) {
    console.error('[send-push-notification] Expo push API request failed:', e);
    deliveryStatus = 'error';
  }

  await db
    .from('notifications')
    .update({ push_dispatched_at: new Date().toISOString(), push_delivery_status: deliveryStatus })
    .eq('notification_id', notificationId);

  return new Response(JSON.stringify({ status: deliveryStatus }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

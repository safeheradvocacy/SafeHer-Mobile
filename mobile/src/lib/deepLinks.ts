import * as Linking from 'expo-linking';
import { supabase } from './supabase';

/** Path used for both the email-verification and password-reset redirect
 * — Supabase doesn't need distinct paths, since the `code` it appends
 * carries its own context (exchangeCodeForSession's `redirectType` tells
 * us whether it was a recovery link or not). One path keeps the
 * Supabase Dashboard's redirect-URL allow-list to a single entry. */
const AUTH_CALLBACK_PATH = 'auth-callback';

export function buildAuthRedirectUrl(): string {
  return Linking.createURL(AUTH_CALLBACK_PATH);
}

export type AuthDeepLinkResult =
  | { handled: false }
  | { handled: true; kind: 'recovery' }
  | { handled: true; kind: 'signed-in' }
  | { handled: true; kind: 'error'; message: string };

/** Friendly copy for the PKCE exchange failure modes actually documented
 * by Supabase — never surfaces the raw error to the user. */
function friendlyExchangeError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('expired')) {
    return 'This link has expired. Please request a new one.';
  }
  if (msg.includes('invalid') || msg.includes('not found') || msg.includes('used')) {
    return 'This link is invalid or has already been used. Please request a new one.';
  }
  return "We couldn't verify that link. Please request a new one.";
}

/**
 * Parses an incoming safeher:// URL and, if it's a Supabase auth
 * callback (has a `code` query param), exchanges it for a session.
 * Returns `{ handled: false }` for any URL that isn't ours to handle, so
 * callers can safely pass every incoming URL through this without first
 * checking the path themselves.
 */
export async function handleAuthDeepLink(url: string): Promise<AuthDeepLinkResult> {
  const parsed = Linking.parse(url);
  const code = parsed.queryParams?.code;
  if (!code || typeof code !== 'string') {
    return { handled: false };
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[deepLinks] exchangeCodeForSession failed:', error.status, error.message);
    return { handled: true, kind: 'error', message: friendlyExchangeError(error.message) };
  }

  // `_exchangeCodeForSession` always fires a plain 'SIGNED_IN' auth-state
  // event regardless of whether this was a recovery link — `redirectType`
  // on the response itself is the only place that distinction survives,
  // so callers (RootNavigator) need this returned explicitly rather than
  // trying to infer it from the auth-state-change event. `@supabase/
  // auth-js`'s shipped type for AuthTokenResponse doesn't declare this
  // field even though the runtime object has it (verified directly
  // against the installed package's implementation) — the cast below
  // reflects the real return value, not a workaround for one.
  const redirectType = (data as { redirectType?: string | null }).redirectType;
  if (redirectType === 'recovery') {
    return { handled: true, kind: 'recovery' };
  }
  return { handled: true, kind: 'signed-in' };
}

/**
 * Parses a `safeher://case-access/<token>` link (module14 — QR/case
 * access workflow). Returns the raw token, or null if this URL isn't
 * one of ours. Deliberately tolerant of exactly how expo-linking splits
 * the URL into hostname/path across platforms — it just looks for the
 * literal `case-access` segment among the URL's parts and returns
 * whatever immediately follows it, rather than assuming one fixed shape.
 *
 * The token itself is opaque here — no validation of its format is
 * attempted client-side; redeem_case_access_token (the server RPC) is
 * the only thing that ever decides whether it's real.
 */
export function parseCaseAccessDeepLink(url: string): string | null {
  const parsed = Linking.parse(url);
  const segments = [parsed.hostname, ...(parsed.path ?? '').split('/')].filter((s): s is string => !!s);
  const idx = segments.indexOf('case-access');
  if (idx === -1 || !segments[idx + 1]) return null;
  return segments[idx + 1];
}

import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from './supabase';

export type AuthLinkResult = 'recovery' | 'signed_in' | null;

/**
 * Applies an incoming Supabase auth redirect URL to the client.
 *
 * Supabase's password-recovery (and magic-link) emails redirect back into
 * the app with either `access_token`/`refresh_token` (implicit flow) or a
 * `code` (PKCE flow) attached — sometimes after a `#`, sometimes after a
 * `?`. expo-auth-session's QueryParams helper is what Supabase's own React
 * Native docs use to parse both forms reliably; a hand-rolled parser is a
 * common source of "it works on my device but not my teammate's" bugs here.
 *
 * Returns 'recovery' for a password-reset link, 'signed_in' for any other
 * auth redirect, or null if the URL isn't a Supabase auth redirect at all.
 */
export const handleAuthRedirect = async (url: string | null): Promise<AuthLinkResult> => {
  if (!url) return null;

  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token, code, type } = params as Record<
    string,
    string | undefined
  >;

  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return type === 'recovery' ? 'recovery' : 'signed_in';
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return type === 'recovery' ? 'recovery' : 'signed_in';
  }

  return null;
};

/**
 * Wires up both the cold-start case (app opened directly via the emailed
 * link) and the warm case (app already running in the background), and
 * forwards the outcome to the given callbacks. Returns an unsubscribe
 * function for cleanup.
 */
export const subscribeToAuthRedirects = (
  onResult: (result: AuthLinkResult) => void,
  onError: (error: unknown) => void
) => {
  const process = (url: string | null) => {
    handleAuthRedirect(url).then(onResult).catch(onError);
  };

  Linking.getInitialURL().then(process);
  const subscription = Linking.addEventListener('url', ({ url }) => process(url));

  return () => subscription.remove();
};

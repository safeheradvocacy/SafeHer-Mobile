import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  LoginPayload,
  Municipality,
  ServiceResult,
  SignUpPayload,
  UserProfile,
} from '../types/auth.types';

const REMEMBERED_EMAIL_KEY = '@safeher/remembered_email';
// Deep link the Supabase "reset password" email points back into the app.
// Must match the scheme registered in app.json / app.config.ts.
const PASSWORD_RESET_REDIRECT_URL = 'safeher://reset-password';

function toMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: string }).message) || fallback;
  }
  return fallback;
}

/**
 * Creates the auth.users row and passes profile fields as user metadata.
 * A Postgres trigger (`on_auth_user_created`, see README) reads that
 * metadata and inserts the matching user_profiles row server-side —
 * this avoids a client-side insert racing against RLS before the
 * session/JWT exists (relevant when "Confirm email" is enabled).
 */
export async function signUp(payload: SignUpPayload): Promise<ServiceResult<{ requiresEmailConfirmation: boolean }>> {
  const { data, error } = await supabase.auth.signUp({
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    options: {
      data: {
        first_name: payload.firstName.trim(),
        last_name: payload.lastName.trim(),
        phone_number: payload.phoneNumber.trim(),
        municipality_id: payload.municipalityId,
      },
    },
  });

  if (error) {
    return { data: null, error: toMessage(error, 'Unable to create your account. Please try again.') };
  }

  return {
    data: { requiresEmailConfirmation: !data.session },
    error: null,
  };
}

export async function signIn(payload: LoginPayload): Promise<ServiceResult<Session>> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
  });

  if (error) {
    return { data: null, error: toMessage(error, 'Incorrect email or password.') };
  }

  if (payload.rememberMe) {
    await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, payload.email.trim().toLowerCase());
  } else {
    await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
  }

  return { data: data.session, error: null };
}

export async function signOut(): Promise<ServiceResult<null>> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { data: null, error: toMessage(error, 'Unable to sign out.') };
  }
  return { data: null, error: null };
}

export async function sendPasswordResetEmail(email: string): Promise<ServiceResult<null>> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: PASSWORD_RESET_REDIRECT_URL,
  });

  if (error) {
    return { data: null, error: toMessage(error, 'Unable to send reset instructions.') };
  }
  return { data: null, error: null };
}

/**
 * Call after the user lands on ResetPasswordScreen via the recovery deep
 * link — by that point supabase-js has already exchanged the link for a
 * temporary recovery session, so this just sets the new password on it.
 */
export async function updatePassword(newPassword: string): Promise<ServiceResult<null>> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { data: null, error: toMessage(error, 'Unable to reset your password.') };
  }
  return { data: null, error: null };
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return data.subscription;
}

export async function fetchProfile(authUserId: string): Promise<ServiceResult<UserProfile>> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single();

  if (error) {
    return { data: null, error: toMessage(error, 'Unable to load your profile.') };
  }
  return { data: data as UserProfile, error: null };
}

export async function getMunicipalities(): Promise<ServiceResult<Municipality[]>> {
  const { data, error } = await supabase
    .from('municipalities')
    .select('*')
    .eq('is_active', true)
    .order('municipality_name', { ascending: true });

  if (error) {
    return { data: null, error: toMessage(error, 'Unable to load municipalities.') };
  }
  return { data: (data ?? []) as Municipality[], error: null };
}

export async function getRememberedEmail(): Promise<string | null> {
  return AsyncStorage.getItem(REMEMBERED_EMAIL_KEY);
}

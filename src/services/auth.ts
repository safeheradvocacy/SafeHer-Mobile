import { supabase } from './supabase';
import * as Linking from 'expo-linking';

// Built once so the deep-link handler (see authDeepLink.ts) and the reset
// email use the exact same redirect target. Linking.createURL() resolves to
// the right scheme automatically in Expo Go, dev builds, and production —
// a hardcoded 'safeher://reset-password' string only works in a standalone
// build.
export const PASSWORD_RESET_REDIRECT_URL = Linking.createURL('reset-password');

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const signUp = async (
  email: string,
  password: string,
  userData: Record<string, unknown>
) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: userData, // stored in auth.users.raw_user_meta_data
    },
  });
  if (error) throw error;
  // The caller creates the matching user_profiles row — see RegisterScreen,
  // which has the extra fields (municipality, name, phone) that row needs.
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const resetPassword = async (email: string) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: PASSWORD_RESET_REDIRECT_URL,
  });
  if (error) throw error;
};

export const updatePassword = async (newPassword: string) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
};

export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
};

export const getSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
};

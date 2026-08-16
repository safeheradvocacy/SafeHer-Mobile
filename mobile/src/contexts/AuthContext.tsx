import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Survivor, UserProfile } from '../types/database.types';

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  survivor: Survivor | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    municipalityId: string;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Postgres/PostgREST errors (missing grants, RLS denials, constraint
// violations) are not written for end users — log the real message for
// debugging and show something actionable instead.
const GENERIC_ACCOUNT_ERROR =
  'Unable to create your account. Please try again or contact SafeHer support.';

function friendlyDatabaseError(context: string, message: string): string {
  console.error(`[AuthContext] ${context}:`, message);
  return GENERIC_ACCOUNT_ERROR;
}

// Supabase Auth returns machine-oriented text for supabase.auth.signUp()
// errors (e.g. "email rate limit exceeded") — never shown to the user
// as-is. Branch on the actual message/status so each known case gets an
// actionable message, and log the raw detail for debugging either way.
function friendlyAuthError(context: string, err: { message: string; status?: number }): string {
  console.error(`[AuthContext] ${context}:`, err.status, err.message);
  const msg = err.message.toLowerCase();

  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'An account with this email already exists. Please log in instead.';
  }
  if (msg.includes('rate limit') || err.status === 429) {
    return 'Too many registration attempts. Please wait a few minutes before trying again. If you already received a confirmation email, check your inbox before trying again.';
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('password')) {
    return 'Your password does not meet the required security requirements.';
  }
  return GENERIC_ACCOUNT_ERROR;
}

const NETWORK_ERROR = 'Unable to connect to SafeHer. Please check your internet connection and try again.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [survivor, setSurvivor] = useState<Survivor | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data: profileRow, error: profileErr } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('auth_user_id', userId)
      .single();

    if (profileErr) {
      console.warn('Failed to load user_profiles row', profileErr.message);
      setProfile(null);
      setSurvivor(null);
      return;
    }
    setProfile(profileRow);

    if (profileRow.role === 'survivor') {
      const { data: survivorRow } = await supabase
        .from('survivors')
        .select('*')
        .eq('profile_id', profileRow.profile_id)
        .single();
      setSurvivor(survivorRow ?? null);
    } else {
      setSurvivor(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
        setSurvivor(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthContextValue['signUp'] = async ({
    email,
    password,
    firstName,
    lastName,
    phoneNumber,
    municipalityId,
  }) => {
    // This function makes exactly one supabase.auth.signUp() call per
    // invocation — RegisterScreen calls it exactly once per button press
    // (the button disables via `loading` for the duration) — so retries,
    // double-submits, or extra confirmation emails are not generated here.
    // A thrown exception below (as opposed to a returned `{ error }`) means
    // the request never reached Supabase at all — genuine network failure.
    try {
      // user_profiles (1:1 with auth.users) is created server-side by the
      // on_auth_user_created trigger (supabase/module1_auth.sql), which
      // reads this signup metadata from auth.users.raw_user_meta_data.
      // RLS intentionally has no client INSERT policy for user_profiles —
      // rows are only ever created by that trigger — so we never insert
      // into it directly here.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber,
            municipality_id: municipalityId,
          },
        },
      });
      if (error) {
        return { error: friendlyAuthError('signUp', error) };
      }
      if (!data.user) {
        return { error: GENERIC_ACCOUNT_ERROR };
      }
      // Supabase signs up an already-registered, confirmed email without an
      // explicit error (to avoid leaking which emails exist) — it returns a
      // user object with an empty `identities` array instead. Treat that as
      // "already registered" rather than plowing ahead with a profile lookup
      // that has no session to run under.
      if (data.user.identities && data.user.identities.length === 0) {
        return { error: 'An account with this email already exists. Please log in instead.' };
      }

      const { data: profileRow, error: profileErr } = await supabase
        .from('user_profiles')
        .select('profile_id')
        .eq('auth_user_id', data.user.id)
        .single();

      if (profileErr || !profileRow) {
        return {
          error: friendlyDatabaseError(
            'signUp: failed to read back user_profiles row created by trigger',
            profileErr?.message ?? 'no row returned'
          ),
        };
      }

      // survivors (1:1 with user_profiles) has no auto-creation trigger,
      // so it's the one row this app still inserts directly.
      const { error: survivorErr } = await supabase.from('survivors').insert({
        profile_id: profileRow.profile_id,
        municipality_id: municipalityId,
      });

      if (survivorErr) {
        return { error: friendlyDatabaseError('signUp: failed to insert survivors row', survivorErr.message) };
      }

      return { error: null };
    } catch (e) {
      console.error('[AuthContext] signUp: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSurvivor(null);
  };

  const requestPasswordReset: AuthContextValue['requestPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  };

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider
      value={{ session, profile, survivor, loading, signIn, signUp, signOut, requestPasswordReset, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

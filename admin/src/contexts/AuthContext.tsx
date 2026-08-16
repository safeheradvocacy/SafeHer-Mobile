import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Municipality, UserProfile } from '../types/database.types';

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  municipality: Municipality | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ADMIN_ROLES = ['municipal_admin', 'provincial_admin', 'super_admin'] as const;

// Supabase Auth returns machine-oriented error text — never shown to an
// administrator as-is. Branch on the actual message/status so each known
// case gets an actionable message, and always log the raw detail for
// debugging regardless.
function friendlyAuthError(context: string, err: { message: string; status?: number }): string {
  console.error(`[AuthContext] ${context}:`, err.status, err.message);
  const msg = err.message.toLowerCase();

  if (msg.includes('invalid login credentials')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (msg.includes('rate limit') || err.status === 429) {
    return 'Too many attempts. Please wait a few minutes before trying again.';
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('password')) {
    return 'Your password does not meet the required security requirements.';
  }
  return 'Unable to sign in right now. Please try again or contact your SafeHer system administrator.';
}

const NETWORK_ERROR = 'Unable to connect to SafeHer. Please check your internet connection and try again.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data: profileRow, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('auth_user_id', userId)
      .single();

    if (error || !profileRow) {
      setProfile(null);
      setMunicipality(null);
      return;
    }

    if (!ADMIN_ROLES.includes(profileRow.role as (typeof ADMIN_ROLES)[number])) {
      // A survivor account trying to reach the admin dashboard — sign them
      // out of this session rather than exposing any admin UI.
      await supabase.auth.signOut();
      setProfile(null);
      setMunicipality(null);
      return;
    }

    setProfile(profileRow);

    if (profileRow.municipality_id) {
      const { data: muni } = await supabase
        .from('municipalities')
        .select('*')
        .eq('municipality_id', profileRow.municipality_id)
        .single();
      setMunicipality(muni ?? null);
    } else {
      setMunicipality(null);
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
        setMunicipality(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: friendlyAuthError('signIn', error) };
      return { error: null };
    } catch (e) {
      console.error('[AuthContext] signIn: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setMunicipality(null);
  };

  const requestPasswordReset: AuthContextValue['requestPasswordReset'] = async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/reset-password`,
      });
      // Never confirm/deny whether an email exists via this response — the
      // caller shows the same "check your inbox" message either way. Only
      // a genuine failure to reach Supabase gets surfaced.
      if (error) return { error: friendlyAuthError('requestPasswordReset', error) };
      return { error: null };
    } catch (e) {
      console.error('[AuthContext] requestPasswordReset: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const updatePassword: AuthContextValue['updatePassword'] = async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { error: friendlyAuthError('updatePassword', error) };
      return { error: null };
    } catch (e) {
      console.error('[AuthContext] updatePassword: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        municipality,
        loading,
        signIn,
        signOut,
        requestPasswordReset,
        updatePassword,
        refreshProfile,
      }}
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

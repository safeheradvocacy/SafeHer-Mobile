import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Barangay, Municipality, Shelter, UserProfile } from '../types/database.types';

/** One shared source of truth for "which of the three admin tiers is this
 * profile" — replaces the `profile?.role === 'provincial_admin' ||
 * profile?.role === 'super_admin'` ternary that used to be duplicated
 * across ~8 files. Every admin screen should read this instead of
 * re-deriving its own role check.
 *
 * shelter_admin, shelter_staff, support_expert, and law_enforcement
 * deliberately have NO RoleTier — none is a rung on the province ->
 * municipality -> barangay geographic ladder. shelter_admin/shelter_staff
 * are an orthogonal "which shelter" axis; support_expert and
 * law_enforcement carry no jurisdiction at all (support_expert is
 * assigned per-conversation, law_enforcement per-referral). roleTier
 * stays null for all four; check `profile?.role === '...'` directly
 * instead.
 *
 * provincial_staff (RBAC split, module11) shares roleTier === 'province'
 * with provincial_admin/super_admin — it's province-wide operationally,
 * same geographic scope. Where a screen must distinguish "technical
 * admin" (provincial_admin/super_admin) from "operational staff"
 * (provincial_staff) despite the shared tier, check `profile?.role`
 * directly (see DashboardRouter.tsx and admin/src/lib/permissions.ts). */
export type RoleTier = 'province' | 'municipality' | 'barangay';

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  municipality: Municipality | null;
  barangay: Barangay | null;
  shelter: Shelter | null;
  roleTier: RoleTier | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ADMIN_ROLES = ['municipal_admin', 'provincial_admin', 'super_admin', 'barangay_admin', 'shelter_admin', 'shelter_staff', 'support_expert', 'law_enforcement', 'provincial_staff'] as const;

function roleTierFor(role: UserProfile['role']): RoleTier | null {
  if (role === 'provincial_admin' || role === 'super_admin' || role === 'provincial_staff') return 'province';
  if (role === 'municipal_admin') return 'municipality';
  if (role === 'barangay_admin') return 'barangay';
  return null;
}

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
  return 'Unable to sign in right now. Please try again or contact your SafeSpace system administrator.';
}

const NETWORK_ERROR = 'Unable to connect to SafeSpace. Please check your internet connection and try again.';

// Backs the "sessions may time out after a period of inactivity" line
// already shown in the login screen's security notice — this is what
// actually enforces it. 30 minutes is the recommended default; the
// Settings page's "Automatic Session Timeout" control lets an admin pick
// 15/30/60/240 minutes instead, persisted here so it applies immediately
// without a page reload.
export const SESSION_TIMEOUT_STORAGE_KEY = 'safeher_admin_session_timeout_minutes';
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
const IDLE_ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export function readSessionTimeoutMinutes(): number {
  try {
    const raw = Number(localStorage.getItem(SESSION_TIMEOUT_STORAGE_KEY));
    if ([15, 30, 60, 240].includes(raw)) return raw;
  } catch {
    // ignore — falls through to default
  }
  return DEFAULT_SESSION_TIMEOUT_MINUTES;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [barangay, setBarangay] = useState<Barangay | null>(null);
  const [shelter, setShelter] = useState<Shelter | null>(null);
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
      setBarangay(null);
      setShelter(null);
      return;
    }

    if (!ADMIN_ROLES.includes(profileRow.role as (typeof ADMIN_ROLES)[number])) {
      // A survivor account trying to reach the admin dashboard — sign them
      // out of this session rather than exposing any admin UI.
      await supabase.auth.signOut();
      setProfile(null);
      setMunicipality(null);
      setBarangay(null);
      setShelter(null);
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

    if (profileRow.barangay_id) {
      const { data: brgy } = await supabase
        .from('barangays')
        .select('*')
        .eq('barangay_id', profileRow.barangay_id)
        .single();
      setBarangay(brgy ?? null);
    } else {
      setBarangay(null);
    }

    if (profileRow.shelter_id) {
      const { data: shel } = await supabase
        .from('shelters')
        .select('*')
        .eq('shelter_id', profileRow.shelter_id)
        .single();
      setShelter(shel ?? null);
    } else {
      setShelter(null);
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
        setBarangay(null);
        setShelter(null);
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setMunicipality(null);
    setBarangay(null);
    setShelter(null);
  }, []);

  // Auto sign-out after the configured idle period of no
  // mouse/keyboard/touch/scroll activity, only while a session actually
  // exists. ProtectedRoute already redirects to /admin/login the moment
  // `session` goes null, so calling the existing signOut() here is all
  // that's needed — no routing change.
  useEffect(() => {
    if (!session) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        signOut();
      }, readSessionTimeoutMinutes() * 60 * 1000);
    };
    IDLE_ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    // The Settings page dispatches this after saving a new timeout value,
    // so the currently-running timer picks up the change immediately
    // instead of waiting for the next mouse/keyboard activity.
    window.addEventListener('safeher:session-timeout-changed', resetIdleTimer);
    resetIdleTimer();
    return () => {
      clearTimeout(timeoutId);
      IDLE_ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
      window.removeEventListener('safeher:session-timeout-changed', resetIdleTimer);
    };
  }, [session, signOut]);

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
        barangay,
        shelter,
        roleTier: profile ? roleTierFor(profile.role) : null,
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

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/** How long a protected-access grant lasts once issued — must match the
 * server-side interval in verify_security_passcode()
 * (module33_security_passcode.sql). Used here ONLY for local UX (a
 * countdown, and proactively showing the lock screen again before the
 * server would reject anyway) — the actual expiry enforcement is the
 * server's own now()-based check in has_active_protected_access(), re-run
 * fresh on every protected read. If this constant and the server's
 * interval ever drift apart, the worst case is a slightly-early or
 * slightly-late local prompt, never a false "still unlocked" — a locked-
 * out server read always wins over this client's own belief. */
const GRANT_DURATION_MS = 5 * 60 * 1000;

export type VerifyOutcome =
  | { success: true }
  | { success: false; locked: boolean; retryAfterSeconds: number | null; error: string };

interface PasscodeContextValue {
  /** null while the initial check is in flight (right after sign-in) --
   * callers that need a definite answer should treat null as "not yet
   * known", not as false. */
  enrolled: boolean | null;
  /** Set when the most recent enrollment check itself failed (network/
   * backend error -- NOT "not enrolled", a genuinely different state).
   * Distinguishing this from `enrolled === null` is what lets
   * AppNavigator show a real retry screen instead of an indefinite splash
   * when the check can't complete -- see its own comment for why this
   * matters (this is exactly the "endless loading state" failure mode
   * the governing diagnosis spec called out by name). Cleared on the next
   * successful check. */
  enrollmentCheckError: string | null;
  /** Client-tracked belief about whether a protected-access grant is
   * currently active -- a UX convenience for deciding whether to show the
   * Verify Passcode screen BEFORE attempting a fetch. Never the actual
   * authorization boundary -- see the module header. */
  hasActiveGrant: boolean;
  checkingEnrollment: boolean;
  refreshEnrollmentStatus: () => Promise<void>;
  /** Re-checks the real, server-side grant state (has_active_protected_access())
   * -- used after returning to a protected screen from the background, or
   * whenever the client's own optimistic belief should be reconciled
   * against the trusted source. */
  refreshGrantStatus: () => Promise<boolean>;
  enroll: (passcode: string) => Promise<{ error: string | null }>;
  verify: (passcode: string) => Promise<VerifyOutcome>;
  changePasscode: (newPasscode: string) => Promise<{ error: string | null }>;
  forgotPasscode: (newPasscode: string, accountPassword: string) => Promise<{ error: string | null }>;
  /** Revokes the current grant immediately (server-side) and clears local
   * state -- called on background, logout, inactivity timeout, and after
   * a successful change/reset (which also revokes server-side on its
   * own, but this keeps client state in sync without waiting for a
   * refresh). */
  lock: () => Promise<void>;
}

const PasscodeContext = createContext<PasscodeContextValue | undefined>(undefined);

export function PasscodeProvider({ children }: { children: React.ReactNode }) {
  const { session, profile } = useAuth();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [enrollmentCheckError, setEnrollmentCheckError] = useState<string | null>(null);
  const [checkingEnrollment, setCheckingEnrollment] = useState(false);
  const [hasActiveGrant, setHasActiveGrant] = useState(false);
  const grantExpiresAtRef = useRef<number | null>(null);
  const appState = useRef(AppState.currentState);

  const refreshEnrollmentStatus = useCallback(async () => {
    if (!profile) {
      setEnrolled(null);
      return;
    }
    setCheckingEnrollment(true);
    try {
      const { data, error } = await supabase.rpc('has_security_passcode');
      if (error) {
        console.error('[PasscodeContext] has_security_passcode:', error.code, error.message);
        // Deliberately does NOT fall back to "enrolled" on error -- a
        // temporary backend/network failure must never falsely grant
        // access to reporting/case-viewing (governing spec: "Do not mark
        // passcode setup complete if the server cannot confirm
        // enrollment"). Leaving `enrolled` at its previous value (or
        // null) means the gated screens keep requiring enrollment until
        // a real answer comes back. Setting enrollmentCheckError
        // separately is what lets AppNavigator show a real retry UI
        // instead of an indefinite splash when `enrolled` is still null
        // AND the check has genuinely failed, not just "still in flight".
        setEnrollmentCheckError(
          error.code === '42501' || error.code === 'PGRST202'
            ? 'SafeSpace could not confirm your account setup. Please try again in a moment.'
            : 'Unable to connect to SafeSpace. Please check your connection and try again.'
        );
        return;
      }
      setEnrollmentCheckError(null);
      const isEnrolled = Boolean(data);
      setEnrolled(isEnrolled);
      if (!isEnrolled) {
        // Phase 9 — idempotent on the server (see ensure_passcode_reminder),
        // so this is safe to call on every check without separately
        // tracking "have I already reminded this session" on the client.
        const { error: reminderError } = await supabase.rpc('ensure_passcode_reminder');
        if (reminderError) console.error('[PasscodeContext] ensure_passcode_reminder:', reminderError.message);
      }
    } finally {
      setCheckingEnrollment(false);
    }
  }, [profile]);

  const refreshGrantStatus = useCallback(async (): Promise<boolean> => {
    if (!profile) {
      setHasActiveGrant(false);
      return false;
    }
    const { data, error } = await supabase.rpc('has_active_protected_access');
    if (error) {
      console.error('[PasscodeContext] has_active_protected_access:', error.message);
      // Same reasoning as above -- never optimistically assume unlocked
      // on a backend error.
      setHasActiveGrant(false);
      grantExpiresAtRef.current = null;
      return false;
    }
    const active = Boolean(data);
    setHasActiveGrant(active);
    if (!active) grantExpiresAtRef.current = null;
    return active;
  }, [profile]);

  // Re-check enrollment the moment a profile becomes available (sign-in,
  // or app relaunch with a persisted session) -- covers both brand-new
  // accounts right after OTP verification and existing accounts that have
  // never enrolled, per the governing spec treating both the same way.
  useEffect(() => {
    if (profile) {
      refreshEnrollmentStatus();
      refreshGrantStatus();
    } else {
      setEnrolled(null);
      setEnrollmentCheckError(null);
      setHasActiveGrant(false);
      grantExpiresAtRef.current = null;
    }
  }, [profile?.profile_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = useCallback(async () => {
    setHasActiveGrant(false);
    grantExpiresAtRef.current = null;
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (!session) return;
    const { error } = await supabase.rpc('revoke_protected_access');
    if (error) console.error('[PasscodeContext] revoke_protected_access:', error.message);
  }, [session]);

  // Re-lock on background, mirroring AppLockGate's exact pattern -- a
  // SEPARATE mechanism from App Lock (that one gates the whole app with
  // biometrics; this one gates case/report content specifically with the
  // passcode-derived grant), but the same "foreground->background edge
  // triggers a lock" idiom, applied here to the server-side grant instead
  // of a local boolean.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/active/) && next.match(/inactive|background/)) {
        lock();
      }
      appState.current = next;
    });
    return () => subscription.remove();
  }, [lock]);

  // Clear everything on sign-out -- a new sign-in (same device, same or
  // different account) must never inherit a stale "unlocked" belief.
  useEffect(() => {
    if (!session) {
      setEnrolled(null);
      setEnrollmentCheckError(null);
      setHasActiveGrant(false);
      grantExpiresAtRef.current = null;
    }
  }, [session]);

  const enroll: PasscodeContextValue['enroll'] = async (passcode) => {
    const { data, error } = await supabase.functions.invoke('security-passcode', {
      body: { action: 'enroll', newPasscode: passcode },
    });
    if (error) {
      const message = await extractFunctionErrorMessage(error);
      return { error: message };
    }
    if (!data?.success) {
      return { error: data?.error ?? "We couldn't set up your passcode. Please try again." };
    }
    await refreshEnrollmentStatus();
    return { error: null };
  };

  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    // Belt-and-suspenders alongside the server-side expiry check that
    // actually gates every protected read (has_active_protected_access) —
    // this is what satisfies "require re-verification after protected
    // access expires" even for a screen a user leaves open, focused, and
    // untouched for the whole window, where no background/foreground edge
    // or screen-focus event would otherwise re-run the server check.
    expiryTimerRef.current = setTimeout(() => {
      setHasActiveGrant(false);
      grantExpiresAtRef.current = null;
    }, GRANT_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, []);

  const verify: PasscodeContextValue['verify'] = async (passcode) => {
    const { data, error } = await supabase.functions.invoke('security-passcode', {
      body: { action: 'verify', passcode },
    });
    if (error) {
      const message = await extractFunctionErrorMessage(error);
      return { success: false, locked: false, retryAfterSeconds: null, error: message };
    }
    if (data?.success) {
      setHasActiveGrant(true);
      grantExpiresAtRef.current = Date.now() + GRANT_DURATION_MS;
      armExpiryTimer();
      return { success: true };
    }
    return {
      success: false,
      locked: Boolean(data?.locked),
      retryAfterSeconds: data?.retryAfterSeconds ?? null,
      error: data?.error ?? 'Incorrect passcode. Please try again.',
    };
  };

  const changePasscode: PasscodeContextValue['changePasscode'] = async (newPasscode) => {
    const { data, error } = await supabase.functions.invoke('security-passcode', {
      body: { action: 'change', newPasscode },
    });
    if (error) {
      const message = await extractFunctionErrorMessage(error);
      return { error: message };
    }
    if (!data?.success) {
      return { error: data?.error ?? "We couldn't change your passcode. Please try again." };
    }
    // A change revokes grants server-side (see reset_security_passcode) --
    // reflect that locally too rather than waiting for the next check.
    setHasActiveGrant(false);
    grantExpiresAtRef.current = null;
    return { error: null };
  };

  const forgotPasscode: PasscodeContextValue['forgotPasscode'] = async (newPasscode, accountPassword) => {
    const { data, error } = await supabase.functions.invoke('security-passcode', {
      body: { action: 'forgot', newPasscode, password: accountPassword },
    });
    if (error) {
      const message = await extractFunctionErrorMessage(error);
      return { error: message };
    }
    if (!data?.success) {
      return { error: data?.error ?? "We couldn't reset your passcode. Please try again." };
    }
    setHasActiveGrant(false);
    grantExpiresAtRef.current = null;
    await refreshEnrollmentStatus();
    return { error: null };
  };

  return (
    <PasscodeContext.Provider
      value={{
        enrolled,
        enrollmentCheckError,
        hasActiveGrant,
        checkingEnrollment,
        refreshEnrollmentStatus,
        refreshGrantStatus,
        enroll,
        verify,
        changePasscode,
        forgotPasscode,
        lock,
      }}
    >
      {children}
    </PasscodeContext.Provider>
  );
}

// supabase.functions.invoke() only ever resolves { data: null, error } for
// a non-2xx response -- same FunctionsHttpError shape useSupportChat.ts
// already works around. The security-passcode function always returns a
// JSON { error } body even on failure (see its own error-JSON convention),
// so this recovers that real message instead of a generic one. Safe to
// surface directly here (unlike raw Postgres errors) -- every message the
// function returns was already written to be user-facing.
async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const maybeHttpError = error as { context?: Response; message?: string };
  if (maybeHttpError?.context && typeof maybeHttpError.context.json === 'function') {
    try {
      const body = await maybeHttpError.context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // fall through to generic message below
    }
  }
  console.error('[PasscodeContext] function invoke failed:', maybeHttpError?.message ?? error);
  return 'Unable to connect to SafeSpace. Please check your connection and try again.';
}

export function usePasscode() {
  const ctx = useContext(PasscodeContext);
  if (!ctx) throw new Error('usePasscode must be used within a PasscodeProvider');
  return ctx;
}

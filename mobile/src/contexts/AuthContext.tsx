import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { buildAuthRedirectUrl, handleAuthDeepLink, parseCaseAccessDeepLink } from '../lib/deepLinks';
import { deactivatePushTokenForThisDevice } from '../lib/pushNotifications';
import type { Survivor, UserProfile } from '../types/database.types';

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  survivor: Survivor | null;
  loading: boolean;
  /** True from the moment a password-recovery deep link has been
   * exchanged for a session until the user finishes setting a new
   * password. RootNavigator checks this BEFORE its normal `session &&
   * profile` routing — exchanging a recovery link's code establishes a
   * real Supabase session same as a normal sign-in would, so without this
   * flag the app would drop the user straight into the authenticated app
   * with their old password still in place instead of showing Reset
   * Password. */
  pendingPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  /** Set the instant a `safeher://case-access/<token>` link is opened
   * (cold start or already-running), regardless of auth state — mirrors
   * pendingPasswordRecovery's idiom exactly. RootNavigator/AppNavigator
   * read this to resume the QR-access flow once a session exists;
   * consumed once via clearCaseAccessToken() so a stale token can never
   * silently re-trigger navigation on a later, unrelated sign-in. */
  pendingCaseAccessToken: string | null;
  clearCaseAccessToken: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null; code?: 'email_not_confirmed' }>;
  signUp: (params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    municipalityId: string;
    // Registered-address fields (module12) — all optional. Barangay/
    // street are collected as required form fields by RegisterScreen,
    // but stay optional here so this function's contract doesn't force
    // every caller to supply them. The map-pin fields (latitude/
    // longitude/formattedAddress/locationSource) are always optional —
    // the map step itself is skippable at registration.
    barangayId?: string;
    streetAddress?: string;
    purokSitio?: string;
    latitude?: number;
    longitude?: number;
    formattedAddress?: string;
    locationSource?: 'map_pin' | 'current_location' | 'manually_confirmed';
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
  /** Verifies the 8-digit code emailed after signUp() and, on success,
   * establishes a real session the same way signing in does — the caller
   * doesn't need a separate login step afterward. */
  verifyEmailOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  /** Verifies the password-recovery code sent by requestPasswordReset and,
   * on success, marks pendingPasswordRecovery so RootNavigator shows the
   * isolated recovery stack (ResetPasswordScreen) instead of treating the
   * newly-established session as a normal sign-in — see the comment on
   * pendingPasswordRecovery above for why that distinction matters. */
  verifyRecoveryOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  /** Sends a fresh 8-digit code to the signed-in user's own email —
   * the first step of the Change Password flow (confirm email control
   * before allowing a sensitive change). Reuses the exact same
   * signInWithOtp+verifyOtp primitive as signup verification rather
   * than a separate/uncertain "reauthenticate" API surface; verifying
   * the returned code is done via the existing verifyEmailOtp above. */
  sendPasswordChangeOtp: () => Promise<{ error: string | null }>;
  /** Only ever called after verifyEmailOtp has already succeeded for
   * this session — does not re-check that itself, matching how
   * ChangePasswordScreen sequences its steps. */
  updatePasswordAfterOtp: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Postgres/PostgREST errors (missing grants, RLS denials, constraint
// violations) are not written for end users — log the real message for
// debugging and show something actionable instead.
const GENERIC_ACCOUNT_ERROR =
  'Unable to create your account. Please try again or contact SafeSpace support.';

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
    return 'Too many attempts. Please wait a few minutes before trying again. If you already received an email, check your inbox before trying again.';
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('password')) {
    return 'Your password does not meet the required security requirements.';
  }
  return GENERIC_ACCOUNT_ERROR;
}

const NETWORK_ERROR = 'Unable to connect to SafeSpace. Please check your internet connection and try again.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [survivor, setSurvivor] = useState<Survivor | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPasswordRecovery, setPendingPasswordRecovery] = useState(false);
  const [pendingCaseAccessToken, setPendingCaseAccessToken] = useState<string | null>(null);
  // Guards against handling the same cold-start URL twice — both
  // getInitialURL() and the 'url' event can fire for the launch link on
  // some platforms/timings.
  const handledInitialUrl = useRef(false);

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

  // Email verification and password recovery both arrive as a
  // safeher://auth-callback?code=... link — cold start (app was closed)
  // via getInitialURL(), or already-running via the 'url' event.
  useEffect(() => {
    const processUrl = async (url: string | null) => {
      if (!url) return;
      const caseAccessToken = parseCaseAccessDeepLink(url);
      if (caseAccessToken) {
        setPendingCaseAccessToken(caseAccessToken);
        return;
      }
      const result = await handleAuthDeepLink(url);
      if (!result.handled) return;
      if (result.kind === 'recovery') {
        setPendingPasswordRecovery(true);
      } else if (result.kind === 'error') {
        Alert.alert('Link problem', result.message);
      }
      // kind === 'signed-in' (email verification) needs no extra action —
      // the onAuthStateChange listener above already picked up the new
      // session from the exchange.
    };

    if (!handledInitialUrl.current) {
      handledInitialUrl.current = true;
      Linking.getInitialURL().then(processUrl);
    }

    const subscription = Linking.addEventListener('url', (event) => processUrl(event.url));
    return () => subscription.remove();
  }, []);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return { error: null };
      console.error('[AuthContext] signIn:', error.status, (error as { code?: string }).code, error.message);
      if ((error as { code?: string }).code === 'email_not_confirmed' || error.message.toLowerCase().includes('confirm')) {
        return { error: 'Please verify your email address before continuing.', code: 'email_not_confirmed' };
      }
      if (error.message.toLowerCase().includes('invalid login credentials')) {
        return { error: 'Incorrect email or password.' };
      }
      return { error: friendlyAuthError('signIn', error) };
    } catch (e) {
      console.error('[AuthContext] signIn: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const signUp: AuthContextValue['signUp'] = async ({
    email,
    password,
    firstName,
    lastName,
    phoneNumber,
    municipalityId,
    barangayId,
    streetAddress,
    purokSitio,
    latitude,
    longitude,
    formattedAddress,
    locationSource,
  }) => {
    // This function makes exactly one supabase.auth.signUp() call per
    // invocation — RegisterScreen calls it exactly once per button press
    // (the button disables via `loading` for the duration) — so retries,
    // double-submits, or extra confirmation emails are not generated here.
    // A thrown exception below (as opposed to a returned `{ error }`) means
    // the request never reached Supabase at all — genuine network failure.
    try {
      // user_profiles AND survivors (1:1 with auth.users / user_profiles)
      // are both created server-side by the on_auth_user_created trigger
      // (supabase/module1_auth.sql), which reads this signup metadata
      // from auth.users.raw_user_meta_data. Deliberately NOT read back or
      // inserted here: with email confirmation required, signUp() returns
      // no session, so any client-side query right after this would run
      // as an anonymous request and get correctly rejected by RLS.
      //
      // No `emailRedirectTo` — verification is an 8-digit code entered in
      // the app (see EmailVerificationScreen + verifyEmailOtp below), not
      // a clickable link, so there's nothing for a redirect URL to do here.
      // (OtpInput's DEFAULT_CODE_LENGTH is 8 and neither this screen nor
      // ChangePasswordScreen overrides it — confirmed by reading both
      // call sites, not assumed; the actual Supabase project's Email OTP
      // Length setting, dashboard-only, must match this.)
      // Password recovery still uses the link-based flow and still sets
      // this option (see requestPasswordReset).
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber,
            municipality_id: municipalityId,
            barangay_id: barangayId,
            street_address: streetAddress,
            purok_sitio: purokSitio,
            latitude,
            longitude,
            formatted_address: formattedAddress,
            location_source: locationSource,
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
      // user object with an empty `identities` array instead.
      if (data.user.identities && data.user.identities.length === 0) {
        return { error: 'An account with this email already exists. Please log in instead.' };
      }

      return { error: null };
    } catch (e) {
      console.error('[AuthContext] signUp: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const signOut = async () => {
    // Must run BEFORE auth.signOut() — deleting this device's own
    // push_tokens row relies on the "Users can delete own push tokens"
    // RLS policy, which requires the still-live session's
    // current_profile_id(). Only this one device's token is removed;
    // any other device this profile is signed in on keeps its own
    // registration untouched.
    if (profile) await deactivatePushTokenForThisDevice(profile.profile_id);
    await supabase.auth.signOut();
    setProfile(null);
    setSurvivor(null);
  };

  const requestPasswordReset: AuthContextValue['requestPasswordReset'] = async (email) => {
    // Previously returned the raw Supabase error message straight to the
    // UI (a technical-error leak) and had no try/catch, so a genuine
    // network failure — this call throwing rather than resolving with an
    // `error` — would surface as an unhandled rejection instead of a
    // message the screen can show. Never branch this on "does the account
    // exist" — Supabase's own response already doesn't reveal that, and
    // neither should this wrapper.
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: buildAuthRedirectUrl() });
      if (!error) return { error: null };
      console.error('[AuthContext] requestPasswordReset:', error.status, error.message);
      if (error.message.toLowerCase().includes('rate limit') || error.status === 429) {
        return { error: 'Too many requests. Please wait a few minutes before trying again.' };
      }
      return { error: "We couldn't send the reset link. Please try again." };
    } catch (e) {
      console.error('[AuthContext] requestPasswordReset: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const resendVerificationEmail: AuthContextValue['resendVerificationEmail'] = async (email) => {
    // No `emailRedirectTo` — same reasoning as signUp() above, this
    // re-triggers the same confirm-signup template, which now renders a
    // code ({{ .Token }}) rather than a link.
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (!error) return { error: null };
      console.error('[AuthContext] resendVerificationEmail:', error.status, error.message);
      if (error.message.toLowerCase().includes('already') && error.message.toLowerCase().includes('confirm')) {
        return { error: 'This account is already verified. Please log in.' };
      }
      if (error.message.toLowerCase().includes('rate limit') || error.status === 429) {
        return { error: 'Too many requests. Please wait a bit before trying again.' };
      }
      return { error: "We couldn't resend the verification code. Please try again." };
    } catch (e) {
      console.error('[AuthContext] resendVerificationEmail: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const verifyEmailOtp: AuthContextValue['verifyEmailOtp'] = async (email, token) => {
    try {
      // Never log `token` itself — it's a live, single-use credential for
      // this account, same handling as a password.
      //
      // type: 'email' — NOT 'signup'. Supabase's own verifyOtp reference
      // example uses 'email' specifically for a code delivered via the
      // {{ .Token }} template variable (confirmed against their docs,
      // since both are valid TypeScript literals here and the wrong one
      // would still compile but fail — or behave inconsistently — at
      // runtime). 'signup' is a real EmailOtpType, just not this one;
      // it's for verifying the OLD link-based {{ .ConfirmationURL }}
      // flow this app no longer uses. resend() below stays `type:
      // 'signup'` deliberately — that's a different vocabulary (which
      // email template to re-trigger), not this one.
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      // Deliberately does NOT record Terms & Conditions acceptance here —
      // this function is also reused by the Change Password flow's OTP
      // confirmation step (see sendPasswordChangeOtp/updatePasswordAfterOtp
      // below), which has nothing to do with account registration. The
      // signup-specific caller (EmailVerificationScreen) records
      // acceptance itself, right after this call succeeds, so it only
      // ever fires on the actual first-time registration-verification
      // path.
      if (!error) return { error: null };
      console.error('[AuthContext] verifyEmailOtp:', error.status, error.message);
      const msg = error.message.toLowerCase();
      if (msg.includes('expired')) {
        return { error: 'This verification code has expired. Please request a new code.' };
      }
      if (msg.includes('already') && msg.includes('confirm')) {
        return { error: 'This account is already verified. Please log in.' };
      }
      if (msg.includes('invalid') || msg.includes('token')) {
        return { error: 'The verification code is incorrect. Please try again.' };
      }
      if (msg.includes('rate limit') || error.status === 429) {
        return { error: 'Too many attempts. Please wait a moment before trying again.' };
      }
      return { error: "We couldn't verify that code. Please try again." };
    } catch (e) {
      console.error('[AuthContext] verifyEmailOtp: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const verifyRecoveryOtp: AuthContextValue['verifyRecoveryOtp'] = async (email, token) => {
    try {
      // Never log `token` — a live, single-use credential, same handling
      // as verifyEmailOtp above.
      //
      // type: 'recovery' — NOT 'email' or 'signup'. This is a distinct
      // EmailOtpType from the one verifyEmailOtp uses: it tells Supabase
      // this code came from the "Reset Password" template (resend below
      // and requestPasswordReset trigger that template specifically), not
      // "Confirm signup". Using the wrong type here would either be
      // rejected outright or, worse, silently accepted against the wrong
      // template's token namespace — Supabase treats these as separate
      // token spaces precisely so a signup code can never double as a
      // recovery code or vice versa.
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
      if (!error) {
        // Mirrors exactly what handleAuthDeepLink's 'recovery' kind does
        // for the old link-based flow (see the useEffect above) — a
        // recovery OTP verification establishes a real session the same
        // way exchanging a recovery link's code does, so RootNavigator
        // must be told to show the isolated recovery stack instead of its
        // normal `session && profile` check, which would otherwise drop
        // the user straight into the authenticated app with their OLD
        // password still active before they've set a new one.
        setPendingPasswordRecovery(true);
        return { error: null };
      }
      console.error('[AuthContext] verifyRecoveryOtp:', error.status, error.message);
      const msg = error.message.toLowerCase();
      if (msg.includes('expired')) {
        return { error: 'This recovery code has expired. Please request a new one.' };
      }
      if (msg.includes('invalid') || msg.includes('token')) {
        return { error: 'The recovery code is incorrect. Please try again.' };
      }
      if (msg.includes('rate limit') || error.status === 429) {
        return { error: 'Too many attempts. Please wait a moment before trying again.' };
      }
      return { error: "We couldn't verify that code. Please try again." };
    } catch (e) {
      console.error('[AuthContext] verifyRecoveryOtp: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const sendPasswordChangeOtp: AuthContextValue['sendPasswordChangeOtp'] = async () => {
    const email = session?.user?.email;
    if (!email) return { error: NETWORK_ERROR };
    try {
      // shouldCreateUser:false — this is an already-registered, signed-in
      // user confirming their own email, never a path that could create
      // a new account.
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (!error) return { error: null };
      console.error('[AuthContext] sendPasswordChangeOtp:', error.status, error.message);
      if (error.message.toLowerCase().includes('rate limit') || error.status === 429) {
        return { error: 'Too many attempts. Please wait a moment before trying again.' };
      }
      return { error: "We couldn't send a verification code. Please try again." };
    } catch (e) {
      console.error('[AuthContext] sendPasswordChangeOtp: request never reached Supabase', e);
      return { error: NETWORK_ERROR };
    }
  };

  const updatePasswordAfterOtp: AuthContextValue['updatePasswordAfterOtp'] = async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (!error) return { error: null };
      console.error('[AuthContext] updatePasswordAfterOtp:', error.status, error.message);
      const msg = error.message.toLowerCase();
      if (msg.includes('session') || msg.includes('expired') || msg.includes('token')) {
        return { error: 'Your session has expired. Please log out and back in, then try again.' };
      }
      if (msg.includes('different from the old password')) {
        return { error: 'Please choose a password different from your current one.' };
      }
      if (msg.includes('password')) {
        return { error: 'Your password does not meet the required security requirements.' };
      }
      return { error: "We couldn't update your password. Please try again." };
    } catch (e) {
      console.error('[AuthContext] updatePasswordAfterOtp: request never reached Supabase', e);
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
        survivor,
        loading,
        pendingPasswordRecovery,
        clearPasswordRecovery: () => setPendingPasswordRecovery(false),
        pendingCaseAccessToken,
        clearCaseAccessToken: () => setPendingCaseAccessToken(null),
        signIn,
        signUp,
        signOut,
        requestPasswordReset,
        resendVerificationEmail,
        verifyEmailOtp,
        verifyRecoveryOtp,
        sendPasswordChangeOtp,
        updatePasswordAfterOtp,
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Input, PasswordInput, PrimaryButton, Screen, AlertMessage, PrivacyNotice, FadeInUp, useReducedMotion } from '../../components/ui';
import { AuthHeader } from '../../components/auth/AuthHeader';
import { ShakeField } from '../../components/auth/ShakeField';
import { SettingsSheet } from '../../components/SettingsSheet';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { getForgotPasswordStrings, getRecoveryCodeStrings, getResetPasswordStrings, getSettingsTitle } from './authContent';
import { spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';
import { OtpInput, maskEmail, DEFAULT_CODE_LENGTH as CODE_LENGTH } from '../../components/OtpInput';

const RESEND_COOLDOWN_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>>();
  const { requestPasswordReset } = useAuth();
  const systemReducedMotion = useReducedMotion();
  const { palette, prefs } = useTheme();
  const reduced = systemReducedMotion || prefs.reduceMotion;
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getForgotPasswordStrings(prefs.language), [prefs.language]);
  const [showSettings, setShowSettings] = useState(false);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailShake, setEmailShake] = useState(0);
  const submittingRef = useRef(false);

  const onSubmit = async () => {
    if (submittingRef.current || loading) return;
    if (!email.trim() || !EMAIL_RE.test(email)) {
      setEmailError(strings.emailInvalid);
      setEmailShake((k) => k + 1);
      return;
    }
    const trimmedEmail = email.trim();
    submittingRef.current = true;
    setLoading(true);
    setSubmitError(null);
    // Supabase's resetPasswordForEmail already responds the same way
    // whether or not the email is registered — never branch UI copy on
    // "does this account exist" here, that's exactly the enumeration leak
    // this is designed to avoid.
    const { error: reqError } = await requestPasswordReset(trimmedEmail);
    setLoading(false);
    submittingRef.current = false;
    if (reqError) {
      // AuthContext already returns a human-readable message here (rate
      // limit / generic / network) — never a raw Supabase/HTTP error — so
      // this is safe to show as-is under a neutral "something went wrong"
      // heading rather than re-wrapping it again.
      setSubmitError(reqError);
      setEmailShake((k) => k + 1);
      return;
    }
    // The whole recovery code entry (request, resend, cooldown) lives on
    // RecoveryCodeScreen now, matching how RegisterScreen hands off to
    // EmailVerificationScreen after signUp() — no separate "check your
    // email" interstitial on this screen.
    navigation.navigate('RecoveryCode', { email: trimmedEmail });
  };

  return (
    <Screen>
      <AuthHeader onBack={() => navigation.goBack()} onSettings={() => setShowSettings(true)} />

      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'center' }}>
        <ClaySurface radius={26} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.brandLogoShadow} innerStyle={styles.brandLogoInner} highlightOpacity={0.24}>
          <Ionicons name="lock-closed" size={22} color={palette.primary} />
        </ClaySurface>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={40}>
        <Text style={[styles.title, { color: palette.text, fontSize: 24 * titleFontScale }]}>{strings.title}</Text>
        <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.subtitle}</Text>
      </FadeInUp>

      <View style={{ marginTop: spacing.lg }}>
        <FadeInUp reduced={reduced} delay={100}>
          <ShakeField trigger={emailShake} reduced={reduced}>
            <Input
              label={strings.emailLabel}
              icon="mail-outline"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={onSubmit}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError(null);
                if (submitError) setSubmitError(null);
              }}
              placeholder="you@example.com"
              error={emailError ?? undefined}
              rightElement={EMAIL_RE.test(email) ? <Ionicons name="checkmark-circle" size={18} color={palette.success} /> : undefined}
            />
          </ShakeField>
        </FadeInUp>

        {submitError ? <AlertMessage variant="error" title={strings.somethingWrongTitle} message={submitError} /> : null}

        <FadeInUp reduced={reduced} delay={150}>
          <PrimaryButton title={strings.sendCode} loadingTitle={strings.sending} onPress={onSubmit} loading={loading} reduced={reduced} />
        </FadeInUp>
      </View>

      <FadeInUp reduced={reduced} delay={190} style={{ marginTop: spacing.lg }}>
        <View style={[styles.divider, { backgroundColor: palette.border }]} />
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={200} style={styles.backRow}>
        <Pressable onPress={() => navigation.navigate('Login')} hitSlop={10} style={styles.backTouch}>
          <Ionicons name="arrow-back" size={16} color={palette.primary} />
          <Text style={[styles.link, { color: palette.primary }]}>{strings.backToLogin}</Text>
        </Pressable>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={240}>
        <PrivacyNotice heading={strings.privacyHeading} text={strings.privacyBody} />
      </FadeInUp>

      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={getSettingsTitle(prefs.language)} />
    </Screen>
  );
}

const MAX_RECOVERY_ATTEMPTS = 5;

export function RecoveryCodeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'RecoveryCode'>>();
  const route = useRoute<RouteProp<AuthStackParamList, 'RecoveryCode'>>();
  const { requestPasswordReset, verifyRecoveryOtp } = useAuth();
  const reduced = useReducedMotion();
  const { palette, prefs } = useTheme();
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getRecoveryCodeStrings(prefs.language), [prefs.language]);
  const email = route.params.email;

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onVerify = async () => {
    if (verifying || code.length !== CODE_LENGTH) return;
    setVerifying(true);
    setError(null);
    // On success this also flips AuthContext's pendingPasswordRecovery to
    // true (see verifyRecoveryOtp), which swaps RootNavigator over to the
    // isolated recovery stack (ResetPasswordScreen) on its own — no
    // manual navigation call needed here, same idiom EmailVerificationScreen
    // already uses for the equivalent signup step.
    const { error: verifyError } = await verifyRecoveryOtp(email, code);
    setVerifying(false);
    if (verifyError) {
      const attempts = failedAttempts + 1;
      setFailedAttempts(attempts);
      setCode('');
      // A soft client-side backstop on top of Supabase's own server-side
      // OTP rate limiting — mirrors ChangePasswordScreen's identical
      // guard for its own OTP step.
      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        setError(strings.tooManyAttempts);
        setCooldown(0);
      } else {
        setError(verifyError);
      }
      return;
    }
    setFailedAttempts(0);
  };

  const onResend = async () => {
    if (resending || cooldown > 0) return;
    setResending(true);
    setResendMessage(null);
    // Same requestPasswordReset call ForgotPasswordScreen used to send the
    // first code — Supabase issues a fresh code each time this is called,
    // which naturally supersedes any earlier one.
    const { error: resendError } = await requestPasswordReset(email);
    setResending(false);
    if (resendError) {
      setError(resendError);
      return;
    }
    setResendMessage(strings.resendSentBody);
    setFailedAttempts(0);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <Screen>
      <AuthHeader onBack={() => navigation.goBack()} />

      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'center' }}>
        <ClaySurface radius={26} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.brandLogoShadow} innerStyle={styles.brandLogoInner} highlightOpacity={0.24}>
          <Ionicons name="key" size={22} color={palette.primary} />
        </ClaySurface>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={40}>
        <Text style={[styles.title, styles.centerText, { color: palette.text, fontSize: 22 * titleFontScale }]}>{strings.title}</Text>
        <Text style={[styles.subtitle, styles.centerText, { color: bodyColor }]}>{strings.explanation}</Text>
        <Text style={[styles.emailText, { color: palette.primary }]}>{maskEmail(email)}</Text>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={100} style={{ marginTop: spacing.xl, alignItems: 'center' }}>
        <OtpInput value={code} onChangeText={(v) => { setCode(v); if (error) setError(null); }} autoFocus />
      </FadeInUp>

      {error ? (
        <FadeInUp reduced={reduced} delay={0} style={{ marginTop: spacing.md }}>
          <AlertMessage variant="error" title={strings.errorTitle} message={error} />
        </FadeInUp>
      ) : null}

      <FadeInUp reduced={reduced} delay={140} style={{ marginTop: spacing.lg }}>
        <PrimaryButton
          title={strings.verify}
          loadingTitle={strings.verifying}
          onPress={onVerify}
          loading={verifying}
          disabled={code.length !== CODE_LENGTH}
          reduced={reduced}
        />
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={180} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
        <Text style={[styles.resendPrompt, { color: bodyColor }]}>{strings.didntReceive}</Text>
        {resendMessage ? <Text style={[styles.resendSuccess, { color: palette.success }]}>{resendMessage}</Text> : null}
        {cooldown > 0 ? (
          <Text style={[styles.cooldownText, { color: palette.textMuted }]}>{strings.resendInSeconds(cooldown)}</Text>
        ) : (
          <Pressable onPress={onResend} disabled={resending} hitSlop={8} accessibilityRole="button" style={styles.resendTouch}>
            <Text style={[styles.link, { color: palette.primary }]}>{resending ? strings.resending : strings.resendCode}</Text>
          </Pressable>
        )}
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={220} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
        <Pressable onPress={() => navigation.navigate('Login')} hitSlop={10}>
          <Text style={[styles.link, { color: bodyColor }]}>{strings.backToLogin}</Text>
        </Pressable>
      </FadeInUp>
    </Screen>
  );
}

export function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'ResetPassword'>>();
  const route = useRoute<RouteProp<AuthStackParamList, 'ResetPassword'>>();
  const { pendingPasswordRecovery, clearPasswordRecovery } = useAuth();
  const systemReducedMotion = useReducedMotion();
  const { palette, prefs } = useTheme();
  const reduced = systemReducedMotion || prefs.reduceMotion;
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getResetPasswordStrings(prefs.language), [prefs.language]);
  const [showSettings, setShowSettings] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async () => {
    if (password.length < 8) {
      setError(strings.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(strings.passwordsMismatch);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Requires an active recovery session — established either by
      // RecoveryCodeScreen's verifyRecoveryOtp() (the in-app code flow)
      // or, for an older in-flight email, by opening the legacy
      // reset-password link (see deepLinks.ts). Either path sets
      // pendingPasswordRecovery, which is what routes here in the first
      // place (see RootNavigator) — this screen itself doesn't need to
      // know or care which one got it here.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        console.error('[ResetPasswordScreen] updateUser:', updateError.status, updateError.message);
        const msg = updateError.message.toLowerCase();
        if (msg.includes('session') || msg.includes('expired') || msg.includes('token')) {
          setError('Your recovery session has expired. Please request a new code from Forgot Password.');
        } else if (msg.includes('different from the old password')) {
          setError('Please choose a password different from your current one.');
        } else if (msg.includes('password')) {
          setError('Your password does not meet the required security requirements.');
        } else {
          setError("We couldn't update your password. Please try again.");
        }
        return;
      }
      setDone(true);
    } catch (e) {
      console.error('[ResetPasswordScreen] updateUser: request never reached Supabase', e);
      setError('Unable to connect to SafeSpace. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Reached via an active recovery session (RecoveryCodeScreen's OTP
  // verification, or a legacy reset-password link): RootNavigator swaps
  // this dedicated stack out for the normal one the instant the flag
  // clears (the recovery session is now just a normal valid session, so
  // that lands the user on Home). Reached the old way (registered
  // directly in AuthNavigator, no active recovery): just go to Login.
  const continueAfterReset = () => {
    if (pendingPasswordRecovery) {
      clearPasswordRecovery();
      return;
    }
    navigation.replace('Login');
  };

  return (
    <Screen>
      <AuthHeader onSettings={() => setShowSettings(true)} />

      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'center' }}>
        <ClaySurface radius={26} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.brandLogoShadow} innerStyle={styles.brandLogoInner} highlightOpacity={0.24}>
          <Ionicons name="lock-closed" size={22} color={palette.primary} />
        </ClaySurface>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={40}>
        <Text style={[styles.title, { color: palette.text, fontSize: 24 * titleFontScale }]}>{strings.title}</Text>
        {route.params?.email ? <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.forEmail}{route.params.email}</Text> : null}
      </FadeInUp>

      {done ? (
        <FadeInUp reduced={reduced} delay={80} style={{ marginTop: spacing.lg }}>
          <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.passwordUpdated}</Text>
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton title={strings.logIn} onPress={continueAfterReset} reduced={reduced} />
          </View>
        </FadeInUp>
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          <FadeInUp reduced={reduced} delay={60}>
            <PasswordInput label={strings.newPasswordLabel} value={password} onChangeText={setPassword} showStrength />
          </FadeInUp>
          <FadeInUp reduced={reduced} delay={100}>
            <PasswordInput label={strings.confirmNewPasswordLabel} value={confirmPassword} onChangeText={setConfirmPassword} />
          </FadeInUp>
          {error ? <AlertMessage variant="error" title={strings.couldntUpdateTitle} message={error} /> : null}
          <FadeInUp reduced={reduced} delay={140}>
            <PrimaryButton title={strings.updatePassword} onPress={onSubmit} loading={loading} reduced={reduced} />
          </FadeInUp>
        </View>
      )}

      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={getSettingsTitle(prefs.language)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandLogoShadow: { width: 52, height: 52 },
  brandLogoInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  title: { ...typography.display, fontSize: 24 },
  subtitle: { ...typography.body, marginTop: spacing.xs },
  divider: { height: 1 },
  backRow: { alignItems: 'center', marginTop: spacing.lg },
  backTouch: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: spacing.sm },
  link: { ...typography.bodyMedium },
  centerText: { textAlign: 'center' },

  emailText: { ...typography.bodyMedium, textAlign: 'center', marginTop: spacing.xs },
  resendPrompt: { ...typography.body },
  resendSuccess: { ...typography.caption, marginTop: 4 },
  cooldownText: { ...typography.caption, marginTop: 4 },
  resendTouch: { paddingVertical: 6, paddingHorizontal: spacing.sm, marginTop: 2 },
});

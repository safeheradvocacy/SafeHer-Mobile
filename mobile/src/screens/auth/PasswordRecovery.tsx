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
import { getForgotPasswordStrings, getResetPasswordStrings, getSettingsTitle } from './authContent';
import { spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

const RESEND_COOLDOWN_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Envelope + a small success checkmark — the same "big clay circle +
 * small overlapping badge" pattern used elsewhere on the auth screens.
 * The badge is a checkmark rather than a lock here specifically because
 * this illustration is confirming "sent", not "secure" — the lock idea
 * is already carried by the request screen's own header icon just
 * before this state, so this one badge does double duty for "envelope +
 * lock + checkmark" as a family rather than cramming all three onto one
 * small shape. */
function ResetEmailIllustration() {
  const { palette } = useTheme();
  return (
    <View style={styles.illustrationWrap}>
      <ClaySurface
        radius={56}
        tint={palette.primaryLight}
        shadowTint={palette.primaryDark}
        intensity="md"
        style={styles.illustrationShadow}
        innerStyle={styles.illustrationInner}
        highlightOpacity={0.24}
      >
        <Ionicons name="mail" size={46} color={palette.primary} />
      </ClaySurface>
      <View style={styles.illustrationBadge}>
        <ClaySurface
          radius={17}
          tint={palette.white}
          shadowTint={palette.primaryDark}
          intensity="sm"
          style={styles.illustrationBadgeShadow}
          innerStyle={styles.illustrationBadgeInner}
          highlightOpacity={0.24}
        >
          <Ionicons name="checkmark" size={17} color={palette.success} />
        </ClaySurface>
      </View>
    </View>
  );
}

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
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emailShake, setEmailShake] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendReset = async () => {
    // Supabase's resetPasswordForEmail already responds the same way
    // whether or not the email is registered — never branch UI copy on
    // "does this account exist" here, that's exactly the enumeration leak
    // this is designed to avoid.
    const { error: reqError } = await requestPasswordReset(email.trim());
    return reqError;
  };

  const onSubmit = async () => {
    if (submittingRef.current || loading) return;
    if (!email.trim() || !EMAIL_RE.test(email)) {
      setEmailError(strings.emailInvalid);
      setEmailShake((k) => k + 1);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setSubmitError(null);
    const reqError = await sendReset();
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
    setSent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const onResend = async () => {
    if (resending || cooldown > 0) return;
    setResending(true);
    await sendReset();
    setResending(false);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  if (sent) {
    return (
      <Screen>
        <AuthHeader onSettings={() => setShowSettings(true)} />
        <FadeInUp reduced={reduced} delay={0} style={styles.successWrap}>
          <ResetEmailIllustration />
          <Text style={[styles.successTitle, { color: palette.text, fontSize: 20 * titleFontScale }]}>{strings.successTitle}</Text>
          <Text style={[styles.subtitle, styles.centerText, { color: bodyColor }]}>{strings.successBody}</Text>

          <View style={styles.resendRow}>
            <Text style={[styles.resendPrompt, { color: bodyColor }]}>{strings.didntReceive}</Text>
            {cooldown > 0 ? (
              <Text style={[styles.resendCooldown, { color: palette.textMuted }]}>{strings.resendInSeconds(cooldown)}</Text>
            ) : (
              <Pressable onPress={onResend} hitSlop={8} disabled={resending} accessibilityRole="button">
                <Text style={[styles.link, { color: palette.primary }]}>{resending ? strings.sending : strings.resendEmail}</Text>
              </Pressable>
            )}
          </View>

          <View style={{ width: '100%', marginTop: spacing.xl }}>
            <PrimaryButton title={strings.backToLogin} onPress={() => navigation.navigate('Login')} reduced={reduced} />
          </View>
        </FadeInUp>
        <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={getSettingsTitle(prefs.language)} />
      </Screen>
    );
  }

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
          <PrimaryButton title={strings.sendResetLink} loadingTitle={strings.sending} onPress={onSubmit} loading={loading} reduced={reduced} />
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
    // Requires the recovery session Supabase establishes when the user opens
    // the reset-password deep link that was emailed to them.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      console.error('[ResetPasswordScreen] updateUser:', updateError.status, updateError.message);
      const msg = updateError.message.toLowerCase();
      if (msg.includes('session') || msg.includes('expired') || msg.includes('token')) {
        setError('This reset link has expired. Please request a new one from Forgot Password.');
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
  };

  // Reached via the recovery deep-link flow: RootNavigator swaps this
  // dedicated stack out for the normal one the instant the flag clears
  // (the session from the recovery link is now a normal valid session,
  // so that lands the user on Home). Reached the old way (registered in
  // AuthNavigator, no active recovery): just go to Login as before.
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

  successWrap: { alignItems: 'center', paddingTop: spacing.lg },
  centerText: { textAlign: 'center' },
  successTitle: { ...typography.heading, marginTop: spacing.lg, marginBottom: spacing.xs, textAlign: 'center' },

  illustrationWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  illustrationShadow: { width: 112, height: 112 },
  illustrationInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  illustrationBadge: { position: 'absolute', bottom: 2, right: 2 },
  illustrationBadgeShadow: { width: 34, height: 34 },
  illustrationBadgeInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },

  resendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg },
  resendPrompt: { ...typography.body },
  resendCooldown: { ...typography.bodyMedium },
});

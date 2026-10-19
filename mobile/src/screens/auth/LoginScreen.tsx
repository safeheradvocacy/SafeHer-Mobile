import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { Input, PasswordInput, PrimaryButton, Screen, AlertMessage, FadeInUp, useReducedMotion } from '../../components/ui';
import { AuthHeader } from '../../components/auth/AuthHeader';
import { LogoFull } from '../../components/branding/LogoMark';
import { ShakeField } from '../../components/auth/ShakeField';
import { SettingsSheet } from '../../components/SettingsSheet';
import { useTheme } from '../../contexts/ThemeContext';
import { getLoginStrings, getSettingsTitle } from './authContent';
import { spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deliberately only remembers the EMAIL, never the password or session —
// Supabase already keeps the user signed in across app restarts by
// default, so this checkbox isn't gating "stay logged in" (that would
// mean touching the existing session-persistence setup, which is out of
// scope here); it just saves a trip re-typing the address next time.
const REMEMBERED_EMAIL_KEY = 'safeher_remembered_email';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Login'>>();
  const { signIn } = useAuth();
  const systemReducedMotion = useReducedMotion();
  const { palette, prefs } = useTheme();
  const reduced = systemReducedMotion || prefs.reduceMotion;
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getLoginStrings(prefs.language), [prefs.language]);
  const [showSettings, setShowSettings] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailShake, setEmailShake] = useState(0);
  const [passwordShake, setPasswordShake] = useState(0);
  // Synchronous guard in addition to the (async, re-render-driven)
  // `loading` state disabling the button — closes the gap where a very
  // fast double-tap could fire onSubmit twice before React re-renders.
  const submittingRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(REMEMBERED_EMAIL_KEY).then((saved) => {
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    });
  }, []);

  const emailValid = EMAIL_RE.test(email);

  const onSubmit = async () => {
    if (submittingRef.current || loading) return;

    let hasError = false;
    if (!email.trim() || !emailValid) {
      setEmailError(strings.emailInvalid);
      setEmailShake((k) => k + 1);
      hasError = true;
    }
    if (!password) {
      setPasswordError(strings.passwordRequired);
      setPasswordShake((k) => k + 1);
      hasError = true;
    }
    if (hasError) return;

    submittingRef.current = true;
    setSubmitError(null);
    setLoading(true);
    const { error: signInError, code } = await signIn(email.trim(), password);
    setLoading(false);
    submittingRef.current = false;
    if (signInError) {
      if (code === 'email_not_confirmed') {
        // The Login screen has no code-entry field of its own — sending
        // the user straight to EmailVerification (rather than just
        // showing an inline "resend" link with nowhere to type the code)
        // is what actually lets them finish verifying.
        navigation.navigate('EmailVerification', { email: email.trim() });
        return;
      }
      setSubmitError(signInError);
      setEmailShake((k) => k + 1);
      setPasswordShake((k) => k + 1);
      return;
    }
    if (rememberMe) {
      AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
    } else {
      AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
    // On success, RootNavigator swaps to AppNavigator automatically because
    // `session` changes in AuthContext — no manual navigation needed here.
  };

  return (
    <Screen>
      <AuthHeader onBack={() => navigation.goBack()} onSettings={() => setShowSettings(true)} />

      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'flex-start' }}>
        {/* The complete mark+wordmark lockup as one image — no separate
            "SafeSpace" Text beside it, since the asset already bakes the
            name in (see LogoMark.tsx for the two asset variants). No
            tagline underneath either: "Welcome back" + its subtitle right
            below already carry the screen's one supporting message —
            a second slogan here would just be a duplicate intro line. */}
        <LogoFull width={140} />
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={70} style={styles.headingBlock}>
        <Text style={[styles.title, { color: palette.text, fontSize: 26 * titleFontScale }]}>{strings.title}</Text>
        <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.subtitle}</Text>
      </FadeInUp>

      <View style={styles.form}>
        <FadeInUp reduced={reduced} delay={140}>
          <ShakeField trigger={emailShake} reduced={reduced}>
            <Input
              label={strings.emailLabel}
              icon="mail-outline"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError(null);
                if (submitError) setSubmitError(null);
              }}
              placeholder="Enter your email"
              error={emailError ?? undefined}
              rightElement={emailValid && email.length > 0 ? <Ionicons name="checkmark-circle" size={18} color={palette.success} /> : undefined}
            />
          </ShakeField>
        </FadeInUp>

        <FadeInUp reduced={reduced} delay={200}>
          <ShakeField trigger={passwordShake} reduced={reduced}>
            <PasswordInput
              label={strings.passwordLabel}
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (passwordError) setPasswordError(null);
                if (submitError) setSubmitError(null);
              }}
              placeholder="••••••••"
              error={passwordError ?? undefined}
            />
          </ShakeField>
        </FadeInUp>

        {submitError ? <AlertMessage variant="error" title={strings.loginErrorTitle} message={submitError} /> : null}

        <FadeInUp reduced={reduced} delay={240} style={[styles.optionsRow, { marginBottom: spacing.lg }]}>
          <Pressable
            onPress={() => setRememberMe((v) => !v)}
            style={styles.rememberTouch}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rememberMe }}
            accessibilityLabel={strings.rememberMe}
          >
            <View style={[styles.checkbox, { borderColor: palette.border }, rememberMe ? { backgroundColor: palette.primary, borderColor: palette.primary } : null]}>
              {rememberMe ? <Ionicons name="checkmark" size={13} color={palette.white} /> : null}
            </View>
            <Text style={[styles.rememberText, { color: bodyColor }]}>{strings.rememberMe}</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('ForgotPassword')} hitSlop={8} style={styles.forgotTouch}>
            <Text style={[styles.link, { color: palette.primary }]}>{strings.forgotPassword}</Text>
          </Pressable>
        </FadeInUp>

        <FadeInUp reduced={reduced} delay={280}>
          <PrimaryButton title={strings.logIn} loadingTitle={strings.signingIn} onPress={onSubmit} loading={loading} reduced={reduced} />
        </FadeInUp>

        <FadeInUp reduced={reduced} delay={320} style={{ marginTop: spacing.lg }}>
          <View style={[styles.divider, { backgroundColor: palette.border }]} />
        </FadeInUp>

        <FadeInUp reduced={reduced} delay={360} style={styles.createRow}>
          <Pressable onPress={() => navigation.navigate('Register')} hitSlop={10} style={styles.createTouch}>
            <Text style={[styles.footerText, { color: bodyColor }]}>
              {strings.noAccount}
              <Text style={[styles.link, { color: palette.primary }]}>{strings.createOne}</Text>
            </Text>
          </Pressable>
        </FadeInUp>

        {/* Compact one-line reassurance, no card/icon/heading — was a
            shadowed card with a lock icon, a heading, and a longer
            sentence, which gave a login screen more visual weight than a
            single already-clear fact needs. */}
        <FadeInUp reduced={reduced} delay={410} style={{ marginTop: spacing.xl }}>
          <Text style={[styles.privacyText, { color: bodyColor }]}>{strings.privacyBody}</Text>
        </FadeInUp>
      </View>

      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={getSettingsTitle(prefs.language)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingBlock: { marginTop: spacing.lg },
  title: { ...typography.display, fontSize: 26 },
  subtitle: { ...typography.body, marginTop: spacing.xs },
  form: { marginTop: spacing.lg },

  // flexWrap so "Forgot password?" drops to its own line on a narrow
  // screen or with larger font scaling, rather than crowding/overlapping
  // "Remember me" on one row.
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: spacing.xs },
  rememberTouch: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  rememberText: { ...typography.body },
  forgotTouch: { paddingVertical: 6, paddingHorizontal: spacing.xs },

  divider: { height: 1 },

  createRow: { alignItems: 'center', marginTop: spacing.lg },
  createTouch: { paddingVertical: 10, paddingHorizontal: spacing.sm },
  link: { ...typography.bodyMedium },
  footerText: { ...typography.body, textAlign: 'center' },
  privacyText: { ...typography.caption, textAlign: 'center' },
});

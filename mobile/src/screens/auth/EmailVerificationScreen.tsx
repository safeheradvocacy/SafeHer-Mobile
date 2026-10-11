import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { PrimaryButton, AlertMessage, Screen, FadeInUp, useReducedMotion } from '../../components/ui';
import { LogoMark } from '../../components/branding/LogoMark';
import { useTheme } from '../../contexts/ThemeContext';
import { getEmailVerificationStrings } from './authContent';
import { spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';
import { OtpInput, maskEmail, DEFAULT_CODE_LENGTH as CODE_LENGTH } from '../../components/OtpInput';
import { CURRENT_TERMS_VERSION } from '../../lib/terms';

const RESEND_COOLDOWN_SECONDS = 30;

export function EmailVerificationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'EmailVerification'>>();
  const route = useRoute<RouteProp<AuthStackParamList, 'EmailVerification'>>();
  const { verifyEmailOtp, resendVerificationEmail } = useAuth();
  const reduced = useReducedMotion();
  const { palette, prefs } = useTheme();
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getEmailVerificationStrings(prefs.language), [prefs.language]);
  const email = route.params?.email ?? '';

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onVerify = async () => {
    if (verifying || code.length !== CODE_LENGTH || !email) return;
    setVerifying(true);
    setError(null);
    const { error: verifyError } = await verifyEmailOtp(email, code);
    setVerifying(false);
    if (verifyError) {
      setError(verifyError);
      return;
    }
    // This is the one point where a brand-new SafeSpace account has both
    // (a) definitely been created (the account only exists because
    // RegisterScreen's consent checkbox gated the signUp() call that
    // made it) and (b) a live session, which RLS requires to write
    // terms_acceptances (see supabase/module18_terms_acceptance.sql).
    // Best-effort: a failure here never blocks sign-in — email
    // verification genuinely succeeded — but is logged rather than
    // silently dropped, and the user can still record acceptance later
    // from Profile > Legal & Privacy if this write never lands (see
    // TermsAndConditionsScreen). Idempotent (unique (user_id,
    // terms_version) in the database), so a retried verification can
    // never create a duplicate row — 23505 just means it's already
    // recorded.
    const { error: termsError } = await supabase.from('terms_acceptances').insert({ terms_version: CURRENT_TERMS_VERSION });
    if (termsError && (termsError as { code?: string }).code !== '23505') {
      console.error('[EmailVerificationScreen] recording terms acceptance failed:', termsError.message);
    }

    // Survivor Information collected during registration (RegisterScreen)
    // couldn't be written until now — signUp() returns no session, and
    // the on_auth_user_created trigger (which DOES already run, creating
    // the survivors row) is deliberately left untouched by this feature
    // rather than extended to also read these fields from metadata. Now
    // that verifyEmailOtp has established a real session, the EXISTING
    // "Users can update own survivor row" RLS policy (module1b) — the
    // same one ProfileScreen's own survivor-info editor already relies
    // on — covers this write with no new policy, no service-role, no
    // second insert. Best-effort and non-blocking, same as the terms
    // write just above: a genuinely verified account must never be
    // blocked from reaching Home over this, since the user can still
    // complete it afterward from Profile (and a failure here is narrow —
    // RLS only lets this touch the caller's own just-created row).
    const survivorInfo = route.params?.survivorInfo;
    if (survivorInfo) {
      const { data: survivorRow, error: survivorFetchError } = await supabase
        .from('survivors')
        .select('survivor_id, profile_id')
        .maybeSingle();
      if (survivorFetchError || !survivorRow) {
        console.error('[EmailVerificationScreen] could not locate new survivor row:', survivorFetchError?.message);
      } else {
        const { error: survivorUpdateError } = await supabase
          .from('survivors')
          .update({
            date_of_birth: survivorInfo.dateOfBirth,
            gender: survivorInfo.gender,
            educational_attainment: survivorInfo.educationalAttainment,
          })
          .eq('survivor_id', survivorRow.survivor_id);
        if (survivorUpdateError) {
          console.error('[EmailVerificationScreen] saving survivor info failed:', survivorUpdateError.message);
        } else {
          // Same redaction convention as ProfileScreen.saveSurvivorInfo —
          // date of birth is never written to audit_logs as a literal
          // value, only whether it's now set.
          await logAudit({
            profileId: survivorRow.profile_id,
            action: 'UPDATE',
            tableName: 'survivors',
            recordId: survivorRow.survivor_id,
            oldValues: { date_of_birth_set: false, gender: null, educational_attainment: null },
            newValues: {
              date_of_birth_set: true,
              gender: survivorInfo.gender,
              educational_attainment: survivorInfo.educationalAttainment,
            },
          });
        }
      }
    }

    // On success, AuthContext's session listener picks up the new
    // session automatically (verifyOtp establishes one the same way
    // signIn does) — RootNavigator swaps to the authenticated app on its
    // own; no manual navigation needed here.
  };

  const onResend = async () => {
    if (resending || cooldown > 0 || !email) return;
    setResending(true);
    setResendMessage(null);
    const { error: resendError } = await resendVerificationEmail(email);
    setResending(false);
    if (resendError) {
      Alert.alert('', resendError);
      return;
    }
    setResendMessage(strings.resendSentBody);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <Screen>
      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'center' }}>
        <LogoMark size="sm" />
        <Text style={[styles.title, { color: palette.text, fontSize: 22 * titleFontScale, marginTop: spacing.sm }]}>{strings.title}</Text>
        <Text style={[styles.body, { color: bodyColor }]}>{strings.explanation}</Text>
        {email ? <Text style={[styles.emailText, { color: palette.primary }]}>{maskEmail(email)}</Text> : null}
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
        <Pressable onPress={() => navigation.replace('Login')} hitSlop={10}>
          <Text style={[styles.link, { color: bodyColor }]}>{strings.backToLogin}</Text>
        </Pressable>
      </FadeInUp>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, marginTop: spacing.md, marginBottom: spacing.xs, textAlign: 'center' },
  body: { ...typography.body, textAlign: 'center' },
  emailText: { ...typography.bodyMedium, textAlign: 'center', marginTop: spacing.xs },

  resendPrompt: { ...typography.body },
  resendSuccess: { ...typography.caption, marginTop: 4 },
  cooldownText: { ...typography.caption, marginTop: 4 },
  resendTouch: { paddingVertical: 6, paddingHorizontal: spacing.sm, marginTop: 2 },
  link: { ...typography.bodyMedium },
});

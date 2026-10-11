import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertMessage, PrimaryButton, Screen, FadeInUp, useReducedMotion } from '../../components/ui';
import { AuthHeader } from '../../components/auth/AuthHeader';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { CURRENT_TERMS_VERSION, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from '../../lib/terms';

function formatAcceptedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One shared screen for both contexts SafeHer opens this from:
 *  - Registration (no session yet) — read-only, just the document and a
 *    way back to Register. Opening this screen NEVER records
 *    acceptance by itself — the only thing that records consent is the
 *    registration checkbox + successful account creation + email
 *    verification (see AuthContext.verifyEmailOtp). Registered in
 *    AuthNavigator with headerShown:false for that stack, so it draws
 *    its own AuthHeader back button here.
 *  - Profile > Legal & Privacy (authenticated) — same document, plus a
 *    real check against this user's own terms_acceptances row for the
 *    CURRENT_TERMS_VERSION. If found, shows "Accepted on <date>" and
 *    nothing else — the acceptance record itself can never be edited or
 *    re-toggled from here (see module18's "no update/delete policy").
 *    If not found (a pre-feature legacy account, or a future version
 *    bump not yet accepted), shows an explicit "I agree" action — never
 *    pre-checked, never automatic. Registered in AppNavigator, which
 *    supplies its own native header/back button, so no AuthHeader here.
 */
export function TermsAndConditionsScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const isAuthenticated = !!session;

  const [checking, setChecking] = useState(isAuthenticated);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const checkAcceptance = useCallback(async () => {
    if (!isAuthenticated) return;
    setChecking(true);
    const { data, error } = await supabase
      .from('terms_acceptances')
      .select('accepted_at')
      .eq('terms_version', CURRENT_TERMS_VERSION)
      .maybeSingle();
    setChecking(false);
    if (error) {
      console.error('[TermsAndConditionsScreen] checkAcceptance:', error.message);
      return;
    }
    setAcceptedAt(data?.accepted_at ?? null);
  }, [isAuthenticated]);

  useEffect(() => {
    checkAcceptance();
  }, [checkAcceptance]);

  const onAccept = async () => {
    if (recording) return;
    setRecording(true);
    setRecordError(null);
    const { data, error } = await supabase
      .from('terms_acceptances')
      .insert({ terms_version: CURRENT_TERMS_VERSION })
      .select('accepted_at')
      .single();
    setRecording(false);
    if (!error) {
      setAcceptedAt(data.accepted_at);
      return;
    }
    // 23505 = unique_violation: a row for this version already exists
    // (e.g. a prior attempt succeeded but this device never saw the
    // response). Re-check the real record rather than claim a fresh
    // acceptance happened.
    if ((error as { code?: string }).code === '23505') {
      checkAcceptance();
      return;
    }
    console.error('[TermsAndConditionsScreen] record acceptance failed:', error.message);
    setRecordError("We couldn't save your acceptance right now. Please check your connection and try again.");
  };

  return (
    <Screen>
      {!isAuthenticated ? <AuthHeader onBack={() => navigation.goBack()} /> : null}

      <FadeInUp reduced={reduced}>
        {!isAuthenticated ? <Text style={[styles.title, { color: palette.text }]}>Terms and Conditions</Text> : null}
        <View style={[styles.metaRow, { borderColor: palette.border }]}>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>Version {CURRENT_TERMS_VERSION}</Text>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>Effective {TERMS_EFFECTIVE_DATE}</Text>
        </View>

        {isAuthenticated ? (
          checking ? (
            <Text style={[styles.checkingText, { color: palette.textMuted }]}>Checking your acceptance status...</Text>
          ) : acceptedAt ? (
            <View style={[styles.acceptedBanner, { backgroundColor: palette.primaryLight, borderColor: palette.success }]}>
              <Text style={[styles.acceptedText, { color: palette.success }]}>
                You accepted this version on {formatAcceptedAt(acceptedAt)}.
              </Text>
            </View>
          ) : null
        ) : null}
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={60}>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={[styles.sectionHeading, { color: palette.text }]}>{section.heading}</Text>
            {section.body.map((para, i) => (
              <Text key={i} style={[styles.paragraph, { color: palette.textMuted }]}>
                {para}
              </Text>
            ))}
          </View>
        ))}
      </FadeInUp>

      {isAuthenticated && !checking && !acceptedAt ? (
        <FadeInUp reduced={reduced} delay={100} style={{ marginTop: spacing.md }}>
          {recordError ? <AlertMessage variant="error" title="Couldn't save your acceptance" message={recordError} /> : null}
          <Text style={[styles.paragraph, { color: palette.textMuted, marginBottom: spacing.sm }]}>
            You have not yet accepted this version of the Terms and Conditions.
          </Text>
          <PrimaryButton
            title="I agree to the Terms and Conditions"
            loadingTitle="Saving..."
            onPress={onAccept}
            loading={recording}
            reduced={reduced}
          />
        </FadeInUp>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22, marginBottom: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
  },
  metaText: { ...typography.caption },
  checkingText: { ...typography.caption, marginBottom: spacing.md },
  acceptedBanner: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  acceptedText: { ...typography.bodyMedium },
  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.heading, fontSize: 16, marginBottom: spacing.xs },
  paragraph: { ...typography.body, lineHeight: 21, marginBottom: spacing.sm },
});

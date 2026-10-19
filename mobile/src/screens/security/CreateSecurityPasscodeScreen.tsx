import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Input, PrimaryButton, Screen, AlertMessage, FadeInUp, useReducedMotion } from '../../components/ui';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { spacing, typography, radius } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import { evaluate, passcodesMatch, PasscodeStrengthLevel } from '../../lib/passcodeStrength';

const STRENGTH_COPY: Record<PasscodeStrengthLevel, string> = {
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

function strengthColor(level: PasscodeStrengthLevel, palette: ReturnType<typeof useTheme>['palette']) {
  switch (level) {
    case 'weak':
      return palette.danger;
    case 'fair':
      return palette.warning;
    case 'good':
      return palette.info;
    case 'strong':
      return palette.success;
  }
}

function EyeToggle({ visible, onToggle, color }: { visible: boolean; onToggle: () => void; color: string }) {
  return (
    <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={visible ? 'Hide passcode' : 'Show passcode'}>
      <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={color} />
    </Pressable>
  );
}

const TITLES: Record<'enroll' | 'change' | 'forgot', { title: string; body: string }> = {
  enroll: {
    title: 'Create Your Security Passcode',
    body: 'This separate passcode protects your confidential case information and incident reports. You need it to submit a report or view your case details.',
  },
  change: {
    title: 'Change Your Security Passcode',
    body: 'Choose a new security passcode. This replaces your current one immediately.',
  },
  forgot: {
    title: 'Reset Your Security Passcode',
    body: 'Confirm your SafeSpace account password, then choose a new security passcode.',
  },
};

export function CreateSecurityPasscodeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'CreateSecurityPasscode'>>();
  const route = useRoute<RouteProp<AppStackParamList, 'CreateSecurityPasscode'>>();
  const mode = route.params?.mode ?? 'enroll';
  const returnTo = route.params?.returnTo;
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const { enroll, changePasscode, forgotPasscode } = usePasscode();

  const [accountPassword, setAccountPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => evaluate(passcode), [passcode]);
  const confirmError = confirm.length > 0 && !passcodesMatch(passcode, confirm) ? 'Passcodes do not match.' : undefined;

  const copy = TITLES[mode];

  const canSubmit =
    !submitting &&
    strength.meetsMinimum &&
    passcodesMatch(passcode, confirm) &&
    (mode !== 'forgot' || accountPassword.length > 0);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result =
      mode === 'enroll'
        ? await enroll(passcode)
        : mode === 'change'
        ? await changePasscode(passcode)
        : await forgotPasscode(passcode, accountPassword);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(true);
  };

  const onContinue = () => {
    if (returnTo === 'ReportIncident') {
      navigation.dispatch(CommonActions.navigate({ name: 'ReportIncident' }));
      return;
    }
    if (navigation.canGoBack() && mode !== 'enroll') {
      // 'change'/'forgot' are reached from Profile/Settings — returning
      // there reads more naturally than forcing a jump to Home.
      navigation.goBack();
      return;
    }
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Tabs' }] }));
  };

  if (done) {
    return (
      <Screen>
        <FadeInUp reduced={reduced} delay={0} style={styles.successWrap}>
          <ClaySurface
            radius={48}
            tint={palette.primaryLight}
            shadowTint={palette.primaryDark}
            intensity="md"
            style={styles.successIconShadow}
            innerStyle={styles.successIconInner}
            highlightOpacity={0.24}
          >
            <Ionicons name="shield-checkmark" size={38} color={palette.primary} />
          </ClaySurface>
          <Text style={[styles.title, styles.centerText, { color: palette.text }]}>
            {mode === 'enroll' ? 'Passcode created' : mode === 'change' ? 'Passcode changed' : 'Passcode reset'}
          </Text>
          <Text style={[styles.body, styles.centerText, { color: palette.textMuted }]}>
            Your confidential case information is now protected by this passcode.
          </Text>
          <View style={{ width: '100%', marginTop: spacing.xl }}>
            <PrimaryButton title="Continue" onPress={onContinue} reduced={reduced} />
          </View>
        </FadeInUp>
      </Screen>
    );
  }

  return (
    <Screen>
      <FadeInUp reduced={reduced} delay={0}>
        <Text style={[styles.title, { color: palette.text }]}>{copy.title}</Text>
        <Text style={[styles.body, { color: palette.textMuted }]}>{copy.body}</Text>
      </FadeInUp>

      {mode === 'forgot' ? (
        <FadeInUp reduced={reduced} delay={40} style={{ marginTop: spacing.lg }}>
          <Input
            label="SafeSpace account password"
            secureTextEntry={!showAccountPassword}
            icon="lock-closed-outline"
            value={accountPassword}
            onChangeText={(v) => {
              setAccountPassword(v);
              if (error) setError(null);
            }}
            rightElement={<EyeToggle visible={showAccountPassword} onToggle={() => setShowAccountPassword((v) => !v)} color={palette.textMuted} />}
          />
        </FadeInUp>
      ) : null}

      <FadeInUp reduced={reduced} delay={80} style={{ marginTop: mode === 'forgot' ? 0 : spacing.lg }}>
        <Input
          label={mode === 'forgot' ? 'New security passcode' : 'Create security passcode'}
          secureTextEntry={!showPasscode}
          icon="key-outline"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          value={passcode}
          onChangeText={(v) => {
            setPasscode(v);
            if (error) setError(null);
          }}
          rightElement={<EyeToggle visible={showPasscode} onToggle={() => setShowPasscode((v) => !v)} color={palette.textMuted} />}
        />

        {passcode.length > 0 ? (
          <View style={{ marginTop: -spacing.xs, marginBottom: spacing.sm }}>
            <View style={styles.strengthTrack}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.strengthSegment,
                    { backgroundColor: i < strength.score ? strengthColor(strength.level, palette) : palette.border },
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.strengthLabel, { color: strengthColor(strength.level, palette) }]}>{STRENGTH_COPY[strength.level]}</Text>
            {strength.suggestions.slice(0, 2).map((s, i) => (
              <Text key={i} style={[styles.suggestion, { color: palette.textMuted }]}>
                • {s}
              </Text>
            ))}
          </View>
        ) : null}

        <Input
          label="Confirm security passcode"
          secureTextEntry={!showConfirm}
          icon="key-outline"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          value={confirm}
          onChangeText={(v) => {
            setConfirm(v);
            if (error) setError(null);
          }}
          error={confirmError}
          rightElement={<EyeToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} color={palette.textMuted} />}
        />
      </FadeInUp>

      {error ? <AlertMessage variant="error" title="Couldn't save your passcode" message={error} /> : null}

      <FadeInUp reduced={reduced} delay={120} style={{ marginTop: spacing.md }}>
        <PrimaryButton
          title={mode === 'enroll' ? 'Create Passcode' : mode === 'change' ? 'Change Passcode' : 'Reset Passcode'}
          loadingTitle="Saving..."
          onPress={onSubmit}
          loading={submitting}
          disabled={!canSubmit}
          reduced={reduced}
        />
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={160} style={{ marginTop: spacing.lg }}>
        <Text style={[styles.note, { color: palette.textMuted }]}>
          Your security passcode is separate from your account password. SafeSpace never stores it as plain text, and staff cannot see or recover it on
          your behalf — if you forget it, you'll need your account password to reset it.
        </Text>
      </FadeInUp>

      {mode === 'enroll' ? (
        <FadeInUp reduced={reduced} delay={200} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <Pressable
            onPress={() =>
              navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Tabs' }] }))
            }
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={[styles.skipLink, { color: palette.textMuted }]}>Skip for now</Text>
          </Pressable>
          <Text style={[styles.skipNote, { color: palette.textMuted }]}>
            You can still use Emergency SOS, Shelters, and the Assistant. You'll need to finish this before submitting an incident report or viewing your
            case details.
          </Text>
        </FadeInUp>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, fontSize: 22, marginBottom: spacing.xs },
  body: { ...typography.body },
  centerText: { textAlign: 'center' },
  note: { ...typography.caption },

  successWrap: { alignItems: 'center', paddingTop: spacing.xl },
  successIconShadow: { width: 96, height: 96 },
  successIconInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },

  strengthTrack: { flexDirection: 'row', gap: 4, marginTop: 2 },
  strengthSegment: { flex: 1, height: 4, borderRadius: radius.sm },
  strengthLabel: { ...typography.caption, fontWeight: '600', marginTop: 4 },
  suggestion: { ...typography.caption, marginTop: 2 },
  skipLink: { ...typography.bodyMedium, textDecorationLine: 'underline' },
  skipNote: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.md },
});

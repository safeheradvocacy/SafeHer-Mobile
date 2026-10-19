import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp, CommonActions, StackActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Input, PrimaryButton, Screen, AlertMessage, FadeInUp, useReducedMotion } from '../../components/ui';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

export function VerifySecurityPasscodeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'VerifySecurityPasscode'>>();
  const route = useRoute<RouteProp<AppStackParamList, 'VerifySecurityPasscode'>>();
  const { returnTo } = route.params;
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const { verify } = usePasscode();

  const [passcode, setPasscode] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedSeconds, setLockedSeconds] = useState<number | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (lockedSeconds === null || lockedSeconds <= 0) return;
    const t = setTimeout(() => setLockedSeconds((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
  }, [lockedSeconds]);

  const onVerify = async () => {
    if (submittingRef.current || submitting || !passcode || (lockedSeconds !== null && lockedSeconds > 0)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const result = await verify(passcode);
    setSubmitting(false);
    submittingRef.current = false;
    if (!result.success) {
      setPasscode('');
      if (result.locked && result.retryAfterSeconds) {
        setLockedSeconds(result.retryAfterSeconds);
      }
      setError(result.error);
      return;
    }
    navigation.dispatch(StackActions.replace(returnTo.screen as never, returnTo.params));
  };

  const onCancel = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Tabs' }] }));
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
          <Ionicons name="close" size={22} color={palette.textMuted} />
        </Pressable>
      </View>

      <FadeInUp reduced={reduced} delay={0} style={{ alignItems: 'center' }}>
        <ClaySurface
          radius={26}
          tint={palette.surface}
          shadowTint={palette.primaryDark}
          intensity="sm"
          style={styles.iconShadow}
          innerStyle={styles.iconInner}
          highlightOpacity={0.24}
        >
          <Ionicons name="shield-checkmark-outline" size={22} color={palette.primary} />
        </ClaySurface>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={40}>
        <Text style={[styles.title, styles.centerText, { color: palette.text }]}>Enter Your Security Passcode</Text>
        <Text style={[styles.body, styles.centerText, { color: palette.textMuted }]}>
          This confirms it's you before showing your confidential case information.
        </Text>
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={80} style={{ marginTop: spacing.lg }}>
        <Input
          label="Security passcode"
          secureTextEntry={!visible}
          icon="key-outline"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          autoFocus
          value={passcode}
          onChangeText={(v) => {
            setPasscode(v);
            if (error) setError(null);
          }}
          onSubmitEditing={onVerify}
          returnKeyType="done"
          editable={lockedSeconds === null || lockedSeconds <= 0}
          rightElement={
            <Pressable onPress={() => setVisible((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={visible ? 'Hide passcode' : 'Show passcode'}>
              <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.textMuted} />
            </Pressable>
          }
        />
      </FadeInUp>

      {lockedSeconds !== null && lockedSeconds > 0 ? (
        <AlertMessage
          variant="error"
          title="Too many attempts"
          message={`For your security, try again in ${formatRetry(lockedSeconds)}.`}
        />
      ) : error ? (
        <AlertMessage variant="error" title="Couldn't verify passcode" message={error} />
      ) : null}

      <FadeInUp reduced={reduced} delay={120} style={{ marginTop: spacing.md }}>
        <PrimaryButton
          title="Verify"
          loadingTitle="Verifying..."
          onPress={onVerify}
          loading={submitting}
          disabled={!passcode || (lockedSeconds !== null && lockedSeconds > 0)}
          reduced={reduced}
        />
      </FadeInUp>

      <FadeInUp reduced={reduced} delay={160} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
        <Pressable
          onPress={() => navigation.navigate('CreateSecurityPasscode', { mode: 'forgot' })}
          hitSlop={10}
          accessibilityRole="button"
        >
          <Text style={[styles.link, { color: palette.primary }]}>Forgot your passcode?</Text>
        </Pressable>
      </FadeInUp>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.sm },
  iconShadow: { width: 52, height: 52 },
  iconInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  title: { ...typography.heading, fontSize: 20, marginTop: spacing.md, marginBottom: spacing.xs },
  body: { ...typography.body },
  centerText: { textAlign: 'center' },
  link: { ...typography.bodyMedium },
});

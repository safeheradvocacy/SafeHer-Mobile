import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { PasswordInput, PrimaryButton, Screen, AlertMessage } from '../../components/ui';
import { OtpInput, maskEmail, DEFAULT_CODE_LENGTH as CODE_LENGTH } from '../../components/OtpInput';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';

const RESEND_COOLDOWN_SECONDS = 30;

function friendlyUpdateError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('session') || msg.includes('expired') || msg.includes('token')) {
    return 'Your session has expired. Please log out and back in, then try again.';
  }
  if (msg.includes('different from the old password')) {
    return 'Please choose a password different from your current one.';
  }
  if (msg.includes('password')) {
    return 'Your password does not meet the required security requirements.';
  }
  return "We couldn't update your password. Please try again.";
}

type Step = 'confirm' | 'otp' | 'password';

export function ChangePasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'ChangePassword'>>();
  const { session, profile, sendPasswordChangeOtp, verifyEmailOtp, updatePasswordAfterOtp } = useAuth();
  const { palette } = useTheme();
  const email = session?.user?.email ?? '';

  const [step, setStep] = useState<Step>('confirm');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onSendCode = async () => {
    if (sending) return;
    setSending(true);
    setSendError(null);
    const { error: sendErr } = await sendPasswordChangeOtp();
    setSending(false);
    if (sendErr) {
      setSendError(sendErr);
      return;
    }
    setStep('otp');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const onResendCode = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    const { error: sendErr } = await sendPasswordChangeOtp();
    setSending(false);
    if (sendErr) {
      Alert.alert('', sendErr);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const onVerifyOtp = async () => {
    if (verifying || code.length !== CODE_LENGTH) return;
    setVerifying(true);
    setOtpError(null);
    const { error: verifyError } = await verifyEmailOtp(email, code);
    setVerifying(false);
    if (verifyError) {
      const attempts = failedAttempts + 1;
      setFailedAttempts(attempts);
      setCode('');
      // A soft client-side backstop on top of Supabase's own server-side
      // OTP throttling — after several wrong tries in a row, stop letting
      // the user keep guessing and require a fresh code instead.
      if (attempts >= 5) {
        setOtpError('Too many incorrect attempts. Please request a new code.');
        setCooldown(0);
      } else {
        setOtpError(verifyError);
      }
      return;
    }
    setFailedAttempts(0);
    setStep('password');
  };

  const onSubmitPassword = async () => {
    setError(null);
    setSuccess(false);

    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must contain at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Please choose a password different from your current one.');
      return;
    }
    if (!email) {
      setError('Your session has expired. Please log out and back in, then try again.');
      return;
    }

    setLoading(true);

    try {
      // Still require + verify the current password before the actual
      // change, on top of the OTP step already completed — defense in
      // depth, not a replacement for it.
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthError) {
        setError('Current password is incorrect.');
        return;
      }

      const { error: updateError } = await updatePasswordAfterOtp(newPassword);
      if (updateError) {
        setError(updateError);
        return;
      }

      if (profile) {
        await logAudit({
          profileId: profile.profile_id,
          action: 'PASSWORD_CHANGED',
          tableName: 'auth.users',
          recordId: profile.profile_id,
        });
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (e) {
      console.error('[ChangePasswordScreen] onSubmit:', e);
      setError('Unable to connect to SafeSpace. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'confirm') {
    return (
      <Screen>
        <Text style={[styles.stepTitle, { color: palette.text }]}>Confirm your email</Text>
        <Text style={[styles.stepBody, { color: palette.textMuted }]}>
          To help protect your account, we'll send a verification code to your registered email before you can change
          your password.
        </Text>
        {email ? <Text style={[styles.emailText, { color: palette.primary }]}>{maskEmail(email)}</Text> : null}
        {sendError ? <AlertMessage variant="error" title="Couldn't send code" message={sendError} /> : null}
        <PrimaryButton title="Send Code" loadingTitle="Sending..." onPress={onSendCode} loading={sending} />
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton title="Cancel" variant="outline" onPress={() => navigation.goBack()} disabled={sending} />
        </View>
      </Screen>
    );
  }

  if (step === 'otp') {
    return (
      <Screen>
        <Text style={[styles.stepTitle, { color: palette.text }]}>Enter verification code</Text>
        <Text style={[styles.stepBody, { color: palette.textMuted }]}>
          We sent a verification code to {email ? maskEmail(email) : 'your email'}.
        </Text>
        <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <OtpInput value={code} onChangeText={(v) => { setCode(v); if (otpError) setOtpError(null); }} autoFocus />
        </View>
        {otpError ? <AlertMessage variant="error" title="Couldn't verify code" message={otpError} /> : null}
        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            title="Verify"
            loadingTitle="Verifying..."
            onPress={onVerifyOtp}
            loading={verifying}
            disabled={code.length !== CODE_LENGTH}
          />
        </View>
        <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          {cooldown > 0 ? (
            <Text style={[styles.cooldownText, { color: palette.textMuted }]}>Resend code in {cooldown}s</Text>
          ) : (
            <Pressable onPress={onResendCode} disabled={sending} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: palette.primary }]}>{sending ? 'Sending...' : 'Resend code'}</Text>
            </Pressable>
          )}
        </View>
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton title="Cancel" variant="outline" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <PasswordInput
        label="Current password"
        value={currentPassword}
        onChangeText={(v) => {
          setCurrentPassword(v);
          if (error) setError(null);
        }}
      />
      <PasswordInput
        label="New password"
        value={newPassword}
        onChangeText={(v) => {
          setNewPassword(v);
          if (error) setError(null);
        }}
        showStrength
      />
      <PasswordInput
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={(v) => {
          setConfirmPassword(v);
          if (error) setError(null);
        }}
        error={confirmPassword.length > 0 && confirmPassword !== newPassword ? 'Passwords do not match.' : undefined}
      />

      {error ? <AlertMessage variant="error" title="Couldn't update password" message={error} /> : null}
      {success ? (
        <AlertMessage variant="success" title="Success" message="Your password has been changed successfully." />
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton title="Cancel" variant="outline" onPress={() => navigation.goBack()} disabled={loading} />
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton title="Update Password" onPress={onSubmitPassword} loading={loading} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepTitle: { ...typography.heading, marginBottom: spacing.xs },
  stepBody: { ...typography.body, marginBottom: spacing.md },
  emailText: { ...typography.bodyMedium, marginBottom: spacing.lg },
  cooldownText: { ...typography.caption },
  link: { ...typography.bodyMedium },
});

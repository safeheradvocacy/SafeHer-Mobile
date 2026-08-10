import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { BackButton } from '../../components/auth/BackButton';
import { AuthTextInput } from '../../components/auth/AuthTextInput';
import { GradientButton } from '../../components/auth/GradientButton';
import { PrivacyNotice } from '../../components/auth/PrivacyNotice';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { sendPasswordResetEmail } from '../../services/authService';
import { isNotEmpty, isValidEmail } from '../../utils/validation';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async () => {
    if (!isNotEmpty(email)) {
      setError('Email address is required.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(undefined);
    setFormError(null);

    setIsSubmitting(true);
    const result = await sendPasswordResetEmail(email);
    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }
    setIsSent(true);
  };

  return (
    <ScreenContainer>
      <BackButton onPress={() => navigation.goBack()} />

      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.subtitle}>
          Enter your registered email address and we&apos;ll send you password reset instructions.
        </Text>
      </View>

      {isSent ? (
        <View style={styles.sentBanner}>
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
          <Text style={styles.sentText}>
            Reset instructions sent to {email}. Check your inbox and follow the link to continue.
          </Text>
        </View>
      ) : (
        <View style={styles.form}>
          <AuthTextInput
            icon="mail-outline"
            placeholder="Email Address"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError(undefined);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            error={error}
            testID="forgot-password-email"
          />

          {formError ? <Text style={styles.formError}>{formError}</Text> : null}

          <GradientButton
            label="Send Reset Link"
            onPress={handleSubmit}
            loading={isSubmitting}
            style={styles.submitButton}
            testID="forgot-password-submit"
          />
        </View>
      )}

      <View style={styles.footer}>
        <PrivacyNotice />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.stackLg, marginBottom: spacing.sectionPadding },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: radii.full,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.stackLg,
  },
  title: { ...typography.headlineLg, fontSize: 26, color: colors.primary, marginBottom: spacing.stackSm },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.stackSm },
  form: {},
  formError: { ...typography.bodySm, color: colors.error, marginTop: spacing.stackMd, textAlign: 'center' },
  submitButton: { marginTop: spacing.stackLg },
  sentBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.successContainer,
    borderRadius: radii.lg,
    padding: spacing.gutterMd,
  },
  sentText: { ...typography.bodySm, color: colors.onSurface, marginLeft: 8, flex: 1, lineHeight: 20 },
  footer: { marginTop: 'auto', paddingVertical: spacing.stackLg },
});

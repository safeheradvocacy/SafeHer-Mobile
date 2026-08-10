import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { BackButton } from '../../components/auth/BackButton';
import { PasswordInput } from '../../components/auth/PasswordInput';
import { PasswordStrengthMeter } from '../../components/auth/PasswordStrengthMeter';
import { GradientButton } from '../../components/auth/GradientButton';
import { PrivacyNotice } from '../../components/auth/PrivacyNotice';
import { colors, spacing, typography } from '../../constants/theme';
import { updatePassword } from '../../services/authService';
import { validateResetPasswordForm, hasErrors, type FieldErrors } from '../../utils/validation';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

export function ResetPasswordScreen({ navigation }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const fieldErrors = validateResetPasswordForm(newPassword, confirmPassword);
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) return;

    setIsSubmitting(true);
    const result = await updatePassword(newPassword);
    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <ScreenContainer>
      <BackButton onPress={() => navigation.goBack()} />

      <View style={styles.header}>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Create a new password for your account.</Text>
      </View>

      <View style={styles.form}>
        <PasswordInput
          placeholder="New Password"
          value={newPassword}
          onChangeText={(text) => {
            setNewPassword(text);
            setErrors((prev) => ({ ...prev, newPassword: undefined }));
          }}
          error={errors.newPassword}
          testID="reset-password-new"
        />
        <PasswordStrengthMeter password={newPassword} />

        <View style={styles.fieldSpacing}>
          <PasswordInput
            placeholder="Confirm Password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }}
            error={errors.confirmPassword}
            testID="reset-password-confirm"
          />
        </View>

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <GradientButton
          label="Reset Password"
          onPress={handleSubmit}
          loading={isSubmitting}
          style={styles.submitButton}
          testID="reset-password-submit"
        />
      </View>

      <View style={styles.footer}>
        <PrivacyNotice />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.stackLg, marginBottom: spacing.sectionPadding },
  title: { ...typography.headlineLg, fontSize: 26, color: colors.primary, marginBottom: spacing.stackSm },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center' },
  form: {},
  fieldSpacing: { marginTop: spacing.stackMd },
  formError: { ...typography.bodySm, color: colors.error, marginTop: spacing.stackMd, textAlign: 'center' },
  submitButton: { marginTop: spacing.stackLg },
  footer: { marginTop: 'auto', paddingVertical: spacing.stackLg },
});

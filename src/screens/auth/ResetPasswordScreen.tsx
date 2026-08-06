import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import PasswordStrengthIndicator from '../../components/common/PasswordStrengthIndicator';
import { useAuth } from '../../hooks/useAuth';
import { validatePassword } from '../../utils/validation';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';

const ResetPasswordScreen = () => {
  // The recovery link already established a session (see AuthContext +
  // services/authDeepLink.ts) — there's no token to read from route params
  // here, just a new password to collect.
  const { updatePassword, clearPasswordRecovery } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ newPassword: '', confirmPassword: '' });

  const validate = () => {
    let valid = true;
    const newErrors = { newPassword: '', confirmPassword: '' };
    if (!newPassword) {
      newErrors.newPassword = 'Password is required';
      valid = false;
    } else if (!validatePassword(newPassword)) {
      newErrors.newPassword = 'Password must be at least 8 characters';
      valid = false;
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
      valid = false;
    }
    setErrors(newErrors);
    return valid;
  };

  const handleReset = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await updatePassword(newPassword);
      Alert.alert(
        'Password Reset',
        "Your password has been updated. You're now signed in.",
        // Clearing the recovery flag hands control back to RootNavigator,
        // which routes into the app since a real session now exists —
        // there's no separate Login screen to navigate to from here.
        [{ text: 'OK', onPress: () => clearPasswordRecovery() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Create a new password for your account.</Text>

        <View style={styles.form}>
          <Input
            icon="lock"
            placeholder="New Password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
            error={errors.newPassword}
          />
          <PasswordStrengthIndicator password={newPassword} />

          <Input
            icon="lock"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
            error={errors.confirmPassword}
          />

          <Button title="Reset Password" onPress={handleReset} loading={loading} />
        </View>

        <View style={styles.footer}>
          <Icon name="lock" size={16} color={Colors.outline} />
          <Text style={styles.footerText}>
            Your information is protected under the Data Privacy Act of 2012.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.marginMobile,
    paddingTop: Spacing.sectionPadding,
    paddingBottom: Spacing.sectionPadding,
  },
  title: {
    ...Typography.headlineLG_mobile,
    color: Colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    marginBottom: Spacing.stackLG,
  },
  form: {
    gap: Spacing.stackMD,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
    paddingTop: Spacing.stackLG,
  },
  footerText: {
    ...Typography.labelSM,
    color: Colors.outline,
    textAlign: 'center',
  },
});

export default ResetPasswordScreen;

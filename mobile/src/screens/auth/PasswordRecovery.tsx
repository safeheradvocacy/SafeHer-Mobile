import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Input, PrimaryButton, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

export function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>>();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email) {
      setError('Enter the email associated with your account.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: reqError } = await requestPasswordReset(email.trim());
    setLoading(false);
    if (reqError) {
      setError(reqError);
      return;
    }
    setSent(true);
  };

  return (
    <Screen>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.subtitle}>
        {sent
          ? "If an account exists for that email, we've sent a link to reset your password."
          : "Enter your email and we'll send you a link to reset your password."}
      </Text>

      {!sent && (
        <View style={{ marginTop: spacing.lg }}>
          <Input
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="Send reset link" onPress={onSubmit} loading={loading} />
        </View>
      )}

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton title="Back to log in" variant="outline" onPress={() => navigation.navigate('Login')} />
      </View>
    </Screen>
  );
}

export function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'ResetPassword'>>();
  const route = useRoute<RouteProp<AuthStackParamList, 'ResetPassword'>>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    // Requires the recovery session Supabase establishes when the user opens
    // the reset-password deep link that was emailed to them.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  };

  return (
    <Screen>
      <Text style={styles.title}>Set a new password</Text>
      {route.params?.email ? <Text style={styles.subtitle}>for {route.params.email}</Text> : null}

      {done ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={styles.subtitle}>Your password has been updated.</Text>
          <PrimaryButton title="Log in" onPress={() => navigation.replace('Login')} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          <Input label="New password" secureTextEntry value={password} onChangeText={setPassword} />
          <Input
            label="Confirm new password"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="Update password" onPress={onSubmit} loading={loading} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 24, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  error: { color: colors.danger, ...typography.caption, marginBottom: spacing.sm },
});

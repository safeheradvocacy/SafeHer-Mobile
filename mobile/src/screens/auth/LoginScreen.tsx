import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { Input, PasswordInput, PrimaryButton, Screen, AlertMessage } from '../../components/ui';
import { LogoMark } from '../../components/branding/LogoMark';
import { colors, spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Login'>>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setLoading(false);
    if (signInError) setError(signInError);
    // On success, RootNavigator swaps to AppNavigator automatically because
    // `session` changes in AuthContext — no manual navigation needed here.
  };

  return (
    <Screen>
      <View style={styles.logoRow}>
        <LogoMark size={48} />
      </View>
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Log in to continue to SafeHer.</Text>

      <View style={{ marginTop: spacing.lg }}>
        <Input
          label="Email"
          icon="mail-outline"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />
        <PasswordInput label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" />

        {error ? <AlertMessage variant="error" title="Couldn't log in" message={error} /> : null}

        <PrimaryButton title="Log in" onPress={onSubmit} loading={loading} />

        <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ marginTop: spacing.md }}>
          <Text style={styles.link}>Forgot your password?</Text>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Register')} style={{ marginTop: spacing.lg }}>
          <Text style={styles.footerText}>
            Don't have an account? <Text style={styles.link}>Create one</Text>
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoRow: { marginBottom: spacing.md },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  link: { color: colors.primary, ...typography.bodyMedium },
  footerText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

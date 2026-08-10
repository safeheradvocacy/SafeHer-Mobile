import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { BackButton } from '../../components/auth/BackButton';
import { AuthTextInput } from '../../components/auth/AuthTextInput';
import { PasswordInput } from '../../components/auth/PasswordInput';
import { CheckboxRow } from '../../components/auth/CheckboxRow';
import { GradientButton } from '../../components/auth/GradientButton';
import { SecondaryButton } from '../../components/auth/SecondaryButton';
import { TextButton } from '../../components/auth/TextButton';
import { OrDivider } from '../../components/auth/OrDivider';
import { PrivacyNotice } from '../../components/auth/PrivacyNotice';
import { colors, spacing, typography } from '../../constants/theme';
import { signIn, getRememberedEmail } from '../../services/authService';
import { validateLoginForm, hasErrors, type FieldErrors } from '../../utils/validation';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    getRememberedEmail().then((savedEmail) => {
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    });
  }, []);

  const handleLogin = async () => {
    const fieldErrors = validateLoginForm(email, password);
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) return;

    setIsSubmitting(true);
    const result = await signIn({ email, password, rememberMe });
    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }
    // On success, onAuthStateChange in AuthProvider updates global state and
    // the root navigator (see App.tsx) swaps to the authenticated stack.
  };

  return (
    <ScreenContainer>
      <BackButton onPress={() => navigation.goBack()} />

      <View style={styles.header}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in securely to continue.</Text>
      </View>

      <View style={styles.form}>
        <AuthTextInput
          icon="mail-outline"
          placeholder="Email Address"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          error={errors.email}
          testID="login-email"
        />

        <View style={styles.fieldSpacing}>
          <PasswordInput
            placeholder="Password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            error={errors.password}
            testID="login-password"
          />
        </View>

        <View style={styles.optionsRow}>
          <CheckboxRow checked={rememberMe} onToggle={setRememberMe} testID="login-remember-me">
            Remember Me
          </CheckboxRow>
          <TextButton label="Forgot Password?" onPress={() => navigation.navigate('ForgotPassword')} />
        </View>

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <GradientButton
          label="Login"
          onPress={handleLogin}
          loading={isSubmitting}
          style={styles.loginButton}
          testID="login-submit"
        />

        <OrDivider />

        <SecondaryButton
          label="Create Account"
          icon="person-add-outline"
          onPress={() => navigation.navigate('CreateAccount')}
          testID="login-create-account"
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
  title: { ...typography.headlineLg, fontSize: 28, color: colors.primary, marginBottom: 8 },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  form: { flex: 1 },
  fieldSpacing: { marginTop: spacing.stackMd },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.stackMd,
  },
  formError: { ...typography.bodySm, color: colors.error, marginTop: spacing.stackMd, textAlign: 'center' },
  loginButton: { marginTop: spacing.stackLg },
  footer: { paddingVertical: spacing.stackLg },
});

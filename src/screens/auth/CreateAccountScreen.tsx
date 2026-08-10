import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { BackButton } from '../../components/auth/BackButton';
import { AuthTextInput } from '../../components/auth/AuthTextInput';
import { PasswordInput } from '../../components/auth/PasswordInput';
import { PasswordStrengthMeter } from '../../components/auth/PasswordStrengthMeter';
import { MunicipalityPicker } from '../../components/auth/MunicipalityPicker';
import { CheckboxRow } from '../../components/auth/CheckboxRow';
import { GradientButton } from '../../components/auth/GradientButton';
import { TextButton } from '../../components/auth/TextButton';
import { colors, spacing, typography } from '../../constants/theme';
import { signUp } from '../../services/authService';
import { validateCreateAccountForm, hasErrors, type FieldErrors } from '../../utils/validation';
import type { AuthStackParamList } from '../../navigation/types';
import type { Municipality } from '../../types/auth.types';

type Props = NativeStackScreenProps<AuthStackParamList, 'CreateAccount'>;

export function CreateAccountScreen({ navigation }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearError = (field: string) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const handleSubmit = async () => {
    const fieldErrors = validateCreateAccountForm({
      firstName,
      lastName,
      email,
      phoneNumber,
      municipalityId: municipality?.municipality_id ?? '',
      password,
      confirmPassword,
      agreedToTerms,
    });
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) return;

    setIsSubmitting(true);
    const result = await signUp({
      firstName,
      lastName,
      email,
      phoneNumber,
      municipalityId: municipality!.municipality_id,
      password,
    });
    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    navigation.replace('RegistrationSuccess');
  };

  return (
    <ScreenContainer>
      <BackButton onPress={() => navigation.goBack()} />

      <View style={styles.header}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join SafeHer today.</Text>
      </View>

      <View style={styles.form}>
        <AuthTextInput
          icon="person-outline"
          placeholder="First Name"
          value={firstName}
          onChangeText={(text) => {
            setFirstName(text);
            clearError('firstName');
          }}
          error={errors.firstName}
          testID="signup-first-name"
        />

        <View style={styles.fieldSpacing}>
          <AuthTextInput
            icon="person-outline"
            placeholder="Last Name"
            value={lastName}
            onChangeText={(text) => {
              setLastName(text);
              clearError('lastName');
            }}
            error={errors.lastName}
            testID="signup-last-name"
          />
        </View>

        <View style={styles.fieldSpacing}>
          <AuthTextInput
            icon="mail-outline"
            placeholder="Email Address"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              clearError('email');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            error={errors.email}
            testID="signup-email"
          />
        </View>

        <View style={styles.fieldSpacing}>
          <AuthTextInput
            icon="call-outline"
            placeholder="Phone Number"
            value={phoneNumber}
            onChangeText={(text) => {
              setPhoneNumber(text);
              clearError('phoneNumber');
            }}
            keyboardType="phone-pad"
            error={errors.phoneNumber}
            testID="signup-phone"
          />
        </View>

        <View style={styles.fieldSpacing}>
          <MunicipalityPicker
            value={municipality?.municipality_id ?? null}
            onChange={(next) => {
              setMunicipality(next);
              clearError('municipalityId');
            }}
            error={errors.municipalityId}
          />
        </View>

        <View style={styles.fieldSpacing}>
          <PasswordInput
            placeholder="Password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              clearError('password');
            }}
            error={errors.password}
            testID="signup-password"
          />
          <PasswordStrengthMeter password={password} />
        </View>

        <View style={styles.fieldSpacing}>
          <PasswordInput
            placeholder="Confirm Password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              clearError('confirmPassword');
            }}
            error={errors.confirmPassword}
            testID="signup-confirm-password"
          />
        </View>

        <View style={styles.termsRow}>
          <CheckboxRow checked={agreedToTerms} onToggle={setAgreedToTerms} error={errors.agreedToTerms} testID="signup-terms">
            I agree to the <Text style={styles.link}>Privacy Policy</Text> and{' '}
            <Text style={styles.link}>Terms & Conditions</Text>.
          </CheckboxRow>
        </View>

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <GradientButton
          label="Create Account"
          onPress={handleSubmit}
          loading={isSubmitting}
          style={styles.submitButton}
          testID="signup-submit"
        />

        <View style={styles.signInRow}>
          <Text style={styles.signInText}>Already have an account? </Text>
          <TextButton label="Sign In" onPress={() => navigation.navigate('Login')} />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.stackMd, marginBottom: spacing.stackLg },
  title: { ...typography.headlineLg, fontSize: 26, color: colors.primary, marginBottom: 8 },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  form: { paddingBottom: spacing.stackLg },
  fieldSpacing: { marginTop: spacing.stackMd },
  termsRow: { marginTop: spacing.stackLg },
  link: { color: colors.primary, ...typography.labelSm, fontSize: 14 },
  formError: { ...typography.bodySm, color: colors.error, marginTop: spacing.stackMd, textAlign: 'center' },
  submitButton: { marginTop: spacing.stackLg },
  signInRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.stackMd },
  signInText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});

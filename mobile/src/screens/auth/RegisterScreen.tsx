import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Input,
  PasswordInput,
  PrimaryButton,
  Screen,
  SectionHeader,
  DropdownInput,
  AlertMessage,
  PrivacyNotice,
} from '../../components/ui';
import { LogoMark } from '../../components/branding/LogoMark';
import { colors, spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';
import type { Municipality } from '../../types/database.types';

type MunicipalityState = 'loading' | 'success' | 'empty' | 'error';

export function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Register'>>();
  const { signUp } = useAuth();

  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityState, setMunicipalityState] = useState<MunicipalityState>('loading');
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadMunicipalities = useCallback(async () => {
    setMunicipalityState('loading');
    // Reads from the EXISTING, already-populated municipalities table —
    // never inserted or seeded by this app.
    const { data, error: fetchErr } = await supabase
      .from('municipalities')
      .select('*')
      .eq('is_active', true)
      .order('municipality_name');

    if (fetchErr) {
      setMunicipalityState('error');
      return;
    }
    if (!data || data.length === 0) {
      setMunicipalities([]);
      setMunicipalityState('empty');
      return;
    }
    setMunicipalities(data);
    setMunicipalityState('success');
  }, []);

  useEffect(() => {
    loadMunicipalities();
  }, [loadMunicipalities]);

  const onSubmit = async () => {
    if (!firstName || !lastName || !email || !password || !municipalityId) {
      setError('Please fill in all required fields and select your municipality.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: signUpError } = await signUp({
      email: email.trim(),
      password,
      firstName,
      lastName,
      phoneNumber,
      municipalityId,
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError);
      return;
    }
    navigation.replace('RegistrationSuccess');
  };

  return (
    <Screen>
      <View style={styles.logoRow}>
        <LogoMark size={48} />
      </View>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>Your information is confidential and accessible only to authorized staff.</Text>

      <View style={{ marginTop: spacing.lg }}>
        <SectionHeader title="Personal Information" />
        <Input label="First name *" icon="person-outline" value={firstName} onChangeText={setFirstName} />
        <Input label="Last name *" icon="person-outline" value={lastName} onChangeText={setLastName} />
        <Input
          label="Phone number"
          icon="call-outline"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
        />

        <Text style={styles.inputLabel}>Municipality *</Text>
        {municipalityState === 'loading' && (
          <View style={styles.muniLoadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.muniLoadingText}>Loading municipalities...</Text>
          </View>
        )}
        {municipalityState === 'success' && (
          <DropdownInput
            placeholder="Select municipality"
            value={municipalityId}
            options={municipalities.map((m) => ({ label: m.municipality_name, value: m.municipality_id }))}
            onSelect={setMunicipalityId}
          />
        )}
        {municipalityState === 'empty' && (
          <AlertMessage
            variant="info"
            title="No municipalities available"
            message="There are no municipalities set up yet. Please check back later."
          />
        )}
        {municipalityState === 'error' && (
          <AlertMessage
            variant="error"
            title="Unable to load municipalities"
            message="Check your connection and try again."
            onRetry={loadMunicipalities}
          />
        )}

        <SectionHeader title="Account Information" />
        <Input
          label="Email *"
          icon="mail-outline"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <PasswordInput label="Password *" value={password} onChangeText={setPassword} showStrength />
        <PasswordInput label="Confirm password *" value={confirmPassword} onChangeText={setConfirmPassword} />

        <PrivacyNotice
          heading="Your privacy matters"
          text="Your information is encrypted and accessible only to authorized SafeHer staff within your municipality."
        />

        {error ? <AlertMessage variant="error" title="Couldn't create your account" message={error} /> : null}

        <PrimaryButton title="Create account" onPress={onSubmit} loading={loading} />

        <Pressable onPress={() => navigation.navigate('Login')} style={{ marginTop: spacing.lg }}>
          <Text style={styles.footerText}>
            Already have an account? <Text style={styles.link}>Log in</Text>
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoRow: { marginBottom: spacing.md },
  title: { ...typography.display, fontSize: 24, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  inputLabel: { ...typography.bodyMedium, color: colors.text, marginBottom: spacing.xs },
  link: { color: colors.primary, ...typography.bodyMedium },
  footerText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  muniLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  muniLoadingText: { ...typography.body, color: colors.textMuted, marginLeft: spacing.sm },
});

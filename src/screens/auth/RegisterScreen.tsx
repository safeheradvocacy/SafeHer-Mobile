import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import PasswordStrengthIndicator from '../../components/common/PasswordStrengthIndicator';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabase';
import { validateEmail, validatePassword, validatePhone, validateName } from '../../utils/validation';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import { Municipality } from '../../types';

const RegisterScreen = () => {
  const navigation = useNavigation();
  const { signUp, signOut } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [municipalityId, setMunicipalityId] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [showMunicipalityPicker, setShowMunicipalityPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchMunicipalities();
  }, []);

  const fetchMunicipalities = async () => {
    const { data, error } = await supabase
      .from('municipalities')
      .select('*')
      .eq('is_active', true)
      .order('municipality_name');
    if (error) {
      console.error('Error fetching municipalities:', error);
    } else {
      setMunicipalities(data || []);
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!validateName(firstName)) newErrors.firstName = 'First name is required';
    if (!validateName(lastName)) newErrors.lastName = 'Last name is required';
    if (!email) newErrors.email = 'Email is required';
    else if (!validateEmail(email.trim())) newErrors.email = 'Invalid email';
    if (!phone) newErrors.phone = 'Phone number is required';
    else if (!validatePhone(phone)) newErrors.phone = 'Invalid phone number';
    if (!municipalityId) newErrors.municipality = 'Please select a municipality';
    if (!password) newErrors.password = 'Password is required';
    else if (!validatePassword(password)) newErrors.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    if (!agreeTerms) newErrors.terms = 'You must agree to the Terms and Privacy Policy';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    const trimmedEmail = email.trim();
    try {
      const userData = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phone.trim(),
        municipality_id: municipalityId,
        role: 'survivor', // default role
      };
      const { user } = await signUp(trimmedEmail, password, userData);

      if (user) {
        try {
          const { error: profileError } = await supabase
            .from('user_profiles')
            .insert([
              {
                auth_user_id: user.id,
                municipality_id: municipalityId,
                role: 'survivor',
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                phone_number: phone.trim(),
                is_active: true,
              },
            ]);
          if (profileError) throw profileError;
        } catch (profileError) {
          // The auth account was created but the profile row wasn't. Sign
          // back out so the app doesn't leave the person "logged in" with
          // no profile — later modules assume a user_profiles row exists
          // for any signed-in user.
          await signOut().catch(() => {});
          throw new Error(
            "Your account was created, but we couldn't finish setting up your profile. " +
              'Please try signing in — if this keeps happening, contact support.'
          );
        }
      }

      // Navigate to success screen
      navigation.replace('RegistrationSuccess');
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const navigateToLogin = () => navigation.navigate('Login');

  const selectedMunicipalityName = municipalities.find(m => m.municipality_id === municipalityId)?.municipality_name || 'Select Municipality';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={Colors.primary} />
        </TouchableOpacity>

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join SafeHer today.</Text>

        <View style={styles.form}>
          <Input
            icon="person"
            placeholder="First Name"
            value={firstName}
            onChangeText={setFirstName}
            autoComplete="given-name"
            textContentType="givenName"
            error={errors.firstName}
          />
          <Input
            icon="person"
            placeholder="Last Name"
            value={lastName}
            onChangeText={setLastName}
            autoComplete="family-name"
            textContentType="familyName"
            error={errors.lastName}
          />
          <Input
            icon="mail"
            placeholder="Email Address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            error={errors.email}
          />
          <Input
            icon="call"
            placeholder="Phone Number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            error={errors.phone}
          />

          {/* Municipality Dropdown */}
          <TouchableOpacity
            style={[styles.dropdown, errors.municipality && styles.dropdownError]}
            onPress={() => setShowMunicipalityPicker(!showMunicipalityPicker)}
          >
            <Icon name="location-city" size={24} color={Colors.outline} style={styles.dropdownIcon} />
            <Text style={[styles.dropdownText, !municipalityId && styles.placeholderText]}>
              {selectedMunicipalityName}
            </Text>
            <Icon name="expand-more" size={24} color={Colors.outline} />
          </TouchableOpacity>
          {showMunicipalityPicker && (
            <View style={styles.pickerContainer}>
              {municipalities.map((item) => (
                <TouchableOpacity
                  key={item.municipality_id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setMunicipalityId(item.municipality_id);
                    setShowMunicipalityPicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{item.municipality_name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {errors.municipality && <Text style={styles.errorText}>{errors.municipality}</Text>}

          <Input
            icon="lock"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
            error={errors.password}
          />
          <PasswordStrengthIndicator password={password} />

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

          <View style={styles.termsContainer}>
            <Checkbox checked={agreeTerms} onToggle={() => setAgreeTerms(!agreeTerms)} />
            <Text style={styles.termsText}>
              I agree to the <Text style={styles.termsLink}>Privacy Policy</Text> and{' '}
              <Text style={styles.termsLink}>Terms &amp; Conditions</Text>.
            </Text>
          </View>
          {errors.terms && <Text style={styles.errorText}>{errors.terms}</Text>}

          <Button title="Create Account" onPress={handleRegister} loading={loading} style={styles.registerButton} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Text style={styles.footerLink} onPress={navigateToLogin}>
              Sign In
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: Spacing.marginMobile,
    paddingBottom: Spacing.sectionPadding,
  },
  backButton: {
    paddingVertical: 16,
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
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: 16,
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  dropdownError: {
    borderColor: Colors.error,
  },
  dropdownIcon: {
    marginRight: 12,
  },
  dropdownText: {
    flex: 1,
    ...Typography.bodyMD,
    color: Colors.onSurface,
  },
  placeholderText: {
    color: Colors.outline,
  },
  pickerContainer: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    maxHeight: 150,
    overflow: 'scroll',
  },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  pickerItemText: {
    ...Typography.bodyMD,
    color: Colors.onSurface,
  },
  errorText: {
    ...Typography.labelSM,
    color: Colors.error,
    marginTop: 4,
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  termsText: {
    ...Typography.bodySM,
    color: Colors.onSurfaceVariant,
    flex: 1,
  },
  termsLink: {
    color: Colors.primary,
    fontWeight: '500',
  },
  registerButton: {
    marginTop: 8,
  },
  footer: {
    marginTop: Spacing.stackLG,
    alignItems: 'center',
  },
  footerText: {
    ...Typography.bodySM,
    color: Colors.onSurfaceVariant,
  },
  footerLink: {
    color: Colors.primary,
    fontWeight: '600',
  },
});

export default RegisterScreen;

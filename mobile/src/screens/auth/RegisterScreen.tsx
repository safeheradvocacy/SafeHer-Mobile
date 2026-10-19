import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Input,
  PasswordInput,
  PrimaryButton,
  Screen,
  AlertMessage,
  PrivacyNotice,
  FadeInUp,
  useReducedMotion,
  DropdownInput,
} from '../../components/ui';
import { AuthHeader } from '../../components/auth/AuthHeader';
import { LogoMark } from '../../components/branding/LogoMark';
import { MunicipalityPicker, MunicipalityLoadState } from '../../components/MunicipalityPicker';
import { BarangayPicker } from '../../components/BarangayPicker';
import { LocationMapPicker, type LocationPickerResult } from '../../components/LocationMapPicker';
import { SettingsSheet } from '../../components/SettingsSheet';
import { useTheme } from '../../contexts/ThemeContext';
import { getRegisterStrings, getSettingsTitle } from './authContent';
import { spacing, typography, radius } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';
import type { Gender, Municipality } from '../../types/database.types';
import {
  SEX_OPTIONS,
  EDUCATIONAL_ATTAINMENT_OPTIONS,
  MONTH_OPTIONS,
  getYearOptions,
  getDayOptions,
  composeIsoDate,
  validateDateOfBirth,
} from '../../lib/survivorInfo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fade + slight horizontal slide between wizard steps — direction
 * signals whether we're moving forward or back so the motion reads as
 * spatial navigation rather than a generic fade. Force-remounted via a
 * `key` on the step index at the call site so the shared values reset
 * per step instead of animating from wherever the previous step left
 * off. Reduce Motion keeps the fade but drops the horizontal shift. */
function StepTransition({ direction, reduced, children }: { direction: 'forward' | 'back'; reduced: boolean; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(reduced ? 0 : direction === 'forward' ? 18 : -18);
  useEffect(() => {
    if (reduced) {
      opacity.value = withTiming(1, { duration: 180 });
      return;
    }
    opacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    translateX.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: translateX.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function ProgressDots({ step, stepTitles }: { step: number; stepTitles: [string, string, string, string] }) {
  const { palette } = useTheme();
  return (
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${stepTitles.length}: ${stepTitles[step]}`}
      accessibilityValue={{ min: 1, max: stepTitles.length, now: step + 1 }}
    >
      {stepTitles.map((_, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={[styles.progressLine, { backgroundColor: i <= step ? palette.primary : palette.border }]} /> : null}
          <View style={[styles.progressDot, { backgroundColor: i <= step ? palette.primary : palette.border }]} />
        </React.Fragment>
      ))}
    </View>
  );
}

function ConsentCheckbox({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      style={styles.consentRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, { borderColor: palette.border }, checked ? { backgroundColor: palette.primary, borderColor: palette.primary } : null]}>
        {checked ? <Ionicons name="checkmark" size={14} color={palette.white} /> : null}
      </View>
      <Text style={[styles.consentText, { color: palette.textMuted }]}>{children}</Text>
    </Pressable>
  );
}

function ReviewRow({ label, value, onEdit, editLabel, last }: { label: string; value: string; onEdit: () => void; editLabel: string; last?: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.reviewRow, { borderBottomColor: palette.border }, last ? { borderBottomWidth: 0 } : null]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.reviewLabel, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[styles.reviewValue, { color: palette.text }]}>{value}</Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${editLabel} ${label}`}>
        <Text style={[styles.editLink, { color: palette.primary }]}>{editLabel}</Text>
      </Pressable>
    </View>
  );
}

export function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Register'>>();
  const { signUp } = useAuth();
  const systemReducedMotion = useReducedMotion();
  const { palette, prefs } = useTheme();
  const reduced = systemReducedMotion || prefs.reduceMotion;
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.1 : 1;
  const strings = useMemo(() => getRegisterStrings(prefs.language), [prefs.language]);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [showSettings, setShowSettings] = useState(false);
  const [showMunicipalityPicker, setShowMunicipalityPicker] = useState(false);
  const [showBarangayPicker, setShowBarangayPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityState, setMunicipalityState] = useState<MunicipalityLoadState>('loading');
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [barangayId, setBarangayId] = useState<string | null>(null);
  const [barangayName, setBarangayName] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [purokSitio, setPurokSitio] = useState('');
  const [mapResult, setMapResult] = useState<LocationPickerResult | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dobYear, setDobYear] = useState<string | null>(null);
  const [dobMonth, setDobMonth] = useState<string | null>(null);
  const [dobDay, setDobDay] = useState<string | null>(null);
  const [sex, setSex] = useState<Gender | ''>('');
  const [educAttainment, setEducAttainment] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [consent, setConsent] = useState(false);

  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadMunicipalities = useCallback(async () => {
    setMunicipalityState('loading');
    try {
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
    } catch (e) {
      console.error('[RegisterScreen] loadMunicipalities:', e);
      setMunicipalityState('error');
    }
  }, []);

  useEffect(() => {
    loadMunicipalities();
  }, [loadMunicipalities]);

  const municipalityName = useMemo(
    () => municipalities.find((m) => m.municipality_id === municipalityId)?.municipality_name ?? '',
    [municipalities, municipalityId]
  );

  const emailValid = !emailTouched || !email || EMAIL_RE.test(email);
  const confirmMatches = confirmPassword.length > 0 ? confirmPassword === password : null;

  const yearOptions = useMemo(() => getYearOptions(), []);
  const dayOptions = useMemo(() => getDayOptions(dobYear, dobMonth), [dobYear, dobMonth]);
  // Re-clamp the day if switching to a shorter month/year leaves the
  // previously-picked day impossible (e.g. day 31 after switching from
  // January to April) — the dropdown rebuilds anyway, this just keeps
  // the stored value consistent with what's actually selectable.
  useEffect(() => {
    if (dobDay && !dayOptions.some((d) => d.value === dobDay)) setDobDay(null);
  }, [dayOptions, dobDay]);

  const goToStep = (target: number) => {
    setStepError(null);
    setDirection(target > step ? 'forward' : 'back');
    setStep(target);
  };

  const onBack = () => {
    if (step === 0) {
      navigation.goBack();
      return;
    }
    goToStep(step - 1);
  };

  const onContinueStep0 = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setStepError(strings.pleaseEnterNames);
      return;
    }
    if (!municipalityId) {
      setStepError(strings.pleaseSelectMunicipality);
      return;
    }
    if (!barangayId) {
      setStepError(strings.pleaseSelectBarangay);
      return;
    }
    if (!streetAddress.trim()) {
      setStepError(strings.pleaseEnterStreet);
      return;
    }
    goToStep(1);
  };

  // Survivor Information — required at registration (previously only
  // ever collected from Profile, optionally). Each check reports
  // exactly which field is missing rather than one generic error, and
  // nothing already entered is cleared on a failed attempt — the form
  // state (dobYear/dobMonth/dobDay/sex/educAttainment) is untouched.
  const onContinueStep1 = () => {
    if (!dobYear || !dobMonth || !dobDay) {
      setStepError(strings.pleaseSelectDateOfBirth);
      return;
    }
    const dobCheck = validateDateOfBirth(composeIsoDate(dobYear, dobMonth, dobDay));
    if (!dobCheck.valid) {
      setStepError(dobCheck.error);
      return;
    }
    if (!sex) {
      setStepError(strings.pleaseSelectSex);
      return;
    }
    if (!educAttainment) {
      setStepError(strings.pleaseSelectEducationalAttainment);
      return;
    }
    goToStep(2);
  };

  const onContinueStep2 = () => {
    if (!email.trim() || !EMAIL_RE.test(email)) {
      setEmailTouched(true);
      setStepError(strings.emailInvalid);
      return;
    }
    if (password.length < 8) {
      setStepError(strings.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setStepError(strings.passwordsMismatch);
      return;
    }
    goToStep(3);
  };

  const onSubmit = async () => {
    if (!consent) {
      setStepError(strings.pleaseAgree);
      return;
    }
    setStepError(null);
    setSubmitError(null);
    setLoading(true);
    const { error: signUpError } = await signUp({
      email: email.trim(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phoneNumber,
      municipalityId: municipalityId as string,
      barangayId: barangayId as string,
      streetAddress: streetAddress.trim(),
      purokSitio: purokSitio.trim() || undefined,
      latitude: mapResult?.latitude,
      longitude: mapResult?.longitude,
      formattedAddress: mapResult?.formattedAddress ?? undefined,
      locationSource: mapResult?.source,
    });
    setLoading(false);
    if (signUpError) {
      setSubmitError(signUpError);
      return;
    }
    // Survivor demographics aren't part of signUp()'s metadata — the
    // on_auth_user_created trigger isn't touched by this feature, and
    // signUp() returns no session (email confirmation is required), so
    // there's no authenticated context to write `survivors` from here
    // anyway. Carried through as a nav param instead and written once
    // email verification actually establishes a session — see
    // EmailVerificationScreen.
    navigation.replace('EmailVerification', {
      email: email.trim(),
      survivorInfo: {
        dateOfBirth: composeIsoDate(dobYear as string, dobMonth as string, dobDay as string),
        gender: sex,
        educationalAttainment: educAttainment,
      },
    });
  };

  return (
    <Screen>
      <AuthHeader onBack={onBack} onSettings={() => setShowSettings(true)} />
      <ProgressDots step={step} stepTitles={strings.stepTitles} />

      <StepTransition key={step} direction={direction} reduced={reduced}>
        {step === 0 ? (
          <View>
            <FadeInUp reduced={reduced}>
              <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
                <LogoMark size="lg" />
              </View>
              <Text style={[styles.title, { color: palette.text, fontSize: 22 * titleFontScale }]}>{strings.step0Title}</Text>
              <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.stepTitles[0]}</Text>
            </FadeInUp>

            <View style={{ marginTop: spacing.lg }}>
              <FadeInUp reduced={reduced} delay={60}>
                <Input label={strings.firstNameLabel} icon="person-outline" value={firstName} onChangeText={setFirstName} />
              </FadeInUp>
              <FadeInUp reduced={reduced} delay={100}>
                <Input label={strings.lastNameLabel} icon="person-outline" value={lastName} onChangeText={setLastName} />
              </FadeInUp>
              <FadeInUp reduced={reduced} delay={140}>
                <Input
                  label={strings.phoneLabel}
                  icon="call-outline"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  keyboardType="phone-pad"
                  placeholder="09XX XXX XXXX"
                />
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={180}>
                <Text style={[styles.inputLabel, { color: palette.text }]}>{strings.municipalityLabel}</Text>
                {municipalityState === 'loading' ? (
                  <View style={styles.muniLoadingRow}>
                    <Text style={[styles.muniLoadingText, { color: bodyColor }]}>{strings.municipalityLoading}</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setShowMunicipalityPicker(true)}
                    style={[styles.muniTrigger, { borderColor: palette.border, backgroundColor: palette.surface }]}
                    accessibilityRole="button"
                    accessibilityLabel={strings.municipalityLabel}
                    accessibilityHint="Opens the municipality picker"
                  >
                    <Text style={[styles.muniValue, { color: municipalityName ? palette.text : palette.textMuted }]} numberOfLines={1}>
                      {municipalityName || strings.municipalitySelectPlaceholder}
                    </Text>
                    <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                  </Pressable>
                )}
                {municipalityState === 'error' ? (
                  <AlertMessage variant="error" title={strings.municipalityErrorTitle} message={strings.municipalityErrorMsg} onRetry={loadMunicipalities} />
                ) : null}
                {municipalityState === 'empty' ? (
                  <AlertMessage variant="info" title={strings.municipalityEmptyTitle} message={strings.municipalityEmptyMsg} />
                ) : null}
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={200}>
                <Text style={[styles.inputLabel, { color: palette.text }]}>{strings.barangayLabel}</Text>
                <Pressable
                  onPress={() => municipalityId && setShowBarangayPicker(true)}
                  disabled={!municipalityId}
                  style={[styles.muniTrigger, { borderColor: palette.border, backgroundColor: palette.surface }, !municipalityId ? { opacity: 0.5 } : null]}
                  accessibilityRole="button"
                  accessibilityLabel={strings.barangayLabel}
                  accessibilityHint="Opens the barangay picker"
                >
                  <Text style={[styles.muniValue, { color: barangayName ? palette.text : palette.textMuted }]} numberOfLines={1}>
                    {barangayName || strings.barangaySelectPlaceholder}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                </Pressable>
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={210}>
                <Input label={strings.streetLabel} icon="home-outline" value={streetAddress} onChangeText={setStreetAddress} />
              </FadeInUp>
              <FadeInUp reduced={reduced} delay={215}>
                <Input label={strings.purokLabel} icon="location-outline" value={purokSitio} onChangeText={setPurokSitio} />
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={218}>
                <Text style={[styles.inputLabel, { color: palette.text }]}>{strings.mapSectionTitle}</Text>
                <Text style={[styles.muniLoadingText, { color: bodyColor, marginBottom: spacing.sm }]}>{strings.mapSectionBody}</Text>
                <Pressable
                  onPress={() => setShowLocationPicker(true)}
                  style={[styles.muniTrigger, { borderColor: palette.border, backgroundColor: palette.surface }]}
                  accessibilityRole="button"
                  accessibilityLabel={mapResult ? strings.editLocationBtn : strings.setLocationBtn}
                >
                  <Text style={[styles.muniValue, { color: mapResult ? palette.text : palette.textMuted }]} numberOfLines={1}>
                    {mapResult ? (mapResult.formattedAddress ?? strings.locationSetLabel) : strings.setLocationBtn}
                  </Text>
                  <Ionicons name={mapResult ? 'pencil-outline' : 'map-outline'} size={18} color={palette.textMuted} />
                </Pressable>
              </FadeInUp>

              {stepError ? <AlertMessage variant="error" title={strings.checkFieldsTitle} message={stepError} /> : null}

              <FadeInUp reduced={reduced} delay={220}>
                <PrimaryButton title={strings.continueBtn} onPress={onContinueStep0} reduced={reduced} />
              </FadeInUp>
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View>
            <FadeInUp reduced={reduced}>
              <Text style={[styles.title, { color: palette.text, fontSize: 22 * titleFontScale }]}>{strings.step1Title}</Text>
              <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.survivorInfoIntro}</Text>
            </FadeInUp>

            <View style={{ marginTop: spacing.lg }}>
              <FadeInUp reduced={reduced} delay={60}>
                <Text style={[styles.inputLabel, { color: palette.text }]}>{strings.dateOfBirthLabel}</Text>
                <View style={styles.dobRow}>
                  <View style={{ flex: 1 }}>
                    <DropdownInput placeholder={strings.monthPlaceholder} value={dobMonth} options={MONTH_OPTIONS} onSelect={setDobMonth} />
                  </View>
                  <View style={{ flex: 0.7 }}>
                    <DropdownInput placeholder={strings.dayPlaceholder} value={dobDay} options={dayOptions} onSelect={setDobDay} />
                  </View>
                  <View style={{ flex: 0.9 }}>
                    <DropdownInput placeholder={strings.yearPlaceholder} value={dobYear} options={yearOptions} onSelect={setDobYear} />
                  </View>
                </View>
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={100}>
                <DropdownInput
                  label={strings.sexLabel}
                  placeholder={strings.sexPlaceholder}
                  value={sex || null}
                  options={SEX_OPTIONS.map((g) => ({ label: g, value: g }))}
                  onSelect={(v) => setSex(v as Gender)}
                />
              </FadeInUp>

              <FadeInUp reduced={reduced} delay={140}>
                <DropdownInput
                  label={strings.educationalAttainmentLabel}
                  placeholder={strings.educationalAttainmentPlaceholder}
                  value={educAttainment || null}
                  options={EDUCATIONAL_ATTAINMENT_OPTIONS.map((o) => ({ label: o, value: o }))}
                  onSelect={setEducAttainment}
                />
              </FadeInUp>

              {stepError ? <AlertMessage variant="error" title={strings.checkFieldsTitle} message={stepError} /> : null}

              <FadeInUp reduced={reduced} delay={180}>
                <PrimaryButton title={strings.continueBtn} onPress={onContinueStep1} reduced={reduced} />
              </FadeInUp>
            </View>
          </View>
        ) : null}

        {step === 2 ? (
          <View>
            <FadeInUp reduced={reduced}>
              <Text style={[styles.title, { color: palette.text, fontSize: 22 * titleFontScale }]}>{strings.step2Title}</Text>
              <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.stepTitles[2]}</Text>
            </FadeInUp>

            <View style={{ marginTop: spacing.lg }}>
              <FadeInUp reduced={reduced} delay={60}>
                <Input
                  label={strings.emailLabel}
                  icon="mail-outline"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  onBlur={() => setEmailTouched(true)}
                  error={!emailValid ? strings.emailInvalid : undefined}
                />
              </FadeInUp>
              <FadeInUp reduced={reduced} delay={100}>
                <PasswordInput label={strings.passwordLabel} value={password} onChangeText={setPassword} showStrength />
              </FadeInUp>
              <FadeInUp reduced={reduced} delay={140}>
                <PasswordInput
                  label={strings.confirmPasswordLabel}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  error={confirmMatches === false ? strings.passwordsMismatch : undefined}
                />
                {confirmMatches ? (
                  <View style={styles.matchRow}>
                    <Ionicons name="checkmark-circle" size={14} color={palette.success} />
                    <Text style={[styles.matchText, { color: palette.success }]}>{strings.passwordsMatch}</Text>
                  </View>
                ) : null}
              </FadeInUp>

              {stepError ? <AlertMessage variant="error" title={strings.checkFieldsTitle} message={stepError} /> : null}

              <FadeInUp reduced={reduced} delay={180}>
                <PrimaryButton title={strings.continueBtn} onPress={onContinueStep2} reduced={reduced} />
              </FadeInUp>
            </View>
          </View>
        ) : null}

        {step === 3 ? (
          <View>
            <FadeInUp reduced={reduced}>
              <Text style={[styles.title, { color: palette.text, fontSize: 22 * titleFontScale }]}>{strings.step3Title}</Text>
              <Text style={[styles.subtitle, { color: bodyColor }]}>{strings.step3Subtitle}</Text>
            </FadeInUp>

            <FadeInUp reduced={reduced} delay={60} style={[styles.reviewCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <ReviewRow label={strings.reviewNameLabel} value={`${firstName} ${lastName}`.trim()} onEdit={() => goToStep(0)} editLabel={strings.editLink} />
              {phoneNumber ? <ReviewRow label={strings.reviewPhoneLabel} value={phoneNumber} onEdit={() => goToStep(0)} editLabel={strings.editLink} /> : null}
              <ReviewRow label={strings.reviewMunicipalityLabel} value={municipalityName} onEdit={() => goToStep(0)} editLabel={strings.editLink} />
              <ReviewRow label={strings.reviewBarangayLabel} value={barangayName} onEdit={() => goToStep(0)} editLabel={strings.editLink} />
              <ReviewRow
                label={strings.reviewAddressLabel}
                value={[streetAddress, purokSitio].filter(Boolean).join(', ')}
                onEdit={() => goToStep(0)}
                editLabel={strings.editLink}
              />
              <ReviewRow
                label={strings.reviewDateOfBirthLabel}
                value={dobYear && dobMonth && dobDay ? composeIsoDate(dobYear, dobMonth, dobDay) : ''}
                onEdit={() => goToStep(1)}
                editLabel={strings.editLink}
              />
              <ReviewRow label={strings.reviewSexLabel} value={sex} onEdit={() => goToStep(1)} editLabel={strings.editLink} />
              <ReviewRow label={strings.reviewEducationalAttainmentLabel} value={educAttainment} onEdit={() => goToStep(1)} editLabel={strings.editLink} />
              <ReviewRow label={strings.reviewEmailLabel} value={email} onEdit={() => goToStep(2)} editLabel={strings.editLink} last />
            </FadeInUp>

            <FadeInUp reduced={reduced} delay={110}>
              <PrivacyNotice heading={strings.privacyHeading} text={strings.privacyBody} />
            </FadeInUp>

            <FadeInUp reduced={reduced} delay={150}>
              <ConsentCheckbox checked={consent} onToggle={() => setConsent((c) => !c)}>
                {strings.consentPrefix}
                <Text
                  onPress={() => navigation.navigate('Terms')}
                  accessibilityRole="link"
                  accessibilityLabel="Open Terms and Conditions"
                  style={[styles.termsLink, { color: palette.primary }]}
                >
                  {strings.termsLinkText}
                </Text>
                {strings.consentSuffix}
              </ConsentCheckbox>
            </FadeInUp>

            {stepError ? <AlertMessage variant="error" title={strings.oneMoreThingTitle} message={stepError} /> : null}
            {submitError ? <AlertMessage variant="error" title={strings.couldntCreateTitle} message={submitError} /> : null}

            <FadeInUp reduced={reduced} delay={190}>
              <PrimaryButton title={strings.createAccountBtn} loadingTitle={strings.creatingAccount} onPress={onSubmit} loading={loading} reduced={reduced} />
            </FadeInUp>
          </View>
        ) : null}
      </StepTransition>

      {step === 0 ? (
        <FadeInUp reduced={reduced} delay={260}>
          <Pressable onPress={() => navigation.navigate('Login')} style={{ marginTop: spacing.lg }}>
            <Text style={[styles.footerText, { color: bodyColor }]}>
              {strings.alreadyHaveAccount}
              <Text style={[styles.link, { color: palette.primary }]}>{strings.logIn}</Text>
            </Text>
          </Pressable>
        </FadeInUp>
      ) : null}

      <MunicipalityPicker
        visible={showMunicipalityPicker}
        onClose={() => setShowMunicipalityPicker(false)}
        municipalities={municipalities}
        state={municipalityState}
        value={municipalityId}
        onSelect={(id) => {
          // Cascading-clear rule: changing the municipality invalidates
          // whatever barangay was previously selected (it may belong to
          // a different municipality entirely).
          setMunicipalityId(id);
          setBarangayId(null);
          setBarangayName('');
        }}
        onRetry={loadMunicipalities}
      />
      <BarangayPicker
        visible={showBarangayPicker}
        onClose={() => setShowBarangayPicker(false)}
        municipalityId={municipalityId}
        value={barangayId}
        onSelect={(id, name) => {
          setBarangayId(id);
          setBarangayName(name);
        }}
      />
      <LocationMapPicker
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        initialLatitude={mapResult?.latitude}
        initialLongitude={mapResult?.longitude}
        municipalityName={municipalityName}
        onConfirm={(result) => {
          setMapResult(result);
          setShowLocationPicker(false);
        }}
      />
      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={getSettingsTitle(prefs.language)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22 },
  subtitle: { ...typography.body, marginTop: spacing.xs },
  inputLabel: { ...typography.bodyMedium, marginBottom: spacing.xs },
  link: { ...typography.bodyMedium },
  footerText: { ...typography.body, textAlign: 'center' },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.xs },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressLine: { flex: 1, height: 2, marginHorizontal: 6 },

  muniLoadingRow: { paddingVertical: 12, marginBottom: spacing.md },
  muniLoadingText: { ...typography.body },
  muniTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  muniValue: { ...typography.body, flex: 1, marginRight: spacing.sm },
  dobRow: { flexDirection: 'row', gap: spacing.sm },

  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -spacing.sm, marginBottom: spacing.md },
  matchText: { ...typography.caption },

  reviewCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  reviewLabel: { ...typography.caption },
  reviewValue: { ...typography.bodyMedium, marginTop: 2 },
  editLink: { ...typography.bodyMedium, marginLeft: spacing.sm },

  consentRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md, marginBottom: spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 1,
  },
  consentText: { ...typography.caption, flex: 1, lineHeight: 18 },
  termsLink: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textDecorationLine: 'underline' },
});

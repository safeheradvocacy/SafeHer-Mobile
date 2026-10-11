import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { readFileAsArrayBuffer } from '../../lib/uploadFile';
import { Input, PrimaryButton, Screen, Card, StatusBadge, AlertMessage, DropdownInput } from '../../components/ui';
import { MunicipalityPicker, type MunicipalityLoadState } from '../../components/MunicipalityPicker';
import { BarangayPicker } from '../../components/BarangayPicker';
import { LocationMapPicker, type LocationPickerResult } from '../../components/LocationMapPicker';
import { SettingsSheet } from '../../components/SettingsSheet';
import { FirstVisitTip } from '../../components/FirstVisitTip';
import { useTheme } from '../../contexts/ThemeContext';
import { useTour } from '../../contexts/TourContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Gender, IdentityVerificationStatus, Municipality } from '../../types/database.types';
import {
  EDUCATIONAL_ATTAINMENT_OPTIONS,
  SEX_OPTIONS,
  MONTH_OPTIONS,
  validateDateOfBirth,
  getYearOptions,
  getDayOptions,
  composeIsoDate,
  parseIsoDate,
  isSurvivorInfoComplete,
} from '../../lib/survivorInfo';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const PH_PHONE_RE = /^(09\d{9}|\+639\d{9})$/;

function identityBadge(status: IdentityVerificationStatus): { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] } {
  switch (status) {
    case 'verified':
      return { label: 'Verified', icon: 'checkmark-circle' };
    case 'pending':
      return { label: 'Pending Review', icon: 'time-outline' };
    case 'rejected':
      return { label: 'Rejected', icon: 'close-circle-outline' };
    default:
      return { label: 'Not Verified', icon: 'alert-circle-outline' };
  }
}

// The public bucket's URL shape is always
// .../storage/v1/object/public/avatars/<path> — parsed back out so a
// successful replacement can clean up the file it's replacing, rather
// than leaking one orphaned file per photo change.
function avatarPathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = '/object/public/avatars/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'Profile'>>();
  const { palette } = useTheme();
  const { session, profile, survivor, refreshProfile, signOut } = useAuth();
  const { replay } = useTour();

  // The tour's spotlight targets (bottom-tab icons, the Report Incident
  // tile) only exist while Home is actually mounted — Profile is a
  // plain stack screen outside the Tab navigator, so replaying the tour
  // from here means going back to Home first, then starting once its
  // layout has settled and re-registered fresh target positions.
  const takeTour = () => {
    if (!profile) return;
    navigation.navigate('Tabs', { screen: 'HomeTab' });
    setTimeout(() => replay(profile.profile_id), 350);
  };

  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [emergencyName, setEmergencyName] = useState(survivor?.emergency_contact_name ?? '');
  const [emergencyNumber, setEmergencyNumber] = useState(survivor?.emergency_contact_number ?? '');
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const [savingEmergency, setSavingEmergency] = useState(false);

  // ---- Survivor Information: Date of Birth / Sex / Educational
  // Attainment — required at registration now (RegisterScreen), but
  // still fully editable here so an account can review/correct it, and
  // so an existing (pre-this-feature) account can complete it. All
  // three are independently saveable together, same as the Emergency
  // Contact card. Age is never stored or entered here — it is always
  // derived from date_of_birth, never the reverse. Same Year/Month/Day
  // dropdown picker as registration, not a typed date, so this edit can
  // never produce an impossible calendar date either.
  const initialDob = parseIsoDate(survivor?.date_of_birth);
  const [survivorEditMode, setSurvivorEditMode] = useState(false);
  const [dobYear, setDobYear] = useState<string | null>(initialDob.year || null);
  const [dobMonth, setDobMonth] = useState<string | null>(initialDob.month || null);
  const [dobDay, setDobDay] = useState<string | null>(initialDob.day || null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [sex, setSex] = useState<Gender | ''>(survivor?.gender ?? '');
  const [educAttainment, setEducAttainment] = useState(survivor?.educational_attainment ?? '');
  const [savingSurvivorInfo, setSavingSurvivorInfo] = useState(false);

  const yearOptions = useMemo(() => getYearOptions(), []);
  const dayOptions = useMemo(() => getDayOptions(dobYear, dobMonth), [dobYear, dobMonth]);
  useEffect(() => {
    if (dobDay && !dayOptions.some((d) => d.value === dobDay)) setDobDay(null);
  }, [dayOptions, dobDay]);

  const cancelSurvivorEdit = () => {
    const parsed = parseIsoDate(survivor?.date_of_birth);
    setDobYear(parsed.year || null);
    setDobMonth(parsed.month || null);
    setDobDay(parsed.day || null);
    setSex(survivor?.gender ?? '');
    setEducAttainment(survivor?.educational_attainment ?? '');
    setDobError(null);
    setSurvivorEditMode(false);
  };

  const [avatarState, setAvatarState] = useState<'idle' | 'uploading' | 'saving'>('idle');

  // ---- Registered address (module12) ----
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityState, setMunicipalityState] = useState<MunicipalityLoadState>('loading');
  const [showMunicipalityPicker, setShowMunicipalityPicker] = useState(false);
  const [showBarangayPicker, setShowBarangayPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [addrMunicipalityId, setAddrMunicipalityId] = useState<string | null>(survivor?.municipality_id ?? null);
  const [addrBarangayId, setAddrBarangayId] = useState<string | null>(survivor?.barangay_id ?? null);
  const [addrBarangayName, setAddrBarangayName] = useState('');
  const [streetAddress, setStreetAddress] = useState(survivor?.address ?? '');
  const [purokSitio, setPurokSitio] = useState(survivor?.purok_sitio ?? '');
  const [mapResult, setMapResult] = useState<LocationPickerResult | null>(
    survivor?.latitude != null && survivor?.longitude != null
      ? {
          latitude: survivor.latitude,
          longitude: survivor.longitude,
          formattedAddress: survivor.formatted_address,
          source: survivor.location_source ?? 'manually_confirmed',
        }
      : null
  );
  const [savingAddress, setSavingAddress] = useState(false);

  const addrMunicipalityName = municipalities.find((m) => m.municipality_id === addrMunicipalityId)?.municipality_name ?? '';

  const loadMunicipalitiesForAddress = () => {
    setMunicipalityState('loading');
    supabase
      .from('municipalities')
      .select('*')
      .eq('is_active', true)
      .order('municipality_name')
      .then(({ data, error }) => {
        if (error) {
          setMunicipalityState('error');
          return;
        }
        setMunicipalities(data ?? []);
        setMunicipalityState(data && data.length > 0 ? 'success' : 'empty');
      });
  };

  useEffect(() => {
    loadMunicipalitiesForAddress();
  }, []);

  useEffect(() => {
    if (!survivor?.barangay_id) return;
    supabase
      .from('barangays')
      .select('barangay_name')
      .eq('barangay_id', survivor.barangay_id)
      .single()
      .then(({ data }) => {
        if (data) setAddrBarangayName(data.barangay_name);
      });
  }, [survivor?.barangay_id]);

  const saveAddress = async () => {
    if (!survivor || !profile) return;
    if (!addrMunicipalityId || !addrBarangayId || !streetAddress.trim()) {
      Alert.alert('Missing information', 'Please select your municipality, barangay, and enter your house number or street.');
      return;
    }

    const doSave = async () => {
      setSavingAddress(true);
      const oldValues = { municipality_id: survivor.municipality_id, barangay_id: survivor.barangay_id, address: survivor.address };
      const { error } = await supabase
        .from('survivors')
        .update({
          municipality_id: addrMunicipalityId,
          barangay_id: addrBarangayId,
          address: streetAddress.trim(),
          purok_sitio: purokSitio.trim() || null,
          latitude: mapResult?.latitude ?? null,
          longitude: mapResult?.longitude ?? null,
          formatted_address: mapResult?.formattedAddress ?? null,
          location_source: mapResult?.source ?? null,
          address_updated_at: new Date().toISOString(),
        })
        .eq('survivor_id', survivor.survivor_id);
      setSavingAddress(false);
      if (error) {
        Alert.alert('Unable to save', 'Please try again.');
        return;
      }
      await logAudit({
        profileId: profile.profile_id,
        action: 'UPDATE',
        tableName: 'survivors',
        recordId: survivor.survivor_id,
        oldValues,
        newValues: { municipality_id: addrMunicipalityId, barangay_id: addrBarangayId, address: streetAddress.trim() },
      });
      await refreshProfile();
      Alert.alert('Saved', 'Your registered address has been updated.');
    };

    // Changing the registered municipality changes which office's staff
    // will handle future incident reports — worth a deliberate
    // confirmation, unlike the other address fields. Past reports are
    // never affected (case_reports.municipality_id is set once at
    // submission and is immutable — see module12).
    if (addrMunicipalityId !== survivor.municipality_id) {
      Alert.alert(
        'Change your registered municipality?',
        'This changes which office handles any incident reports you file after this change. Reports you already submitted are not affected.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: doSave },
        ]
      );
      return;
    }
    await doSave();
  };

  const emailVerified = !!session?.user?.email_confirmed_at;
  const identity = identityBadge(profile?.identity_verification_status ?? 'unverified');

  const choosePhoto = () => {
    if (avatarState !== 'idle') return;
    Alert.alert('Change photo', 'Choose how you want to update your profile photo.', [
      { text: 'Take Photo', onPress: () => pickAvatar('camera') },
      { text: 'Choose from Gallery', onPress: () => pickAvatar('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickAvatar = async (source: 'camera' | 'library') => {
    if (!profile) return;

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'SafeSpace needs camera access to take a new profile photo.'
          : 'SafeSpace needs photo library access to choose a profile photo.'
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    // Cancelling leaves the existing photo completely unchanged.
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      Alert.alert('File too large', 'Please choose a photo under 5 MB.');
      return;
    }

    const previousPath = avatarPathFromPublicUrl(profile.profile_picture);
    const path = `${profile.profile_id}/${Date.now()}.jpg`;

    setAvatarState('uploading');
    try {
      const fileBuffer = await readFileAsArrayBuffer(asset.uri);
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, fileBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) {
        console.error('[ProfileScreen] avatar upload failed:', uploadErr.message);
        Alert.alert('Unable to update your profile photo', 'Please try again.');
        return;
      }

      setAvatarState('saving');
      const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: updateErr } = await supabase
        .from('user_profiles')
        .update({ profile_picture: publicUrl.publicUrl })
        .eq('profile_id', profile.profile_id);
      if (updateErr) {
        Alert.alert('Unable to update your profile photo', 'Please try again.');
        return;
      }

      if (previousPath) {
        await supabase.storage.from('avatars').remove([previousPath]);
      }
      await refreshProfile();
    } catch {
      Alert.alert('Unable to update your profile photo', 'Please try again.');
    } finally {
      setAvatarState('idle');
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSavingInfo(true);
    const oldValues = { first_name: profile.first_name, last_name: profile.last_name, phone_number: profile.phone_number };
    await supabase
      .from('user_profiles')
      .update({ first_name: firstName, last_name: lastName, phone_number: phoneNumber })
      .eq('profile_id', profile.profile_id);

    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'user_profiles',
      recordId: profile.profile_id,
      oldValues,
      newValues: { first_name: firstName, last_name: lastName, phone_number: phoneNumber },
    });

    await refreshProfile();
    setSavingInfo(false);
    Alert.alert('Saved', 'Your profile has been updated.');
  };

  const saveEmergencyContact = async () => {
    if (!survivor) return;
    const trimmedName = emergencyName.trim();
    const trimmedNumber = emergencyNumber.trim();
    if ((trimmedName && !trimmedNumber) || (!trimmedName && trimmedNumber)) {
      setEmergencyError('Please provide both a name and a number, or leave both blank.');
      return;
    }
    if (trimmedNumber && !PH_PHONE_RE.test(trimmedNumber)) {
      setEmergencyError('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).');
      return;
    }
    setEmergencyError(null);
    setSavingEmergency(true);
    await supabase
      .from('survivors')
      .update({ emergency_contact_name: trimmedName || null, emergency_contact_number: trimmedNumber || null })
      .eq('survivor_id', survivor.survivor_id);
    await refreshProfile();
    setSavingEmergency(false);
    Alert.alert('Saved', 'Your emergency contact has been updated.');
  };

  const saveSurvivorInfo = async () => {
    if (!survivor || !profile) return;
    const dobCheck = validateDateOfBirth(dobYear && dobMonth && dobDay ? composeIsoDate(dobYear, dobMonth, dobDay) : '');
    if (!dobCheck.valid) {
      setDobError(dobCheck.error);
      return;
    }
    setDobError(null);
    setSavingSurvivorInfo(true);

    const newDob = dobCheck.iso || null;
    const { error } = await supabase
      .from('survivors')
      .update({ date_of_birth: newDob, gender: sex || null, educational_attainment: educAttainment || null })
      .eq('survivor_id', survivor.survivor_id);
    setSavingSurvivorInfo(false);
    if (error) {
      Alert.alert('Unable to save', 'Please try again.');
      return;
    }

    // Date of birth is never written to audit_logs as a literal value —
    // only whether it is now set. Sex/Educational Attainment are logged
    // normally, same as every other profile field in this screen.
    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'survivors',
      recordId: survivor.survivor_id,
      oldValues: { date_of_birth_set: !!survivor.date_of_birth, gender: survivor.gender, educational_attainment: survivor.educational_attainment },
      newValues: { date_of_birth_set: !!newDob, gender: sex || null, educational_attainment: educAttainment || null },
    });

    await refreshProfile();
    setSurvivorEditMode(false);
    Alert.alert('Saved', 'Your survivor information has been updated.');
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out of SafeSpace?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <Screen>
      <View style={{ marginHorizontal: -spacing.lg, marginTop: -spacing.lg }}>
        <FirstVisitTip id="profile" title="Manage your information" body="Update your available personal and account information from this screen." />
      </View>
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Pressable onPress={choosePhoto} disabled={avatarState !== 'idle'}>
          {profile?.profile_picture ? (
            <Image source={{ uri: profile.profile_picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: palette.primaryLight }]}>
              <Text style={[styles.avatarInitial, { color: palette.primaryDark }]}>{profile?.first_name?.[0] ?? '?'}</Text>
            </View>
          )}
          <Text style={[styles.changePhoto, { color: palette.primary }]}>
            {avatarState === 'uploading' ? 'Uploading...' : avatarState === 'saving' ? 'Saving...' : 'Change photo'}
          </Text>
        </Pressable>

        <Text style={[styles.name, { color: palette.text }]}>
          {profile?.first_name} {profile?.last_name}
        </Text>
        {session?.user?.email ? (
          <Text style={[styles.emailSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
            {session.user.email}
          </Text>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <StatusBadge label={identity.label} icon={identity.icon} />
        </View>
      </View>

      <Text style={[styles.groupHeader, { color: palette.textMuted, marginTop: 0 }]}>Account</Text>
      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Personal information</Text>
        <Input label="First name" value={firstName} onChangeText={setFirstName} />
        <Input label="Last name" value={lastName} onChangeText={setLastName} />
        <Input label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" />
        <PrimaryButton title="Save changes" onPress={saveProfile} loading={savingInfo} />
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Account verification</Text>
        <View style={styles.inlineRow}>
          <Text style={[styles.inlineLabel, { color: palette.textMuted }]}>Verification status</Text>
          <StatusBadge label={identity.label} icon={identity.icon} />
        </View>
        {profile?.identity_verification_status === 'rejected' ? (
          <Text style={[styles.rejectionNote, { color: palette.danger }]}>
            Your account verification requires attention. Please resubmit your document.
          </Text>
        ) : null}
        {profile?.identity_verification_status !== 'verified' ? (
          <PrimaryButton
            title={profile?.identity_verification_status === 'rejected' ? 'Resubmit Verification' : 'Verify My Account'}
            onPress={() => navigation.navigate('VerifyIdentity')}
          />
        ) : null}
      </Card>

      {survivor ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Registered address</Text>

          <Text style={[styles.inlineLabel, { color: palette.text, marginBottom: 4 }]}>Municipality</Text>
          <Pressable
            onPress={() => setShowMunicipalityPicker(true)}
            style={[styles.addressTrigger, { borderColor: palette.border, backgroundColor: palette.surface }]}
            accessibilityRole="button"
            accessibilityLabel="Municipality"
          >
            <Text style={{ color: addrMunicipalityName ? palette.text : palette.textMuted }} numberOfLines={1}>
              {addrMunicipalityName || 'Select municipality'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
          </Pressable>

          <Text style={[styles.inlineLabel, { color: palette.text, marginBottom: 4, marginTop: spacing.sm }]}>Barangay</Text>
          <Pressable
            onPress={() => addrMunicipalityId && setShowBarangayPicker(true)}
            disabled={!addrMunicipalityId}
            style={[styles.addressTrigger, { borderColor: palette.border, backgroundColor: palette.surface }, !addrMunicipalityId ? { opacity: 0.5 } : null]}
            accessibilityRole="button"
            accessibilityLabel="Barangay"
          >
            <Text style={{ color: addrBarangayName ? palette.text : palette.textMuted }} numberOfLines={1}>
              {addrBarangayName || 'Select barangay'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
          </Pressable>

          <View style={{ marginTop: spacing.sm }}>
            <Input label="House No. / Street" value={streetAddress} onChangeText={setStreetAddress} />
            <Input label="Purok / Sitio" value={purokSitio} onChangeText={setPurokSitio} />
          </View>

          <Text style={[styles.inlineLabel, { color: palette.text, marginBottom: 4 }]}>Location on map</Text>
          <Pressable
            onPress={() => setShowLocationPicker(true)}
            style={[styles.addressTrigger, { borderColor: palette.border, backgroundColor: palette.surface }]}
            accessibilityRole="button"
            accessibilityLabel={mapResult ? 'Edit location' : 'Set location on map'}
          >
            <Text style={{ color: mapResult ? palette.text : palette.textMuted }} numberOfLines={1}>
              {mapResult ? (mapResult.formattedAddress ?? 'Location set') : 'Set location on map (optional)'}
            </Text>
            <Ionicons name={mapResult ? 'pencil-outline' : 'map-outline'} size={18} color={palette.textMuted} />
          </Pressable>

          <PrimaryButton title="Save address" onPress={saveAddress} loading={savingAddress} />
        </Card>
      ) : null}

      {survivor ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Survivor information</Text>

          {survivorEditMode ? (
            <>
              <Text style={[styles.helperNote, { color: palette.textMuted }]}>
                Used only for official government case-reporting classification — never shown publicly.
              </Text>

              <Text style={[styles.inlineLabel, { color: palette.text, marginBottom: spacing.xs }]}>Date of birth</Text>
              <View style={styles.dobRow}>
                <View style={{ flex: 1 }}>
                  <DropdownInput
                    placeholder="Month"
                    value={dobMonth}
                    options={MONTH_OPTIONS}
                    onSelect={(v) => {
                      setDobMonth(v);
                      if (dobError) setDobError(null);
                    }}
                  />
                </View>
                <View style={{ flex: 0.7 }}>
                  <DropdownInput
                    placeholder="Day"
                    value={dobDay}
                    options={dayOptions}
                    onSelect={(v) => {
                      setDobDay(v);
                      if (dobError) setDobError(null);
                    }}
                  />
                </View>
                <View style={{ flex: 0.9 }}>
                  <DropdownInput
                    placeholder="Year"
                    value={dobYear}
                    options={yearOptions}
                    onSelect={(v) => {
                      setDobYear(v);
                      if (dobError) setDobError(null);
                    }}
                  />
                </View>
              </View>
              {dobError ? <AlertMessage variant="error" title="Check this date" message={dobError} /> : null}

              <DropdownInput
                label="Sex"
                placeholder="Select"
                value={sex || null}
                options={SEX_OPTIONS.map((g) => ({ label: g, value: g }))}
                onSelect={(v) => setSex(v as Gender)}
              />
              <DropdownInput
                label="Educational attainment"
                placeholder="Select"
                value={educAttainment || null}
                options={EDUCATIONAL_ATTAINMENT_OPTIONS.map((o) => ({ label: o, value: o }))}
                onSelect={setEducAttainment}
              />

              <View style={styles.editActionsRow}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="Cancel" variant="outline" onPress={cancelSurvivorEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton title="Save changes" onPress={saveSurvivorInfo} loading={savingSurvivorInfo} />
                </View>
              </View>
            </>
          ) : (
            <>
              {!isSurvivorInfoComplete(survivor) ? (
                <Text style={[styles.helperNote, { color: palette.warning }]}>
                  Some information is missing. Tap Edit to complete it.
                </Text>
              ) : null}
              <View style={styles.inlineRow}>
                <Text style={[styles.inlineLabel, { color: palette.textMuted }]}>Date of birth</Text>
                <Text style={[styles.inlineValue, { color: palette.text }]}>{survivor.date_of_birth ?? 'Not provided'}</Text>
              </View>
              <View style={styles.inlineRow}>
                <Text style={[styles.inlineLabel, { color: palette.textMuted }]}>Sex</Text>
                <Text style={[styles.inlineValue, { color: palette.text }]}>{survivor.gender ?? 'Not provided'}</Text>
              </View>
              <View style={styles.inlineRow}>
                <Text style={[styles.inlineLabel, { color: palette.textMuted }]}>Educational attainment</Text>
                <Text style={[styles.inlineValue, { color: palette.text }]}>{survivor.educational_attainment ?? 'Not provided'}</Text>
              </View>
              <PrimaryButton title="Edit" variant="outline" onPress={() => setSurvivorEditMode(true)} />
            </>
          )}
        </Card>
      ) : null}

      {survivor ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Emergency contact</Text>
          <Input label="Emergency contact name" value={emergencyName} onChangeText={setEmergencyName} />
          <Input
            label="Emergency contact number"
            value={emergencyNumber}
            onChangeText={setEmergencyNumber}
            keyboardType="phone-pad"
            placeholder="09XXXXXXXXX"
          />
          {emergencyError ? <AlertMessage variant="error" title="Check your entry" message={emergencyError} /> : null}
          <PrimaryButton title="Save changes" onPress={saveEmergencyContact} loading={savingEmergency} />
        </Card>
      ) : null}

      <Text style={[styles.groupHeader, { color: palette.textMuted }]}>Security</Text>
      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Security & Password</Text>
        <View style={styles.inlineRow}>
          <Text style={[styles.inlineLabel, { color: palette.textMuted }]}>Email verified</Text>
          <StatusBadge label={emailVerified ? 'Verified' : 'Not Verified'} icon={emailVerified ? 'checkmark-circle' : 'alert-circle-outline'} />
        </View>
        <Pressable
          onPress={() => navigation.navigate('ChangePassword')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Change Password"
        >
          <Text style={[styles.navRowLabel, { color: palette.text }]}>Change Password</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </Card>

      <Text style={[styles.groupHeader, { color: palette.textMuted }]}>Preferences</Text>
      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Preferences</Text>
        <Pressable
          onPress={() => setShowSettings(true)}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Opens appearance, accessibility, notifications, and privacy options"
        >
          <Text style={[styles.navRowLabel, { color: palette.text }]}>Notifications & App Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </Card>

      <Text style={[styles.groupHeader, { color: palette.textMuted }]}>Information & Support</Text>
      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Legal &amp; Privacy</Text>
        <Pressable
          onPress={() => navigation.navigate('Terms')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Terms and Conditions"
        >
          <Text style={[styles.navRowLabel, { color: palette.text }]}>Terms and Conditions</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>App Guide</Text>
        <Text style={{ fontSize: 13, color: palette.textMuted, marginBottom: 12 }}>Learn how SafeSpace features work.</Text>
        <Pressable onPress={takeTour} style={styles.navRow} accessibilityRole="button" accessibilityLabel="Take the Tour">
          <Text style={[styles.navRowLabel, { color: palette.text }]}>Take the Tour</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </Card>

      <Card style={{ marginTop: spacing.lg }}>
        <PrimaryButton title="Log out" variant="danger" onPress={confirmLogout} />
      </Card>

      <MunicipalityPicker
        visible={showMunicipalityPicker}
        onClose={() => setShowMunicipalityPicker(false)}
        municipalities={municipalities}
        state={municipalityState}
        value={addrMunicipalityId}
        onSelect={(id) => {
          // Cascading-clear rule: a different municipality invalidates
          // whatever barangay was previously selected.
          setAddrMunicipalityId(id);
          setAddrBarangayId(null);
          setAddrBarangayName('');
        }}
        onRetry={loadMunicipalitiesForAddress}
      />
      <BarangayPicker
        visible={showBarangayPicker}
        onClose={() => setShowBarangayPicker(false)}
        municipalityId={addrMunicipalityId}
        value={addrBarangayId}
        onSelect={(id, name) => {
          setAddrBarangayId(id);
          setAddrBarangayName(name);
        }}
      />
      <LocationMapPicker
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        initialLatitude={mapResult?.latitude}
        initialLongitude={mapResult?.longitude}
        municipalityName={addrMunicipalityName}
        onConfirm={(result) => {
          setMapResult(result);
          setShowLocationPicker(false);
        }}
      />
      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title="Settings" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 96, height: 96, borderRadius: radius.pill },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { ...typography.display, fontSize: 32 },
  changePhoto: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs },
  name: { ...typography.heading, marginTop: spacing.sm },
  emailSubtitle: { ...typography.caption, marginTop: 2 },
  sectionTitle: { ...typography.heading, fontSize: 17, marginBottom: spacing.sm },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  inlineLabel: { ...typography.body, flex: 1, marginRight: spacing.sm },
  inlineValue: { ...typography.bodyMedium },
  dobRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  editActionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  groupHeader: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.lg, marginBottom: spacing.sm },
  rejectionNote: { ...typography.caption, marginBottom: spacing.sm },
  helperNote: { ...typography.caption, marginBottom: spacing.sm },
  addressTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    minHeight: 44,
  },
  navRowLabel: { ...typography.bodyMedium },
});

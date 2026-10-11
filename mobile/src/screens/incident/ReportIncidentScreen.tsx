import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit, generateCaseNumber } from '../../lib/audit';
import { readFileAsArrayBuffer } from '../../lib/uploadFile';
import { preflightLocation, acquireSosLocation } from '../../lib/sosLocation';
import { Input, PrimaryButton, Screen, AlertMessage } from '../../components/ui';
import { LocationMapPicker, type LocationPickerResult } from '../../components/LocationMapPicker';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { CaseType, PriorityLevel } from '../../types/database.types';

const CASE_TYPES: CaseType[] = [
  'Physical Abuse',
  'Psychological Abuse',
  'Sexual Abuse',
  'Economic Abuse',
  'Stalking',
  'Neglect',
  'Others',
];
const PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export function ReportIncidentScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'ReportIncident'>>();
  const { palette } = useTheme();
  const { profile } = useAuth();

  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [municipalityName, setMunicipalityName] = useState<string>('');
  const [caseType, setCaseType] = useState<CaseType | null>(null);
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [description, setDescription] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [pickedFile, setPickedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedCaseNumber, setSubmittedCaseNumber] = useState<string | null>(null);

  // ---- Incident location (module12) — structured, optional enrichment
  // layered on top of the required free-text `incidentLocation` above,
  // which stays required and still works on its own if a survivor
  // doesn't engage with any of this. ----
  const [survivorBarangayId, setSurvivorBarangayId] = useState<string | null>(null);
  const [survivorBarangayName, setSurvivorBarangayName] = useState('');
  const [survivorStreet, setSurvivorStreet] = useState<string | null>(null);
  const [registeredCoords, setRegisteredCoords] = useState<LocationPickerResult | null>(null);
  const [locationChoice, setLocationChoice] = useState<'registered' | 'current' | 'different' | null>(null);
  const [incidentCoords, setIncidentCoords] = useState<LocationPickerResult | null>(null);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('survivors')
      .select('survivor_id, municipality_id, barangay_id, address, latitude, longitude, formatted_address, location_source, municipalities(municipality_name), barangays(barangay_name)')
      .eq('profile_id', profile.profile_id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setSurvivorId(data.survivor_id as string);
        setMunicipalityId(data.municipality_id as string);
        const muni = (data as any).municipalities;
        setMunicipalityName(muni?.municipality_name ?? '');
        setSurvivorBarangayId(data.barangay_id as string | null);
        const brgy = (data as any).barangays;
        setSurvivorBarangayName(brgy?.barangay_name ?? '');
        setSurvivorStreet(data.address as string | null);
        const lat = data.latitude as number | null;
        const lng = data.longitude as number | null;
        setRegisteredCoords(
          lat != null && lng != null
            ? { latitude: lat, longitude: lng, formattedAddress: data.formatted_address as string | null, source: (data.location_source as LocationPickerResult['source']) ?? 'manually_confirmed' }
            : null
        );
      });
  }, [profile]);

  const registeredAddressPreview = [survivorStreet, survivorBarangayName, municipalityName].filter(Boolean).join(', ');

  const chooseRegisteredLocation = () => {
    setLocationChoice('registered');
    setLocateError(null);
    setIncidentCoords(registeredCoords);
    if (registeredAddressPreview) setIncidentLocation(registeredAddressPreview);
  };

  const chooseCurrentLocation = async () => {
    setLocationChoice('current');
    setIncidentCoords(null);
    setLocateError(null);
    setLocatingCurrent(true);
    const preflight = await preflightLocation();
    if (!preflight.ok) {
      setLocatingCurrent(false);
      setLocateError(
        preflight.reason === 'services-disabled'
          ? 'Location services are turned off on this device. Please enable them, or choose a different option below.'
          : 'SafeSpace needs location permission to use your current location. Please choose a different option below.'
      );
      return;
    }
    const result = await acquireSosLocation();
    setLocatingCurrent(false);
    if (result.latitude == null || result.longitude == null) {
      setLocateError("Couldn't determine your current location. Please choose a different option below.");
      return;
    }
    let address: string | null = null;
    try {
      const geocoded = await Location.reverseGeocodeAsync({ latitude: result.latitude, longitude: result.longitude });
      if (geocoded[0]) address = [geocoded[0].street, geocoded[0].city, geocoded[0].region].filter(Boolean).join(', ') || null;
    } catch {
      // best-effort — coordinates alone are still usable
    }
    setIncidentCoords({ latitude: result.latitude, longitude: result.longitude, formattedAddress: address, source: 'current_location' });
    if (address) setIncidentLocation(address);
  };

  const chooseDifferentLocation = () => {
    setLocationChoice('different');
    setLocateError(null);
    setShowLocationPicker(true);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (!result.canceled && result.assets?.[0]) {
      setPickedFile(result.assets[0]);
    }
  };

  const onSubmit = async () => {
    if (!survivorId || !municipalityId || !profile) {
      setError('Your profile is still loading. Please try again in a moment.');
      return;
    }
    if (!caseType || !description || !incidentLocation) {
      setError('Case type, description, and incident location are required.');
      return;
    }
    // Defense in depth: re-check right before submitting, in case
    // verification status changed since this screen was opened (e.g. a
    // rejection came in while the form was being filled out). The real
    // enforcement is the case_reports RLS policy (module10) — this just
    // avoids sending a doomed request and gives a clear reason instead
    // of a raw database error.
    if (profile.identity_verification_status !== 'verified') {
      setError('Please verify your account before submitting an incident report.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const caseNumber = generateCaseNumber(municipalityName || 'GEN');

    const { data: caseRow, error: insertErr } = await supabase
      .from('case_reports')
      .insert({
        survivor_id: survivorId,
        municipality_id: municipalityId,
        case_number: caseNumber,
        case_type: caseType,
        description,
        incident_date: new Date().toISOString(),
        incident_location: incidentLocation,
        // Descriptive-only enrichment (module12) — never affects case
        // routing/jurisdiction, which stays driven by municipality_id
        // above exactly as before. incident_barangay_id is only ever
        // populated for the "registered address" choice, since that's
        // the only path with a real barangay behind it — a raw GPS fix
        // (current/different) has no barangay derivation available.
        incident_barangay_id: locationChoice === 'registered' ? survivorBarangayId : null,
        incident_latitude: incidentCoords?.latitude ?? null,
        incident_longitude: incidentCoords?.longitude ?? null,
        incident_formatted_address: incidentCoords?.formattedAddress ?? null,
        incident_location_source: incidentCoords?.source ?? null,
        priority_level: priority,
        status: 'Pending',
        is_anonymous: isAnonymous,
      })
      .select()
      .single();

    if (insertErr || !caseRow) {
      setSubmitting(false);
      if (insertErr?.code === '42501' || insertErr?.message?.toLowerCase().includes('row-level security')) {
        setError('Please verify your account before submitting an incident report.');
      } else {
        setError('Could not submit your report. Please try again.');
      }
      return;
    }

    await logAudit({
      profileId: profile.profile_id,
      action: 'INSERT',
      tableName: 'case_reports',
      recordId: caseRow.case_id,
      newValues: caseRow,
    });

    // Seed the status timeline so Case Tracking has something to show immediately.
    await supabase.from('case_status_history').insert({
      case_id: caseRow.case_id,
      changed_by: profile.profile_id,
      previous_status: null,
      new_status: 'Pending',
      remarks: 'Report submitted.',
    });

    if (pickedFile) {
      const path = `${caseRow.case_id}/${Date.now()}_${pickedFile.name}`;
      const fileBuffer = await readFileAsArrayBuffer(pickedFile.uri);
      const { error: uploadErr } = await supabase.storage.from('evidence').upload(path, fileBuffer, {
        contentType: pickedFile.mimeType ?? 'application/octet-stream',
      });
      if (uploadErr) console.error('[ReportIncidentScreen] evidence upload failed:', uploadErr.message);
      if (!uploadErr) {
        const { data: evidenceRow } = await supabase
          .from('evidence')
          .insert({
            case_id: caseRow.case_id,
            uploaded_by: profile.profile_id,
            file_name: pickedFile.name,
            storage_path: path,
            mime_type: pickedFile.mimeType ?? 'application/octet-stream',
            file_size: pickedFile.size ?? 0,
          })
          .select()
          .single();
        if (evidenceRow) {
          await logAudit({
            profileId: profile.profile_id,
            action: 'INSERT',
            tableName: 'evidence',
            recordId: evidenceRow.evidence_id,
            newValues: evidenceRow,
          });
        }
      }
    }

    setSubmitting(false);
    setSubmittedCaseNumber(caseRow.case_number);
  };

  if (submittedCaseNumber) {
    return (
      <Screen>
        <View style={styles.confirmWrap}>
          <View style={[styles.confirmIcon, { backgroundColor: palette.success + '33' }]} />
          <Text style={[styles.confirmTitle, { color: palette.text }]}>Report submitted</Text>
          <Text style={[styles.confirmBody, { color: palette.textMuted }]}>Your case reference number is</Text>
          <Text style={[styles.confirmCaseNumber, { color: palette.primary }]}>{submittedCaseNumber}</Text>
          <Text style={[styles.confirmBody, { color: palette.textMuted }]}>
            You can track the status of this case anytime from "Track My Cases".
          </Text>
          <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Tabs')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[styles.title, { color: palette.text }]}>Report an incident</Text>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        What you share here is confidential and only seen by authorized staff.
      </Text>

      <Text style={[styles.label, { color: palette.text }]}>Case type *</Text>
      <View style={styles.chipRow}>
        {CASE_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setCaseType(t)}
            style={[
              styles.chip,
              { borderColor: palette.border },
              caseType === t && { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
          >
            <Text style={[styles.chipText, { color: caseType === t ? palette.white : palette.text }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: palette.text }]}>How urgent is this? *</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPriority(p)}
            style={[
              styles.chip,
              { borderColor: palette.border },
              priority === p && { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
          >
            <Text style={[styles.chipText, { color: priority === p ? palette.white : palette.text }]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: palette.text }]}>Where did the incident occur?</Text>
      <View style={{ marginBottom: spacing.sm }}>
        <Pressable
          onPress={chooseRegisteredLocation}
          style={[styles.locationChoiceRow, { borderColor: locationChoice === 'registered' ? palette.primary : palette.border }]}
          accessibilityRole="radio"
          accessibilityState={{ checked: locationChoice === 'registered' }}
        >
          <Ionicons name={locationChoice === 'registered' ? 'radio-button-on' : 'radio-button-off'} size={18} color={locationChoice === 'registered' ? palette.primary : palette.textMuted} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[styles.locationChoiceLabel, { color: palette.text }]}>Use Registered Address</Text>
            {registeredAddressPreview ? <Text style={[styles.helperText, { color: palette.textMuted }]}>{registeredAddressPreview}</Text> : null}
          </View>
        </Pressable>

        <Pressable
          onPress={chooseCurrentLocation}
          style={[styles.locationChoiceRow, { borderColor: locationChoice === 'current' ? palette.primary : palette.border }]}
          accessibilityRole="radio"
          accessibilityState={{ checked: locationChoice === 'current' }}
        >
          <Ionicons name={locationChoice === 'current' ? 'radio-button-on' : 'radio-button-off'} size={18} color={locationChoice === 'current' ? palette.primary : palette.textMuted} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[styles.locationChoiceLabel, { color: palette.text }]}>Use My Current Location</Text>
          </View>
          {locatingCurrent ? <ActivityIndicator color={palette.primary} /> : null}
        </Pressable>

        <Pressable
          onPress={chooseDifferentLocation}
          style={[styles.locationChoiceRow, { borderColor: locationChoice === 'different' ? palette.primary : palette.border }]}
          accessibilityRole="radio"
          accessibilityState={{ checked: locationChoice === 'different' }}
        >
          <Ionicons name={locationChoice === 'different' ? 'radio-button-on' : 'radio-button-off'} size={18} color={locationChoice === 'different' ? palette.primary : palette.textMuted} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[styles.locationChoiceLabel, { color: palette.text }]}>Select Different Location</Text>
          </View>
        </Pressable>

        {locateError ? <AlertMessage variant="error" title="Location unavailable" message={locateError} /> : null}
      </View>

      <Input
        label="Incident location *"
        value={incidentLocation}
        onChangeText={setIncidentLocation}
        placeholder="Barangay, street, or landmark"
      />
      <Input
        label="Description *"
        value={description}
        onChangeText={setDescription}
        placeholder="Describe what happened, when, and who was involved"
        multiline
        numberOfLines={5}
        style={{ minHeight: 110, textAlignVertical: 'top' }}
      />

      <Pressable onPress={pickFile} style={[styles.uploadBox, { borderColor: palette.border }]}>
        <Text style={[styles.uploadText, { color: palette.textMuted }]}>
          {pickedFile ? `Attached: ${pickedFile.name}` : 'Attach evidence (photo or document) — optional'}
        </Text>
      </Pressable>

      <View style={styles.anonymousRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: palette.text }]}>Submit anonymously</Text>
          <Text style={[styles.helperText, { color: palette.textMuted }]}>
            Your name will be hidden from municipal staff where supported.
          </Text>
        </View>
        <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ true: palette.primary }} />
      </View>

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <PrimaryButton title="Submit report" onPress={onSubmit} loading={submitting} />

      <LocationMapPicker
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        initialLatitude={incidentCoords?.latitude}
        initialLongitude={incidentCoords?.longitude}
        municipalityName={municipalityName}
        onConfirm={(result) => {
          setIncidentCoords(result);
          if (result.formattedAddress) setIncidentLocation(result.formattedAddress);
          setShowLocationPicker(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22 },
  subtitle: { ...typography.body, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.bodyMedium, marginTop: spacing.sm, marginBottom: spacing.xs },
  helperText: { ...typography.caption },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipText: { ...typography.caption },
  locationChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  locationChoiceLabel: { ...typography.bodyMedium },
  uploadBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.md,
    alignItems: 'center',
  },
  uploadText: { ...typography.caption },
  anonymousRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  error: { ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, marginBottom: spacing.lg },
  confirmTitle: { ...typography.heading },
  confirmBody: { ...typography.body, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, marginVertical: spacing.sm },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit, generateCaseNumber } from '../../lib/audit';
import { preflightLocation, acquireSosLocation } from '../../lib/sosLocation';
import { Input, PrimaryButton, Screen, AlertMessage, DropdownInput } from '../../components/ui';
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

// Government-reporting-alignment audit: case_reports.incident_date is a
// real, separate column from reported_at (submission time) — Walk-In
// cases already collect it (WalkInCaseModal.tsx) but this screen used
// to just stamp the submission instant into it, making "Incident date"
// on the admin case detail page silently identical to "Reported" for
// every mobile-submitted case. This is a coarse, honest alternative to
// a full date/time picker (no such native picker is installed in this
// app) — it never fabricates a precise date the survivor didn't
// actually give, and classification (classifyForGovernmentReport) was
// confirmed to key off reported_at, never incident_date, so this has
// zero effect on WEDC/CNSP/CICL eligibility either way.
const INCIDENT_TIMING_OPTIONS = [
  { label: 'Just now or today', value: 'now' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'A few days ago', value: 'few_days' },
  { label: 'More than a week ago', value: 'over_week' },
  { label: 'Not sure', value: 'unsure' },
];

function incidentDateFor(timing: string): string {
  const d = new Date();
  if (timing === 'yesterday') d.setDate(d.getDate() - 1);
  else if (timing === 'few_days') d.setDate(d.getDate() - 3);
  else if (timing === 'over_week') d.setDate(d.getDate() - 14);
  // 'now' and 'unsure' both keep the submission instant — never a guess.
  return d.toISOString();
}

// Who the report is actually about (module30). A coarse age bucket,
// never a fabricated exact birthdate — the reporter is describing
// someone else and may genuinely not know an exact age.
const THIRD_PARTY_AGE_OPTIONS = [
  { label: 'Child (0–12)', value: 'Child (0–12)' },
  { label: 'Teen (13–17)', value: 'Teen (13–17)' },
  { label: 'Adult (18–59)', value: 'Adult (18–59)' },
  { label: 'Senior (60+)', value: 'Senior (60+)' },
  { label: 'Not sure', value: 'Not sure' },
];

export function ReportIncidentScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'ReportIncident'>>();
  const { palette } = useTheme();
  const { profile } = useAuth();

  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [municipalityName, setMunicipalityName] = useState<string>('');
  const [reportedFor, setReportedFor] = useState<'Self' | 'Other'>('Self');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [thirdPartyRelationship, setThirdPartyRelationship] = useState('');
  const [thirdPartyAgeRange, setThirdPartyAgeRange] = useState<string | null>(null);
  const [thirdPartyContact, setThirdPartyContact] = useState('');
  const [caseType, setCaseType] = useState<CaseType | null>(null);
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [incidentTiming, setIncidentTiming] = useState('now');
  const [description, setDescription] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
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

  const onSubmit = async () => {
    if (!survivorId || !municipalityId || !profile) {
      setError('Your profile is still loading. Please try again in a moment.');
      return;
    }
    if (!caseType || !description || !incidentLocation) {
      setError('Case type, description, and incident location are required.');
      return;
    }
    if (reportedFor === 'Other' && (!thirdPartyName.trim() || !thirdPartyRelationship.trim())) {
      setError("Please enter the person's name and your relationship to them.");
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

    // Wrapped in try/catch — a genuine network failure (no connectivity,
    // DNS failure, request timeout) can make the insert call THROW
    // instead of resolving with {error}. Without this, that path left
    // `submitting` stuck at true forever — a silent hang with the submit
    // button permanently disabled and no error shown, no way to retry
    // without restarting the app. Mirrors the try/catch pattern
    // AuthContext.tsx already uses consistently for every one of its own
    // Supabase calls.
    try {
      const { data: caseRow, error: insertErr } = await supabase
        .from('case_reports')
        .insert({
          survivor_id: survivorId,
          municipality_id: municipalityId,
          case_number: caseNumber,
          case_type: caseType,
          description,
          incident_date: incidentDateFor(incidentTiming),
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
          is_anonymous: false,
          reported_for: reportedFor,
          third_party_name: reportedFor === 'Other' ? thirdPartyName.trim() : null,
          third_party_relationship: reportedFor === 'Other' ? thirdPartyRelationship.trim() : null,
          third_party_age_range: reportedFor === 'Other' ? thirdPartyAgeRange : null,
          third_party_contact_number: reportedFor === 'Other' ? thirdPartyContact.trim() || null : null,
        })
        .select()
        .single();

      if (insertErr || !caseRow) {
        setSubmitting(false);
        // This was previously silent — the generic message below gave no
        // way to tell a real RLS rejection apart from, say, a migration
        // that hadn't been run yet (a missing column surfaces here as a
        // PGRST204 error, not 42501). Logging the raw error is what makes
        // that diagnosable from the Metro/Expo console.
        console.error('[ReportIncidentScreen] case_reports insert failed:', insertErr?.code, insertErr?.message, insertErr?.details);
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

      setSubmitting(false);
      setSubmittedCaseNumber(caseRow.case_number);
    } catch (e) {
      setSubmitting(false);
      console.error('[ReportIncidentScreen] onSubmit: request never reached Supabase', e);
      setError('Unable to connect to SafeSpace. Your report has NOT been submitted — please check your connection and try again.');
    }
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

      <Text style={[styles.label, { color: palette.text }]}>Who is this report about? *</Text>
      <View style={styles.chipRow}>
        {(['Self', 'Other'] as const).map((who) => (
          <Pressable
            key={who}
            onPress={() => setReportedFor(who)}
            style={[
              styles.chip,
              { borderColor: palette.border },
              reportedFor === who && { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
          >
            <Text style={[styles.chipText, { color: reportedFor === who ? palette.white : palette.text }]}>
              {who === 'Self' ? 'Myself' : 'Someone else'}
            </Text>
          </Pressable>
        ))}
      </View>

      {reportedFor === 'Other' && (
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={[styles.helperText, { color: palette.textMuted, marginBottom: spacing.xs }]}>
            Tell us who you're reporting for. It's okay if you don't know everything.
          </Text>
          <Input label="Their name *" value={thirdPartyName} onChangeText={setThirdPartyName} placeholder="Full name" />
          <Input
            label="Your relationship to them *"
            value={thirdPartyRelationship}
            onChangeText={setThirdPartyRelationship}
            placeholder="e.g. Parent, relative, neighbor, friend"
          />
          <DropdownInput
            label="Their approximate age (optional)"
            value={thirdPartyAgeRange}
            options={THIRD_PARTY_AGE_OPTIONS}
            onSelect={setThirdPartyAgeRange}
          />
          <Input
            label="Their contact number (optional)"
            value={thirdPartyContact}
            onChangeText={setThirdPartyContact}
            placeholder="If known"
            keyboardType="phone-pad"
          />
        </View>
      )}

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

      <DropdownInput
        label="When did this happen?"
        value={incidentTiming}
        options={INCIDENT_TIMING_OPTIONS}
        onSelect={setIncidentTiming}
      />
      <Text style={[styles.helperText, { color: palette.textMuted, marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
        An approximate timeframe is fine — exact dates aren't required.
      </Text>

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
  error: { ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, marginBottom: spacing.lg },
  confirmTitle: { ...typography.heading },
  confirmBody: { ...typography.body, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, marginVertical: spacing.sm },
});

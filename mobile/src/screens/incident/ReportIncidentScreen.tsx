import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { supabase } from '../../lib/supabase';
import { logAudit, generateCaseNumber } from '../../lib/audit';
import { preflightLocation, acquireSosLocation } from '../../lib/sosLocation';
import { Input, PrimaryButton, Screen, AlertMessage, DropdownInput } from '../../components/ui';
import { LocationMapPicker, type LocationPickerResult } from '../../components/LocationMapPicker';
import { RadioOptionRow } from '../../components/forms/RadioOptionRow';
import { sanitizePhoneInput } from '../../lib/numericInput';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { CaseType, PriorityLevel } from '../../types/database.types';

const CASE_TYPE_OPTIONS: { label: string; value: CaseType }[] = [
  { label: 'Physical Abuse', value: 'Physical Abuse' },
  { label: 'Psychological Abuse', value: 'Psychological Abuse' },
  { label: 'Sexual Abuse', value: 'Sexual Abuse' },
  { label: 'Economic Abuse', value: 'Economic Abuse' },
  { label: 'Stalking', value: 'Stalking' },
  { label: 'Neglect', value: 'Neglect' },
  { label: 'Others', value: 'Others' },
];

// Guidance only, never a triage substitute — see the note rendered below
// the list itself. Preserves the exact existing PriorityLevel values;
// only the presentation (crowded chips -> stacked rows) changes.
const PRIORITY_OPTIONS: { value: PriorityLevel; description: string }[] = [
  { value: 'Low', description: 'No immediate danger reported.' },
  { value: 'Medium', description: 'The situation needs timely attention.' },
  { value: 'High', description: 'Serious concerns requiring prompt assessment.' },
  { value: 'Critical', description: 'Immediate danger or urgent assistance may be needed.' },
];

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

function SectionLabel({ children }: { children: string }) {
  const { palette } = useTheme();
  return <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>{children}</Text>;
}


export function ReportIncidentScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'ReportIncident'>>();
  const { palette } = useTheme();
  const { profile } = useAuth();
  const { enrolled: passcodeEnrolled } = usePasscode();

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
  // Per-field messages shown inline, right under the control they belong
  // to — `error` above stays for things that aren't about one specific
  // visible field (profile still loading, verification/passcode status,
  // submission failures).
  const [fieldErrors, setFieldErrors] = useState<{ caseType?: string; description?: string; incidentLocation?: string; thirdPartyName?: string; thirdPartyRelationship?: string }>({});
  const [submittedCaseNumber, setSubmittedCaseNumber] = useState<string | null>(null);
  // Mirrors the same synchronous guard LoginScreen uses — `submitting`
  // alone can't close the gap where a very fast double-tap fires onSubmit
  // twice before React re-renders with the button disabled.
  const submittingRef = useRef(false);

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
    if (submittingRef.current || submitting) return;

    if (!survivorId || !municipalityId || !profile) {
      setError('Your profile is still loading. Please try again in a moment.');
      return;
    }

    const nextFieldErrors: typeof fieldErrors = {};
    if (!caseType) nextFieldErrors.caseType = 'Please select a case type.';
    if (!description.trim()) nextFieldErrors.description = 'Please describe what happened.';
    if (!incidentLocation.trim()) nextFieldErrors.incidentLocation = 'Please provide the incident location.';
    if (reportedFor === 'Other') {
      if (!thirdPartyName.trim()) nextFieldErrors.thirdPartyName = "Please enter the person's name.";
      if (!thirdPartyRelationship.trim()) nextFieldErrors.thirdPartyRelationship = 'Please enter your relationship to them.';
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError('Please complete the highlighted fields below.');
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
    // Same defense-in-depth reasoning as the identity-verification check
    // above, added for the security-passcode requirement (module33) — the
    // real enforcement is the case_reports RLS policy's
    // has_security_passcode() clause; this just gives an accurate reason
    // instead of a generic post-rejection guess. reportIncidentGuard.ts
    // should already prevent an unenrolled account from reaching this
    // screen at all, so reaching this specific branch means either a
    // stale client build (reportIncidentGuard predates this check) or
    // enrollment state changed after this screen was opened — either way,
    // fail honestly rather than let the request reach the server.
    if (passcodeEnrolled === false) {
      setError('Please set up your SafeSpace security passcode before submitting an incident report.');
      return;
    }
    submittingRef.current = true;
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
        submittingRef.current = false;
        // This was previously silent — the generic message below gave no
        // way to tell a real RLS rejection apart from, say, a migration
        // that hadn't been run yet (a missing column surfaces here as a
        // PGRST204 error, not 42501). Logging the raw error is what makes
        // that diagnosable from the Metro/Expo console.
        console.error('[ReportIncidentScreen] case_reports insert failed:', insertErr?.code, insertErr?.message, insertErr?.details);
        if (insertErr?.code === '42501' || insertErr?.message?.toLowerCase().includes('row-level security')) {
          // Fixed alongside a live diagnosis: this used to always say
          // "verify your account," which became actively misleading once
          // the case_reports policy also started requiring passcode
          // enrollment (module33) — an already-verified account hitting
          // this exact branch for the passcode reason was being told the
          // wrong thing. The two client-side pre-checks above (identity
          // verification, then passcode) already cover the two REAL
          // reasons this policy can reject an insert and show the
          // specific one — reaching this fallback means the request was
          // rejected for a reason this screen's own local state didn't
          // predict (e.g. that state was stale), so the message stays
          // deliberately generic rather than guessing which one again.
          setError("Your account doesn't currently meet the requirements to submit a report. Please check your verification and security passcode status, then try again.");
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
      submittingRef.current = false;
      setSubmittedCaseNumber(caseRow.case_number);
    } catch (e) {
      setSubmitting(false);
      submittingRef.current = false;
      console.error('[ReportIncidentScreen] onSubmit: request never reached Supabase', e);
      setError('Unable to connect to SafeSpace. Your report has NOT been submitted — please check your connection and try again.');
    }
  };

  if (submittedCaseNumber) {
    return (
      <Screen>
        <View style={styles.confirmWrap}>
          <View style={[styles.confirmIcon, { backgroundColor: palette.success + '1F' }]}>
            <Ionicons name="checkmark-circle" size={48} color={palette.success} />
          </View>
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
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        Share what happened at your own pace. Your report will be handled by authorized personnel.
      </Text>
      <Text style={[styles.confidentialityNote, { color: palette.textMuted }]}>
        What you share here is only visible to authorized SafeSpace staff.
      </Text>

      <SectionLabel>About the report</SectionLabel>
      <Text style={[styles.label, { color: palette.text }]}>Who is this report about? *</Text>
      <View style={styles.whoRow}>
        {(['Self', 'Other'] as const).map((who) => {
          const active = reportedFor === who;
          return (
            <Pressable
              key={who}
              onPress={() => setReportedFor(who)}
              style={[styles.whoCard, { borderColor: active ? palette.primary : palette.border, backgroundColor: active ? palette.primary : palette.surface }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
            >
              <Ionicons
                name={who === 'Self' ? 'person-outline' : 'people-outline'}
                size={20}
                color={active ? palette.white : palette.textMuted}
              />
              <Text style={[styles.whoCardText, { color: active ? palette.white : palette.text }]}>
                {who === 'Self' ? 'Myself' : 'Someone else'}
              </Text>
              {active ? <Ionicons name="checkmark-circle" size={16} color={palette.white} style={{ position: 'absolute', top: 8, right: 8 }} /> : null}
            </Pressable>
          );
        })}
      </View>

      {reportedFor === 'Other' && (
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={[styles.helperText, { color: palette.textMuted, marginBottom: spacing.xs }]}>
            Tell us who you're reporting for. It's okay if you don't know everything.
          </Text>
          <Input
            label="Their name *"
            value={thirdPartyName}
            onChangeText={(v) => {
              setThirdPartyName(v);
              if (fieldErrors.thirdPartyName) setFieldErrors((prev) => ({ ...prev, thirdPartyName: undefined }));
            }}
            placeholder="Full name"
            error={fieldErrors.thirdPartyName}
          />
          <Input
            label="Your relationship to them *"
            value={thirdPartyRelationship}
            onChangeText={(v) => {
              setThirdPartyRelationship(v);
              if (fieldErrors.thirdPartyRelationship) setFieldErrors((prev) => ({ ...prev, thirdPartyRelationship: undefined }));
            }}
            placeholder="e.g. Parent, relative, neighbor, friend"
            error={fieldErrors.thirdPartyRelationship}
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
            onChangeText={(v) => setThirdPartyContact(sanitizePhoneInput(v))}
            placeholder="If known"
            keyboardType="phone-pad"
          />
        </View>
      )}

      <SectionLabel>Incident details</SectionLabel>

      <DropdownInput
        label="Case type *"
        placeholder="Select a case type"
        value={caseType}
        options={CASE_TYPE_OPTIONS}
        onSelect={(v) => {
          setCaseType(v as CaseType);
          if (fieldErrors.caseType) setFieldErrors((prev) => ({ ...prev, caseType: undefined }));
        }}
        indicator="radio"
        error={fieldErrors.caseType}
      />

      <Text style={[styles.label, { color: palette.text }]}>How urgent is this? *</Text>
      <View style={{ gap: spacing.xs, marginBottom: spacing.xs }}>
        {PRIORITY_OPTIONS.map((p) => (
          <RadioOptionRow
            key={p.value}
            title={p.value}
            description={p.description}
            selected={priority === p.value}
            onPress={() => setPriority(p.value)}
          />
        ))}
      </View>
      <Text style={[styles.helperText, { color: palette.textMuted, marginBottom: spacing.sm }]}>
        This helps authorized staff prioritize review — it is not a professional safety assessment.
      </Text>
      {priority === 'Critical' && (
        <View style={[styles.emergencyNotice, { backgroundColor: palette.danger + '14', borderColor: palette.danger + '40' }]}>
          <Ionicons name="alert-circle" size={18} color={palette.danger} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[styles.optionTitle, { color: palette.text }]}>If you're in immediate danger</Text>
            <Text style={[styles.optionDescription, { color: palette.textMuted }]}>
              You can use SafeSpace's SOS feature for faster assistance while you finish this report.
            </Text>
            <Pressable onPress={() => navigation.navigate('Tabs', { screen: 'SosTab' })} hitSlop={6} style={{ marginTop: spacing.xs }}>
              <Text style={[styles.optionTitle, { color: palette.danger }]}>Open SOS</Text>
            </Pressable>
          </View>
        </View>
      )}

      <DropdownInput
        label="When did this happen?"
        value={incidentTiming}
        options={INCIDENT_TIMING_OPTIONS}
        onSelect={setIncidentTiming}
      />
      <Text style={[styles.helperText, { color: palette.textMuted, marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
        An approximate timeframe is fine if you do not remember the exact date.
      </Text>

      <SectionLabel>Incident location</SectionLabel>
      <View style={{ gap: spacing.xs, marginBottom: spacing.xs }}>
        <RadioOptionRow
          icon="home-outline"
          title="Use Registered Address"
          description={registeredAddressPreview || 'Use the address saved in your profile.'}
          selected={locationChoice === 'registered'}
          onPress={chooseRegisteredLocation}
        />
        <RadioOptionRow
          icon="locate-outline"
          title="Use My Current Location"
          description="Use your device's current GPS location, if permission is granted."
          selected={locationChoice === 'current'}
          onPress={chooseCurrentLocation}
          trailing={locatingCurrent ? <ActivityIndicator color={palette.primary} /> : undefined}
        />
        <RadioOptionRow
          icon="map-outline"
          title="Select a Different Location"
          description="Enter or select another incident location."
          selected={locationChoice === 'different'}
          onPress={chooseDifferentLocation}
        />
      </View>
      {locateError ? <AlertMessage variant="error" title="Location unavailable" message={locateError} /> : null}

      <Input
        label="Incident location *"
        value={incidentLocation}
        onChangeText={(v) => {
          setIncidentLocation(v);
          if (fieldErrors.incidentLocation) setFieldErrors((prev) => ({ ...prev, incidentLocation: undefined }));
        }}
        placeholder="Barangay, street, or landmark"
        error={fieldErrors.incidentLocation}
      />

      <SectionLabel>Description</SectionLabel>
      <Input
        label="What happened? *"
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          if (fieldErrors.description) setFieldErrors((prev) => ({ ...prev, description: undefined }));
        }}
        placeholder="Describe what happened, when it occurred, and any relevant details you feel comfortable sharing."
        error={fieldErrors.description}
        multiline
        numberOfLines={5}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <PrimaryButton title="Submit Report" onPress={onSubmit} loading={submitting} />

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
  subtitle: { ...typography.body, marginTop: spacing.xs },
  confidentialityNote: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.md },
  sectionLabel: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.lg, marginBottom: spacing.xs },
  label: { ...typography.bodyMedium, marginTop: spacing.xs, marginBottom: spacing.xs },
  helperText: { ...typography.caption },

  whoRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  whoCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  whoCardText: { ...typography.bodyMedium },

  optionTitle: { ...typography.bodyMedium },
  optionDescription: { ...typography.caption, marginTop: 2 },

  emergencyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },

  error: { ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, marginBottom: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { ...typography.heading },
  confirmBody: { ...typography.body, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, marginVertical: spacing.sm },
});

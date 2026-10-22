import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Input, PrimaryButton, Screen, DropdownInput } from '../../components/ui';
import { RadioOptionRow } from '../../components/forms/RadioOptionRow';
import { formatFullName } from '../../lib/personName';
import { sanitizeDigitsOnly, parseWholeCount } from '../../lib/numericInput';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Shelter, ShelterRequestUrgency } from '../../types/database.types';

const URGENCY_OPTIONS: { value: ShelterRequestUrgency; description: string }[] = [
  { value: 'Standard', description: 'A regular shelter request for review.' },
  { value: 'Urgent', description: 'The request needs prompt attention.' },
  { value: 'Emergency', description: 'Immediate accommodation or assistance may be needed.' },
];

function SectionLabel({ children }: { children: string }) {
  const { palette } = useTheme();
  return <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>{children}</Text>;
}

const parseCount = parseWholeCount;

export function RequestShelterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'RequestShelter'>>();
  const route = useRoute<RouteProp<AppStackParamList, 'RequestShelter'>>();
  const { palette } = useTheme();
  const { profile } = useAuth();

  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [shelterId, setShelterId] = useState<string | null>(route.params?.shelterId ?? null);
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPreference, setContactPreference] = useState('');
  const [peopleCount, setPeopleCount] = useState('1');
  const [childrenCount, setChildrenCount] = useState('0');
  const [urgency, setUrgency] = useState<ShelterRequestUrgency>('Standard');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  // Per-field messages shown right under the field they belong to —
  // `error` stays reserved for things not about one specific visible
  // control (no shelter chosen, a failed submission). Mirrors the same
  // split ReportIncidentScreen already uses.
  const [fieldErrors, setFieldErrors] = useState<{ shelter?: string; contactName?: string; people?: string; children?: string }>({});
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    setContactName(formatFullName(profile));
    // A starting point, not a forced value — reuses the phone number
    // already on the survivor's own profile (brief: "use existing data
    // appropriately rather than duplicating it") so they don't have to
    // retype it, but it's the same editable Input as before, so they can
    // change or clear it freely.
    if (profile.phone_number) setContactPreference(`Call or text ${profile.phone_number}`);

    // General area only, from the survivor's own profile — never GPS.
    // Loading it here is purely a convenience default; a request can be
    // submitted with no municipality at all. Wrapped in try/catch (not a
    // blocking load, just fire-and-forget from this effect) so a thrown
    // exception can't become an unhandled promise rejection; failing
    // just means the default stays unset, same as before this fix.
    (async () => {
      try {
        const { data } = await supabase.from('survivors').select('municipality_id').eq('profile_id', profile.profile_id).single();
        if (data?.municipality_id) setMunicipalityId(data.municipality_id as string);
      } catch (e) {
        console.error('[RequestShelterScreen] municipality default load:', e);
      }
    })();

    if (!route.params?.shelterId) {
      (async () => {
        try {
          const { data } = await supabase.from('shelters').select('*').eq('is_active', true).order('shelter_name');
          setShelters(data ?? []);
        } catch (e) {
          console.error('[RequestShelterScreen] shelters load:', e);
        }
      })();
    }
  }, [profile, route.params?.shelterId]);

  // Live household-count validation — re-checked whenever EITHER value
  // changes, per the brief's own instruction, and never silently clamps
  // one field to fit the other (the previous version did
  // Math.min(people, children) silently on submit — replaced with a
  // clear message the user corrects themselves).
  const householdError = useMemo(() => {
    const people = parseCount(peopleCount);
    const children = parseCount(childrenCount);
    if (people == null || people < 1) return { people: 'Enter at least 1 person.', children: undefined };
    if (children == null || children < 0) return { people: undefined, children: 'Enter 0 or more.' };
    if (children > people) return { people: undefined, children: "Can't be more than the total people above." };
    return { people: undefined, children: undefined };
  }, [peopleCount, childrenCount]);

  const onSubmit = async () => {
    if (submittingRef.current || submitting) return;
    if (!profile) return;

    const nextFieldErrors: typeof fieldErrors = {};
    if (!shelterId) nextFieldErrors.shelter = 'Please choose a shelter.';
    if (!contactName.trim()) nextFieldErrors.contactName = "Please tell us what to call you.";
    if (householdError.people) nextFieldErrors.people = householdError.people;
    if (householdError.children) nextFieldErrors.children = householdError.children;
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError('Please complete the highlighted fields below.');
      return;
    }

    const people = parseCount(peopleCount) as number;
    const children = parseCount(childrenCount) as number;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const { data, error: insertErr } = await supabase
        .from('shelter_requests')
        .insert({
          shelter_id: shelterId,
          profile_id: profile.profile_id,
          municipality_id: municipalityId,
          contact_name: contactName.trim(),
          contact_preference: contactPreference.trim() || null,
          people_count: people,
          children_count: children,
          urgency,
          message: message.trim() || null,
          status: 'Submitted',
        })
        .select()
        .single();

      if (insertErr || !data) {
        // Never the raw Postgres/PostgREST error text — log it for
        // debugging, show a generic, actionable message instead.
        if (insertErr) console.error('[RequestShelterScreen] onSubmit:', insertErr.message);
        setError('Could not submit your request. Please try again.');
        return;
      }
      // No manual logAudit() call — trg_audit_shelter_requests (see
      // supabase/module4_shelter_admin.sql) fires automatically.
      setSubmittedRef(data.request_id.slice(0, 8).toUpperCase());
    } catch (e) {
      console.error('[RequestShelterScreen] onSubmit: request never reached Supabase', e);
      setError('Unable to connect to SafeSpace. Your request has NOT been submitted — please check your connection and try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (submittedRef) {
    return (
      <Screen>
        <View style={styles.confirmWrap}>
          <View style={[styles.confirmIcon, { backgroundColor: palette.success + '1F' }]}>
            <Ionicons name="checkmark-circle" size={48} color={palette.success} />
          </View>
          <Text style={[styles.confirmTitle, { color: palette.text }]}>Request submitted</Text>
          <Text style={[styles.confirmBody, { color: palette.textMuted }]}>Your request reference is</Text>
          <Text style={[styles.confirmCaseNumber, { color: palette.primary }]}>{submittedRef}</Text>
          <Text style={[styles.confirmBody, { color: palette.textMuted }]}>
            Submitting a shelter request does not guarantee immediate shelter admission. Your request will be reviewed by the shelter, and you'll
            receive an update here and in Notifications.
          </Text>
          <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Tabs')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[styles.title, { color: palette.text }]}>Request shelter assistance</Text>

      <View style={[styles.infoBox, { backgroundColor: palette.primaryLight, borderColor: palette.primary + '33' }]}>
        <Ionicons name="information-circle-outline" size={18} color={palette.primaryDark} />
        <Text style={[styles.infoText, { color: palette.primaryDark }]}>
          Share the information needed to review your request. The shelter will assess your request and follow up with you — submitting does not
          guarantee admission.
        </Text>
      </View>

      <SectionLabel>Contact information</SectionLabel>
      {route.params?.shelterId ? null : (
        <DropdownInput
          label="Shelter *"
          placeholder="Select a shelter"
          value={shelterId}
          onSelect={(v) => {
            setShelterId(v);
            if (fieldErrors.shelter) setFieldErrors((prev) => ({ ...prev, shelter: undefined }));
          }}
          options={shelters.map((s) => ({ label: s.shelter_name, value: s.shelter_id }))}
          error={fieldErrors.shelter}
        />
      )}
      <Input
        label="What should we call you? *"
        value={contactName}
        onChangeText={(v) => {
          setContactName(v);
          if (fieldErrors.contactName) setFieldErrors((prev) => ({ ...prev, contactName: undefined }));
        }}
        placeholder="Your name or a name you're comfortable using"
        error={fieldErrors.contactName}
      />
      <Input
        label="How can the shelter reach you?"
        value={contactPreference}
        onChangeText={setContactPreference}
        placeholder="e.g., Preferred contact method or a safe time to contact you"
      />
      <Text style={[styles.helperText, { color: palette.textMuted, marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
        Only visible to the shelter reviewing this request.
      </Text>

      <SectionLabel>Household and accommodation needs</SectionLabel>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <Input
            label="People needing shelter *"
            value={peopleCount}
            onChangeText={(v) => {
              setPeopleCount(sanitizeDigitsOnly(v));
              if (fieldErrors.people) setFieldErrors((prev) => ({ ...prev, people: undefined }));
            }}
            keyboardType="number-pad"
            error={fieldErrors.people}
          />
        </View>
        <View style={styles.rowField}>
          <Input
            label="Children among them"
            value={childrenCount}
            onChangeText={(v) => {
              setChildrenCount(sanitizeDigitsOnly(v));
              if (fieldErrors.children) setFieldErrors((prev) => ({ ...prev, children: undefined }));
            }}
            keyboardType="number-pad"
            error={fieldErrors.children}
          />
        </View>
      </View>

      <SectionLabel>Request urgency</SectionLabel>
      <View style={{ gap: spacing.xs, marginBottom: spacing.sm }}>
        {URGENCY_OPTIONS.map((u) => (
          <RadioOptionRow key={u.value} title={u.value} description={u.description} selected={urgency === u.value} onPress={() => setUrgency(u.value)} />
        ))}
      </View>
      <Text style={[styles.helperText, { color: palette.textMuted, marginBottom: spacing.sm }]}>
        This helps the shelter prioritize review — it does not contact emergency services or guarantee a response time. If you're in immediate
        danger, use SafeSpace's SOS feature or call 911.
      </Text>

      <SectionLabel>Additional information</SectionLabel>
      <Input
        label="Anything else you'd like the shelter to know?"
        value={message}
        onChangeText={setMessage}
        placeholder="Share any additional information relevant to your request, if you feel comfortable."
        multiline
        numberOfLines={3}
        style={{ minHeight: 80, textAlignVertical: 'top' }}
      />

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <PrimaryButton title="Submit Shelter Request" onPress={onSubmit} loading={submitting} />
      {/* Screen's own scrollContent already adds spacing.xxl of bottom
          padding inside its SafeAreaView, but the brief specifically
          flagged this exact button as partially hidden before this
          redesign shortened the form — this extra spacer is cheap
          insurance on short devices/larger text scaling rather than
          relying on the form being short enough to never need it. */}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22, marginBottom: spacing.sm },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
  infoText: { ...typography.caption, flex: 1, lineHeight: 17 },
  sectionLabel: {
    ...typography.caption,
    fontFamily: 'Inter_600SemiBold' as any,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  helperText: { ...typography.caption },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // flexBasis (not a plain flex:1 50/50 split) so a field wraps to its
  // own full-width line instead of being squeezed when text scaling or a
  // narrow screen makes two side-by-side columns impractical — the
  // brief's own "stack vertically when two columns are impractical,
  // don't force it on every screen size" requirement, handled with plain
  // flexbox rather than a screen-width breakpoint.
  rowField: { flexBasis: 140, flexGrow: 1 },
  error: { ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, marginBottom: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { ...typography.heading },
  confirmBody: { ...typography.body, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, marginVertical: spacing.sm },
});

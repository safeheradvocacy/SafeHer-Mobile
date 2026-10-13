import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Input, DropdownInput, PrimaryButton, Screen } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Shelter, ShelterRequestUrgency } from '../../types/database.types';

const URGENCY_LEVELS: ShelterRequestUrgency[] = ['Standard', 'Urgent', 'Emergency'];

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

  useEffect(() => {
    if (!profile) return;
    setContactName(`${profile.first_name} ${profile.last_name}`.trim());

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

  const onSubmit = async () => {
    if (!profile) return;
    if (!shelterId) {
      setError('Please choose a shelter.');
      return;
    }
    if (!contactName.trim()) {
      setError('Please tell us what to call you.');
      return;
    }
    const people = Math.max(1, Number(peopleCount) || 1);
    const children = Math.max(0, Math.min(people, Number(childrenCount) || 0));

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
      setSubmitting(false);
    }
  };

  if (submittedRef) {
    return (
      <Screen>
        <View style={styles.confirmWrap}>
          <View style={[styles.confirmIcon, { backgroundColor: palette.success + '33' }]} />
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
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        Submitting a request does not guarantee immediate admission — the shelter will review it and follow up with you.
      </Text>

      {route.params?.shelterId ? null : (
        <DropdownInput
          label="Shelter *"
          placeholder="Select a shelter"
          value={shelterId}
          onSelect={setShelterId}
          options={shelters.map((s) => ({ label: s.shelter_name, value: s.shelter_id }))}
        />
      )}

      <Input label="What should we call you? *" value={contactName} onChangeText={setContactName} placeholder="Your name or a name you're comfortable using" />
      <Input
        label="How can the shelter reach you?"
        value={contactPreference}
        onChangeText={setContactPreference}
        placeholder="e.g. Call anytime, text only, contact through a friend"
      />

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Input label="People needing shelter" value={peopleCount} onChangeText={setPeopleCount} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Children among them" value={childrenCount} onChangeText={setChildrenCount} keyboardType="number-pad" />
        </View>
      </View>

      <Text style={[styles.label, { color: palette.text }]}>How urgent is this?</Text>
      <View style={styles.chipRow}>
        {URGENCY_LEVELS.map((u) => (
          <Pressable
            key={u}
            onPress={() => setUrgency(u)}
            style={[styles.chip, { borderColor: palette.border }, urgency === u && { backgroundColor: palette.primary, borderColor: palette.primary }]}
          >
            <Text style={[styles.chipText, { color: urgency === u ? palette.white : palette.text }]}>{u}</Text>
          </Pressable>
        ))}
      </View>

      <Input
        label="Anything else you'd like the shelter to know? (optional)"
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
        style={{ minHeight: 90, textAlignVertical: 'top' }}
      />

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <PrimaryButton title="Submit request" onPress={onSubmit} loading={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22 },
  subtitle: { ...typography.body, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.bodyMedium, marginTop: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row' },
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
  error: { ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, marginBottom: spacing.lg },
  confirmTitle: { ...typography.heading },
  confirmBody: { ...typography.body, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, marginVertical: spacing.sm },
});

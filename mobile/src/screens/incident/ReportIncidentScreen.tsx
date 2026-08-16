import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit, generateCaseNumber } from '../../lib/audit';
import { Input, PrimaryButton, Screen } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { CaseType, PriorityLevel } from '../../types/database.types';

const CASE_TYPES: CaseType[] = [
  'Physical Abuse',
  'Psychological Abuse',
  'Sexual Abuse',
  'Economic Abuse',
  'Neglect',
  'Others',
];
const PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export function ReportIncidentScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'ReportIncident'>>();
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

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('survivors')
      .select('survivor_id, municipality_id, municipalities(municipality_name)')
      .eq('profile_id', profile.profile_id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setSurvivorId(data.survivor_id as string);
        setMunicipalityId(data.municipality_id as string);
        const muni = (data as any).municipalities;
        setMunicipalityName(muni?.municipality_name ?? '');
      });
  }, [profile]);

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
        priority_level: priority,
        status: 'Pending',
        is_anonymous: isAnonymous,
      })
      .select()
      .single();

    if (insertErr || !caseRow) {
      setSubmitting(false);
      setError(insertErr?.message ?? 'Could not submit your report. Please try again.');
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
      const response = await fetch(pickedFile.uri);
      const blob = await response.blob();
      const { error: uploadErr } = await supabase.storage.from('evidence').upload(path, blob, {
        contentType: pickedFile.mimeType ?? 'application/octet-stream',
      });
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
          <View style={styles.confirmIcon} />
          <Text style={styles.confirmTitle}>Report submitted</Text>
          <Text style={styles.confirmBody}>Your case reference number is</Text>
          <Text style={styles.confirmCaseNumber}>{submittedCaseNumber}</Text>
          <Text style={styles.confirmBody}>
            You can track the status of this case anytime from "Track My Cases".
          </Text>
          <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Tabs')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Report an incident</Text>
      <Text style={styles.subtitle}>What you share here is confidential and only seen by authorized staff.</Text>

      <Text style={styles.label}>Case type *</Text>
      <View style={styles.chipRow}>
        {CASE_TYPES.map((t) => (
          <Pressable key={t} onPress={() => setCaseType(t)} style={[styles.chip, caseType === t && styles.chipActive]}>
            <Text style={[styles.chipText, caseType === t && styles.chipTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>How urgent is this? *</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipActive]}>
            <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
          </Pressable>
        ))}
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

      <Pressable onPress={pickFile} style={styles.uploadBox}>
        <Text style={styles.uploadText}>
          {pickedFile ? `Attached: ${pickedFile.name}` : 'Attach evidence (photo or document) — optional'}
        </Text>
      </Pressable>

      <View style={styles.anonymousRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Submit anonymously</Text>
          <Text style={styles.helperText}>Your name will be hidden from municipal staff where supported.</Text>
        </View>
        <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ true: colors.primary }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton title="Submit report" onPress={onSubmit} loading={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, fontSize: 22, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.bodyMedium, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.xs },
  helperText: { ...typography.caption, color: colors.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.white },
  uploadBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.md,
    alignItems: 'center',
  },
  uploadText: { ...typography.caption, color: colors.textMuted },
  anonymousRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  error: { color: colors.danger, ...typography.caption, marginBottom: spacing.sm },
  confirmWrap: { alignItems: 'center', paddingTop: spacing.xxl },
  confirmIcon: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.success + '33', marginBottom: spacing.lg },
  confirmTitle: { ...typography.heading, color: colors.text },
  confirmBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  confirmCaseNumber: { ...typography.display, fontSize: 22, color: colors.primary, marginVertical: spacing.sm },
});

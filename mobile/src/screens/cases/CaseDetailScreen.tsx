import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { Card, EmptyState, StatusBadge } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { CaseReport, CaseStatusHistory, ShelterReferral } from '../../types/database.types';

export function CaseDetailScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'CaseDetail'>>();
  const { caseId } = route.params;

  const [caseReport, setCaseReport] = useState<CaseReport | null>(null);
  const [history, setHistory] = useState<CaseStatusHistory[]>([]);
  const [referrals, setReferrals] = useState<(ShelterReferral & { shelters?: { shelter_name: string } })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [caseRes, historyRes, referralRes] = await Promise.all([
      supabase.from('case_reports').select('*').eq('case_id', caseId).single(),
      supabase
        .from('case_status_history')
        .select('*')
        .eq('case_id', caseId)
        .order('changed_at', { ascending: true }),
      supabase
        .from('shelter_referrals')
        .select('*, shelters(shelter_name)')
        .eq('case_id', caseId)
        .order('referred_at', { ascending: false }),
    ]);
    setCaseReport(caseRes.data ?? null);
    setHistory(historyRes.data ?? []);
    setReferrals((referralRes.data as any) ?? []);
    setLoading(false);
  }, [caseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading || !caseReport) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={styles.caseNumber}>{caseReport.case_number}</Text>
          <Text style={styles.caseType}>{caseReport.case_type}</Text>
        </View>
        <StatusBadge label={caseReport.status} />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={styles.sectionTitle}>Details</Text>
        <DetailRow label="Priority" value={caseReport.priority_level} />
        <DetailRow label="Incident location" value={caseReport.incident_location} />
        <DetailRow label="Incident date" value={new Date(caseReport.incident_date).toLocaleDateString()} />
        <DetailRow label="Reported" value={new Date(caseReport.reported_at).toLocaleString()} />
        <DetailRow label="Anonymous report" value={caseReport.is_anonymous ? 'Yes' : 'No'} />
        <Text style={[styles.detailLabel, { marginTop: spacing.sm }]}>Description</Text>
        <Text style={styles.description}>{caseReport.description}</Text>
      </Card>

      <Text style={styles.sectionTitle}>Status timeline</Text>
      {history.length === 0 ? (
        <EmptyState title="No status updates yet" />
      ) : (
        <Card>
          {history.map((h, idx) => (
            <View key={h.history_id} style={styles.timelineRow}>
              <View style={styles.timelineDotCol}>
                <View style={styles.timelineDot} />
                {idx < history.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <View style={{ flex: 1, paddingBottom: spacing.md }}>
                <Text style={styles.timelineStatus}>{h.new_status}</Text>
                {h.remarks ? <Text style={styles.timelineRemarks}>{h.remarks}</Text> : null}
                <Text style={styles.timelineDate}>{new Date(h.changed_at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {referrals.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Shelter referral</Text>
          {referrals.map((r) => (
            <Card key={r.referral_id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.caseNumber}>{r.shelters?.shelter_name ?? 'Shelter'}</Text>
                <StatusBadge label={r.referral_status} />
              </View>
              {r.notes ? <Text style={styles.description}>{r.notes}</Text> : null}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  caseNumber: { ...typography.heading, color: colors.text },
  caseType: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { ...typography.heading, fontSize: 17, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { ...typography.caption, color: colors.textMuted },
  detailValue: { ...typography.bodyMedium, color: colors.text },
  description: { ...typography.body, color: colors.text, marginTop: spacing.xs },
  timelineRow: { flexDirection: 'row' },
  timelineDotCol: { alignItems: 'center', width: 24 },
  timelineDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2 },
  timelineStatus: { ...typography.bodyMedium, color: colors.text },
  timelineRemarks: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  timelineDate: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});

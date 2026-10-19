import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { AlertMessage, Card, EmptyState, StatusBadge } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { serviceTypeLabel } from '../../lib/serviceTypes';
import { AppStackParamList } from '../../navigation/types';
import type { CaseReport, CaseService, CaseStatusHistory, ShelterReferral } from '../../types/database.types';

export function CaseDetailScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'CaseDetail'>>();
  const route = useRoute<RouteProp<AppStackParamList, 'CaseDetail'>>();
  const { caseId } = route.params;
  const { hasActiveGrant, refreshGrantStatus } = usePasscode();

  const [caseReport, setCaseReport] = useState<CaseReport | null>(null);
  const [history, setHistory] = useState<CaseStatusHistory[]>([]);
  const [referrals, setReferrals] = useState<(ShelterReferral & { shelters?: { shelter_name: string } })[]>([]);
  const [services, setServices] = useState<CaseService[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [caseRes, historyRes, referralRes, servicesRes] = await Promise.all([
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
        // Read-only on mobile — RLS (module22) grants a survivor SELECT on
        // their own case's services via owns_case(), but INSERT/UPDATE only
        // to case-owning staff. A referral above and a service below are
        // deliberately rendered as separate sections — a referral never
        // implies a service was provided.
        supabase
          .from('case_services')
          .select('*')
          .eq('case_id', caseId)
          .order('created_at', { ascending: false }),
      ]);
      if (!caseRes.data) {
        setLoadError(true);
        return;
      }
      setCaseReport(caseRes.data);
      setHistory(historyRes.data ?? []);
      setReferrals((referralRes.data as any) ?? []);
      setServices(servicesRes.data ?? []);
    } catch (e) {
      console.error('[CaseDetailScreen] load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useFocusEffect(
    useCallback(() => {
      // Same pattern as CaseListScreen's own focus guard — see its
      // comment for the full reasoning (fresh server re-check, RLS is
      // the real boundary).
      let cancelled = false;
      refreshGrantStatus().then((active) => {
        if (cancelled) return;
        if (!active) {
          navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'CaseDetail', params: { caseId } } });
          return;
        }
        load();
      });
      return () => {
        cancelled = true;
      };
    }, [load, refreshGrantStatus, navigation, caseId])
  );

  // Phase 8: re-lock while this screen stays open and focused past the
  // grant's own window (PasscodeContext's expiry timer, not just a
  // background/focus edge) — clears the already-fetched content from
  // memory rather than leaving it on screen past its authorized window.
  useEffect(() => {
    if (!hasActiveGrant && caseReport) {
      setCaseReport(null);
      setHistory([]);
      setReferrals([]);
      setServices([]);
      navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'CaseDetail', params: { caseId } } });
    }
  }, [hasActiveGrant]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (loadError || !caseReport) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background, padding: spacing.lg }]}>
        <AlertMessage
          variant="error"
          title="We couldn't load this case"
          message="It may be unavailable, or there was a connection problem. Please check your connection and try again."
          onRetry={load}
        />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={[styles.caseNumber, { color: palette.text }]}>{caseReport.case_number}</Text>
          <Text style={[styles.caseType, { color: palette.textMuted }]}>{caseReport.case_type}</Text>
        </View>
        <StatusBadge label={caseReport.status} />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Details</Text>
        <DetailRow label="Priority" value={caseReport.priority_level} />
        <DetailRow label="Incident location" value={caseReport.incident_location} />
        <DetailRow label="Incident date" value={new Date(caseReport.incident_date).toLocaleDateString()} />
        <DetailRow label="Reported" value={new Date(caseReport.reported_at).toLocaleString()} />
        <DetailRow label="Anonymous report" value={caseReport.is_anonymous ? 'Yes' : 'No'} />
        <Text style={[styles.detailLabel, { color: palette.textMuted, marginTop: spacing.sm }]}>Description</Text>
        <Text style={[styles.description, { color: palette.text }]}>{caseReport.description}</Text>
      </Card>

      <Text style={[styles.sectionTitle, { color: palette.text }]}>Status timeline</Text>
      {history.length === 0 ? (
        <EmptyState title="No status updates yet" />
      ) : (
        <Card>
          {history.map((h, idx) => (
            <View key={h.history_id} style={styles.timelineRow}>
              <View style={styles.timelineDotCol}>
                <View style={[styles.timelineDot, { backgroundColor: palette.primary }]} />
                {idx < history.length - 1 && <View style={[styles.timelineLine, { backgroundColor: palette.border }]} />}
              </View>
              <View style={{ flex: 1, paddingBottom: spacing.md }}>
                <Text style={[styles.timelineStatus, { color: palette.text }]}>{h.new_status}</Text>
                {h.remarks ? <Text style={[styles.timelineRemarks, { color: palette.textMuted }]}>{h.remarks}</Text> : null}
                <Text style={[styles.timelineDate, { color: palette.textMuted }]}>{new Date(h.changed_at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {referrals.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Shelter referral</Text>
          {referrals.map((r) => (
            <Card key={r.referral_id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.caseNumber, { color: palette.text }]}>{r.shelters?.shelter_name ?? 'Shelter'}</Text>
                <StatusBadge label={r.referral_status} />
              </View>
              {r.notes ? <Text style={[styles.description, { color: palette.text }]}>{r.notes}</Text> : null}
            </Card>
          ))}
        </>
      )}

      {/* Deliberately a separate section from "Shelter referral" above —
          a referral means help was requested/sent somewhere; a service
          here is marked "Provided" only once it actually happened. */}
      <Text style={[styles.sectionTitle, { color: palette.text }]}>Services Provided</Text>
      {services.length === 0 ? (
        <EmptyState title="No services have been recorded for this case." />
      ) : (
        <Card>
          {services.map((s, idx) => (
            <View key={s.service_id} style={[styles.serviceRow, idx < services.length - 1 ? { borderBottomWidth: 1, borderBottomColor: palette.border } : null]}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={[styles.timelineStatus, { color: palette.text }]}>{serviceTypeLabel(s)}</Text>
                {s.provider_agency ? <Text style={[styles.timelineRemarks, { color: palette.textMuted }]}>{s.provider_agency}</Text> : null}
              </View>
              <StatusBadge label={s.status} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  caseNumber: { ...typography.heading },
  caseType: { ...typography.caption, marginTop: 2 },
  sectionTitle: { ...typography.heading, fontSize: 17, marginTop: spacing.lg, marginBottom: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { ...typography.caption },
  detailValue: { ...typography.bodyMedium },
  description: { ...typography.body, marginTop: spacing.xs },
  timelineRow: { flexDirection: 'row' },
  timelineDotCol: { alignItems: 'center', width: 24 },
  timelineDot: { width: 10, height: 10, borderRadius: radius.pill, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, marginTop: 2 },
  timelineStatus: { ...typography.bodyMedium },
  timelineRemarks: { ...typography.caption, marginTop: 2 },
  timelineDate: { ...typography.caption, marginTop: 2 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
});

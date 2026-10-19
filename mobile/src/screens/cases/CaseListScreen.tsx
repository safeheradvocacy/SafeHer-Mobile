import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '../../contexts/AuthContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { supabase } from '../../lib/supabase';
import { AlertMessage, Card, EmptyState, StatusBadge } from '../../components/ui';
import { ScreenHeader } from '../../components/ScreenHeader';
import { FirstVisitTip } from '../../components/FirstVisitTip';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import type { CaseClientLink, CaseReport } from '../../types/database.types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'CasesTab'>,
  NativeStackNavigationProp<AppStackParamList>
>;

const LINK_STATUS_LABEL: Record<string, string> = {
  pending: 'Verification Pending',
  verified: 'Access Verified',
  rejected: 'Not Approved',
};

export function CaseListScreen() {
  const navigation = useNavigation<Nav>();
  const { palette } = useTheme();
  const { profile } = useAuth();
  const { hasActiveGrant, refreshGrantStatus } = usePasscode();
  const [cases, setCases] = useState<CaseReport[]>([]);
  // A client's own case_client_links rows (module14) — cases reached via
  // the QR/verification workflow rather than submitted through this
  // account's own survivor profile. RLS scopes SELECT to
  // profile_id = current_profile_id(), so this can never surface
  // another client's requests.
  const [links, setLinks] = useState<CaseClientLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoadError(false);
    try {
      const { data: survivorRow } = await supabase
        .from('survivors')
        .select('survivor_id')
        .eq('profile_id', profile.profile_id)
        .single();

      const [caseRes, linkRes] = await Promise.all([
        survivorRow
          ? supabase.from('case_reports').select('*').eq('survivor_id', survivorRow.survivor_id).order('reported_at', { ascending: false })
          : Promise.resolve({ data: [] as CaseReport[] }),
        supabase.from('case_client_links').select('*').eq('profile_id', profile.profile_id).order('requested_at', { ascending: false }),
      ]);

      const caseRows = caseRes.data ?? [];
      const ownedCaseIds = new Set(caseRows.map((c) => c.case_id));
      setCases(caseRows);
      // Defensive de-dup only — in practice a case a survivor already owns
      // outright never also needs a case_client_links row.
      setLinks((linkRes.data ?? []).filter((l) => !ownedCaseIds.has(l.case_id)));
    } catch (e) {
      console.error('[CaseListScreen] load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      // Re-checked fresh against the server on every focus (not the
      // client's own possibly-stale `hasActiveGrant` belief) — this is
      // the UI-layer half of Phase 7's "do not fetch or display protected
      // information before the required verification"; the RLS policies
      // on case_reports/case_status_history (module33) are the actual
      // trusted-backend half, enforced regardless of what this check
      // concludes.
      let cancelled = false;
      refreshGrantStatus().then((active) => {
        if (cancelled) return;
        if (!active) {
          navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'Tabs', params: { screen: 'CasesTab' } } });
          return;
        }
        load();
      });
      return () => {
        cancelled = true;
      };
    }, [load, refreshGrantStatus, navigation])
  );

  // Phase 8: see CaseDetailScreen's identical comment — re-locks a case
  // list left open past the grant's window, not just on background/focus.
  useEffect(() => {
    if (!hasActiveGrant && cases.length > 0) {
      setCases([]);
      setLinks([]);
      navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'Tabs', params: { screen: 'CasesTab' } } });
    }
  }, [hasActiveGrant]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const qrButton = (
    <Pressable
      onPress={() => navigation.navigate('ScanCaseQr')}
      hitSlop={8}
      style={styles.qrButton}
      accessibilityRole="button"
      accessibilityLabel="Scan Case Access QR"
    >
      <Ionicons name="qr-code-outline" size={20} color={palette.primary} />
    </Pressable>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <ScreenHeader title="My Cases" trailing={qrButton} />
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <ScreenHeader title="My Cases" trailing={qrButton} />
        <View style={[styles.center, { padding: spacing.lg }]}>
          <AlertMessage variant="error" title="We couldn't load your cases" message="Please check your connection and try again." onRetry={load} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title="My Cases" trailing={qrButton} />
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        data={cases}
        keyExtractor={(item) => item.case_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <FirstVisitTip
            id="cases"
            title="Track your cases here"
            body="Select a case to view its status and available information."
          />
        }
        ListHeaderComponentStyle={{ marginHorizontal: -spacing.lg, marginTop: -spacing.lg }}
        ListFooterComponent={
        links.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.subheading, { color: palette.text, marginBottom: spacing.sm }]}>Linked via Case Access QR</Text>
            {links.map((l) => {
              const canOpen = l.status === 'verified';
              return (
                <Pressable key={l.link_id} disabled={!canOpen} onPress={() => canOpen && navigation.navigate('LinkedCaseDetail', { caseId: l.case_id })}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[styles.caseNumber, { color: palette.text }]}>{l.case_number}</Text>
                      <StatusBadge label={LINK_STATUS_LABEL[l.status] ?? l.status} />
                    </View>
                    {l.status === 'pending' && (
                      <Text style={[typography.caption, { color: palette.textMuted, marginTop: spacing.xs }]}>
                        Awaiting review by the issuing office.
                      </Text>
                    )}
                    {l.status === 'rejected' && l.rejection_reason && (
                      <Text style={[typography.caption, { color: palette.textMuted, marginTop: spacing.xs }]}>{l.rejection_reason}</Text>
                    )}
                  </Card>
                </Pressable>
              );
            })}
          </View>
        ) : null
      }
      ListEmptyComponent={
        links.length === 0 ? (
          <EmptyState title="No reports yet" subtitle="Reports you submit will appear here so you can track their progress." />
        ) : null
      }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('CaseDetail', { caseId: item.case_id })}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.caseNumber, { color: palette.text }]}>{item.case_number}</Text>
                <StatusBadge label={item.status} />
              </View>
              <Text style={[styles.caseType, { color: palette.textMuted }]}>{item.case_type}</Text>
              <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
                <StatusBadge label={item.priority_level} />
              </View>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  qrButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  caseNumber: { ...typography.subheading },
  caseType: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.xs },
});

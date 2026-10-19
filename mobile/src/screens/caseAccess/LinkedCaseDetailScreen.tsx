import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { AlertMessage, Card, EmptyState, StatusBadge } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { usePasscode } from '../../contexts/PasscodeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { ClientCaseProjection } from '../../types/database.types';

/**
 * "My Case" — the client-safe view for a case reached via the QR/
 * verification workflow (module14). Sourced ENTIRELY from the
 * get_client_case RPC, which returns null unless the caller has a
 * 'verified' case_client_links row for this case — never the raw
 * case_reports table. Deliberately shows the same reduced field set the
 * spec calls for (case number/type/date/status/assigned office/
 * referral/status updates) — no survivor identity, no incident
 * narrative, no administrative notes, no staff contact details.
 */
export function LinkedCaseDetailScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'LinkedCaseDetail'>>();
  const route = useRoute<RouteProp<AppStackParamList, 'LinkedCaseDetail'>>();
  const { caseId } = route.params;
  const { hasActiveGrant, refreshGrantStatus } = usePasscode();

  const [data, setData] = useState<ClientCaseProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [notAuthorized, setNotAuthorized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: projection, error } = await supabase.rpc('get_client_case', { p_case_id: caseId });
      if (error || !projection) {
        setNotAuthorized(true);
        setData(null);
      } else {
        setNotAuthorized(false);
        setData(projection as ClientCaseProjection);
      }
    } catch (e) {
      // Same fail-safe behavior as a returned {error} above — this
      // screen's own existing design never distinguishes "revoked" from
      // a connection problem (module14's session-security requirement
      // prioritizes never showing stale/cached case data over a more
      // specific error message).
      console.error('[LinkedCaseDetailScreen] load:', e);
      setNotAuthorized(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useFocusEffect(
    useCallback(() => {
      // Re-checked every time this screen gains focus — a logout on this
      // device followed by a different account signing in, or the
      // admin later revoking/rejecting access, must never leave a stale
      // cached view on screen (module14's session-security requirement).
      // The passcode grant check below is the same pattern
      // CaseDetailScreen/CaseListScreen use — this is the one real
      // content-bearing read in the QR/walk-in flow (get_client_case
      // itself also independently requires an active grant server-side,
      // module33 — this is the matching UI-layer pre-check so the screen
      // doesn't even attempt the RPC, rather than attempting it and
      // showing a misleading "not authorized" for what's actually "not
      // verified yet").
      let cancelled = false;
      refreshGrantStatus().then((active) => {
        if (cancelled) return;
        if (!active) {
          navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'LinkedCaseDetail', params: { caseId } } });
          return;
        }
        load();
      });
      return () => {
        cancelled = true;
      };
    }, [load, refreshGrantStatus, navigation, caseId])
  );

  // Phase 8: same re-lock-while-open pattern as CaseDetailScreen.
  useEffect(() => {
    if (!hasActiveGrant && data) {
      setData(null);
      navigation.navigate('VerifySecurityPasscode', { returnTo: { screen: 'LinkedCaseDetail', params: { caseId } } });
    }
  }, [hasActiveGrant]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <View style={[styles(palette).center]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (notAuthorized || !data) {
    return (
      <View style={[styles(palette).screen, { padding: spacing.lg }]}>
        <AlertMessage variant="error" title="Case Not Available" message="You are not authorized to access this case." />
      </View>
    );
  }

  return (
    <ScrollView style={styles(palette).screen} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={[typography.heading, { color: palette.text }]}>{data.case_number}</Text>
          <Text style={[typography.caption, { color: palette.textMuted, marginTop: 2 }]}>{data.case_type}</Text>
        </View>
        <StatusBadge label={data.status} />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[typography.heading, { fontSize: 17, color: palette.text, marginBottom: spacing.sm }]}>Details</Text>
        <DetailRow label="Priority" value={data.priority_level} palette={palette} />
        <DetailRow label="Reported" value={new Date(data.reported_at).toLocaleDateString()} palette={palette} />
        <DetailRow label="Assigned Office" value={data.assigned_office} palette={palette} />
        {data.referral_status && <DetailRow label="Referral Status" value={data.referral_status} palette={palette} />}
      </Card>

      <Text style={[typography.heading, { fontSize: 17, color: palette.text, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
        Case Updates
      </Text>
      {data.status_history.length === 0 ? (
        <EmptyState title="No status updates yet" />
      ) : (
        <Card>
          {data.status_history.map((h, idx) => (
            <View key={idx} style={{ flexDirection: 'row' }}>
              <View style={{ alignItems: 'center', width: 24 }}>
                <View style={{ width: 10, height: 10, borderRadius: radius.pill, marginTop: 4, backgroundColor: palette.primary }} />
                {idx < data.status_history.length - 1 && <View style={{ width: 2, flex: 1, marginTop: 2, backgroundColor: palette.border }} />}
              </View>
              <View style={{ flex: 1, paddingBottom: spacing.md }}>
                <Text style={[typography.bodyMedium, { color: palette.text }]}>{h.status}</Text>
                {h.remarks ? <Text style={[typography.caption, { color: palette.textMuted, marginTop: 2 }]}>{h.remarks}</Text> : null}
                <Text style={[typography.caption, { color: palette.textMuted, marginTop: 2 }]}>{new Date(h.changed_at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function DetailRow({ label, value, palette }: { label: string; value: string; palette: { textMuted: string; text: string } }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={[typography.caption, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[typography.bodyMedium, { color: palette.text }]}>{value}</Text>
    </View>
  );
}

function styles(palette: { background: string }) {
  return {
    screen: { flex: 1, backgroundColor: palette.background },
    center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: palette.background },
  };
}

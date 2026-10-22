import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertMessage } from '../../components/ui';
import { SosAlertStatusCard } from '../../components/sos/SosAlertStatusCard';
import { SosAlertTimeline } from '../../components/sos/SosAlertTimeline';
import { SosAlertMapCard } from '../../components/sos/SosAlertMapCard';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { SosAlert } from '../../types/database.types';

/**
 * Detail view for ONE historical (or still-active) SOS alert, opened from
 * SosHistoryScreen. `sosId` comes from the route param, but every query
 * here still explicitly scopes to the signed-in survivor's own
 * profile_id — defense in depth on top of RLS (the real boundary), the
 * same "never trust the route param alone" posture this app already
 * uses elsewhere (e.g. CaseDetailScreen's own case_id-scoped queries). A
 * tampered sosId belonging to someone else simply returns no row, not
 * another survivor's alert.
 */
export function SosHistoryDetailScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'SosHistoryDetail'>>();
  const { profile } = useAuth();
  const { palette } = useTheme();
  const [sos, setSos] = useState<SosAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!profile) return;
      if (isRefresh) setRefreshing(true);
      const { data } = await supabase
        .from('sos_alerts')
        .select('*')
        .eq('sos_id', route.params.sosId)
        .eq('profile_id', profile.profile_id)
        .maybeSingle();
      setSos(data ?? null);
      setNotFound(!data);
      setLoading(false);
      setRefreshing(false);
    },
    [profile, route.params.sosId]
  );

  // Refresh when the user returns to this screen (brief, Phase 6).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live updates for this specific alert only — same scoped pattern
  // SosScreen already uses for its active alert, reused here so a
  // historical-but-still-open alert (Triggered/Responding) reflects a
  // responder's action without the user needing to pull-to-refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`sos-detail-${route.params.sosId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: `sos_id=eq.${route.params.sosId}` },
        (payload) => setSos(payload.new as SosAlert)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [route.params.sosId]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (notFound || !sos) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <AlertMessage variant="error" title="Alert not found" message="This SOS record is unavailable or you don't have access to it." />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.primary} />}
    >
      <Text style={[styles.reference, { color: palette.textMuted }]}>SOS-{sos.sos_id.slice(0, 8).toUpperCase()}</Text>
      <SosAlertStatusCard sos={sos} />
      <SosAlertTimeline sos={sos} />
      <SosAlertMapCard sos={sos} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reference: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, marginBottom: spacing.xs },
});

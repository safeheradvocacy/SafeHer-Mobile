import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useActiveSosLocationUpdates } from '../../lib/useActiveSosLocationUpdates';
import { SosConfirmSheet } from '../home/SosConfirmSheet';
import { ScreenHeader } from '../../components/ScreenHeader';
import { PressableScale } from '../../components/ui';
import { SosAlertStatusCard } from '../../components/sos/SosAlertStatusCard';
import { SosAlertTimeline } from '../../components/sos/SosAlertTimeline';
import { SosAlertMapCard } from '../../components/sos/SosAlertMapCard';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { SosAlert } from '../../types/database.types';

// Realtime ('*'/UPDATE postgres_changes below) is the primary path, same
// as before — this is only the bounded fallback for the case realtime
// itself goes stale/silently drops while the screen stays open and
// focused a long time, mirroring the spirit (not the exact interval) of
// useActiveSosLocationUpdates' own 45s location-write poll, without
// adding a second, unrelated polling mechanism when the user navigates
// away (gated on `enabled` below, same as that hook already is).
const STATUS_REFRESH_MS = 60_000;

export function SosScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { palette } = useTheme();
  const { profile } = useAuth();
  const isFocused = useIsFocused();
  const [activeSos, setActiveSos] = useState<SosAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  useActiveSosLocationUpdates(activeSos, isFocused);

  const loadActive = useCallback(
    async (isRefresh = false) => {
      if (!profile) return;
      if (isRefresh) setRefreshing(true);
      const { data } = await supabase
        .from('sos_alerts')
        .select('*')
        .eq('profile_id', profile.profile_id)
        .in('status', ['Triggered', 'Responding'])
        .order('triggered_at', { ascending: false })
        .limit(1);
      setActiveSos(data?.[0] ?? null);
      setLoading(false);
      setRefreshing(false);
    },
    [profile]
  );

  useFocusEffect(
    useCallback(() => {
      loadActive();
    }, [loadActive])
  );

  // Live updates: when an admin/officer marks this alert Responding /
  // Resolved, reflect it immediately without the user needing to refresh.
  useEffect(() => {
    if (!activeSos) return;
    const channel = supabase
      .channel(`sos-${activeSos.sos_id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: `sos_id=eq.${activeSos.sos_id}` },
        (payload) => setActiveSos(payload.new as SosAlert)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSos?.sos_id]);

  // Bounded staleness fallback — only while there's an active alert AND
  // the screen is actually focused; never runs in the background.
  useEffect(() => {
    if (!activeSos || !isFocused) return;
    const id = setInterval(() => loadActive(), STATUS_REFRESH_MS);
    return () => clearInterval(id);
  }, [activeSos?.sos_id, isFocused, loadActive]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <ScreenHeader title="SOS Status" />
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title="SOS Status" />
      <Text style={[styles.headerSubtitle, { color: palette.textMuted }]}>View your emergency alert and response updates.</Text>

      {activeSos ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.activeWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadActive(true)} tintColor={palette.primary} />}
        >
          <SosAlertStatusCard sos={activeSos} />
          <SosAlertTimeline sos={activeSos} />
          <SosAlertMapCard sos={activeSos} />

          {/* No cancellation action here — confirmed by schema/RLS audit:
              SosStatus has no 'Cancelled' value and survivors hold no
              UPDATE grant on sos_alerts.status (validate_sos_alert_update()
              only allows law_enforcement/admin roles to change it), so
              there is no backend-supported way for a survivor to cancel
              an already-triggered alert today. */}

          <Pressable onPress={() => navigation.navigate('SosHistory')} style={styles.historyLink} accessibilityRole="button">
            <Text style={[styles.historyLinkText, { color: palette.primary }]}>View SOS History</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.primary} />
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <PressableScale
            onPress={() => setConfirmVisible(true)}
            disabled={confirmVisible}
            style={[styles.sosButton, { backgroundColor: palette.danger }]}
            accessibilityRole="button"
            accessibilityLabel="Send SOS"
            accessibilityHint="Opens the emergency SOS confirmation"
            pressScale={0.97}
          >
            <Text style={[styles.sosButtonText, { color: palette.white }]}>SOS</Text>
          </PressableScale>
          <Text style={[styles.helperText, { color: palette.textMuted }]}>
            Press and confirm to send your location to an emergency responder
          </Text>

          <Pressable onPress={() => navigation.navigate('SosHistory')} style={styles.historyLink} accessibilityRole="button">
            <Text style={[styles.historyLinkText, { color: palette.primary }]}>View SOS History</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.primary} />
          </Pressable>
        </View>
      )}

      <SosConfirmSheet
        visible={confirmVisible}
        onClose={() => setConfirmVisible(false)}
        profileId={profile?.profile_id}
        onActivated={(sos) => {
          setConfirmVisible(false);
          setActiveSos(sos);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerSubtitle: { ...typography.body, paddingHorizontal: spacing.lg, marginTop: -spacing.xs, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButtonText: { fontSize: 40, fontFamily: 'PlusJakartaSans_700Bold' as any },
  helperText: { ...typography.body, textAlign: 'center', marginTop: spacing.xl },
  activeWrap: { padding: spacing.lg, paddingBottom: spacing.xxl },
  historyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: spacing.xl, padding: spacing.sm },
  historyLinkText: { ...typography.bodyMedium },
});

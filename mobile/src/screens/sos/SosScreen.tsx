import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useActiveSosLocationUpdates } from '../../lib/useActiveSosLocationUpdates';
import { locationQuality } from '../../lib/sosLocation';
import { MapErrorBoundary } from '../../components/MapErrorBoundary';
import { SosConfirmSheet } from '../home/SosConfirmSheet';
import { ScreenHeader } from '../../components/ScreenHeader';
import { StatusBadge, PressableScale } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

// Never shows raw coordinates to the survivor — just a coarse read on how
// much responders can trust the pin. LAST_KNOWN is always "Approximate"
// regardless of its accuracy radius, since it's not a fresh fix.
function locationStatusLabel(sos: SosAlert): 'Unavailable' | 'Approximate' | 'Available' {
  if (sos.location_source === 'UNAVAILABLE' || sos.latitude == null || sos.longitude == null) return 'Unavailable';
  if (sos.location_source === 'LAST_KNOWN') return 'Approximate';
  const quality = locationQuality(sos.location_accuracy);
  return quality === 'Excellent' || quality === 'Good' ? 'Available' : 'Approximate';
}

export function SosScreen() {
  const { palette } = useTheme();
  const { profile } = useAuth();
  const isFocused = useIsFocused();
  const [activeSos, setActiveSos] = useState<SosAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const { lastUpdatedAt } = useActiveSosLocationUpdates(activeSos, isFocused);

  const loadActive = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('sos_alerts')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .in('status', ['Triggered', 'Responding'])
      .order('triggered_at', { ascending: false })
      .limit(1);
    setActiveSos(data?.[0] ?? null);
    setLoading(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      loadActive();
    }, [loadActive])
  );

  // Live updates: when an admin marks this alert Responding / Resolved,
  // reflect it immediately without the user needing to refresh.
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

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <ScreenHeader title="SOS" />
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      </View>
    );
  }

  const statusLabel = activeSos ? locationStatusLabel(activeSos) : null;
  const hasMapPosition = activeSos?.latitude != null && activeSos?.longitude != null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title="SOS" />
      {activeSos ? (
        <View style={styles.activeWrap}>
          <StatusBadge label={activeSos.status} />
          <Text style={[styles.activeTitle, { color: palette.text }]}>
            {activeSos.status === 'Triggered' ? 'Help is on the way' : 'A responder is handling your alert'}
          </Text>
          <Text style={[styles.activeBody, { color: palette.textMuted }]}>
            Your location was sent at {new Date(activeSos.triggered_at).toLocaleTimeString()}. Stay in a safe
            place if you can.
          </Text>
          {activeSos.location_address ? (
            <Text style={[styles.activeAddress, { color: palette.textMuted }]}>{activeSos.location_address}</Text>
          ) : null}

          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: statusLabel === 'Available' ? palette.success : statusLabel === 'Approximate' ? palette.warning : palette.danger }]} />
            <Text style={[styles.locationStatusText, { color: palette.textMuted }]}>Location: {statusLabel}</Text>
            {lastUpdatedAt ? (
              <Text style={[styles.locationStatusText, { color: palette.textMuted }]}> · Last updated: {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            ) : null}
          </View>

          <View style={[styles.mapWrap, { borderColor: palette.border }]}>
            {hasMapPosition ? (
              <MapErrorBoundary
                palette={palette}
                fallbackMessage="Map unavailable — your alert is still active and responders have your location."
                style={styles.mapFallback}
              >
                <MapView
                  style={StyleSheet.absoluteFill}
                  region={{
                    latitude: activeSos.latitude as number,
                    longitude: activeSos.longitude as number,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                >
                  <Marker coordinate={{ latitude: activeSos.latitude as number, longitude: activeSos.longitude as number }} pinColor={palette.danger} title="Your location" />
                </MapView>
              </MapErrorBoundary>
            ) : (
              <View style={[styles.mapFallback, { backgroundColor: palette.surfaceMuted }]}>
                <Text style={{ color: palette.textMuted, ...typography.caption }}>No location available for this alert.</Text>
              </View>
            )}
          </View>
        </View>
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
  activeWrap: { flex: 1, padding: spacing.xl },
  activeTitle: { ...typography.heading, marginTop: spacing.md },
  activeBody: { ...typography.body, marginTop: spacing.sm },
  activeAddress: { ...typography.caption, marginTop: spacing.md },
  locationRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.md },
  locationDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  locationStatusText: { ...typography.caption },
  mapWrap: { height: 200, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', marginTop: spacing.lg },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
});

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { StatusBadge } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

export function SosScreen() {
  const { profile } = useAuth();
  const [activeSos, setActiveSos] = useState<SosAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

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

  const triggerSos = async () => {
    if (!profile) return;
    setTriggering(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'SafeHer needs location access to send your position with an SOS alert.');
        setTriggering(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      let address = '';
      try {
        const geocoded = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        if (geocoded[0]) {
          address = [geocoded[0].street, geocoded[0].city, geocoded[0].region].filter(Boolean).join(', ');
        }
      } catch {
        // Reverse geocoding is best-effort; lat/lng alone is enough to respond.
      }

      const { data: sosRow, error } = await supabase
        .from('sos_alerts')
        .insert({
          profile_id: profile.profile_id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          location_address: address || null,
          status: 'Triggered',
        })
        .select()
        .single();

      if (error || !sosRow) {
        Alert.alert('Could not send SOS', error?.message ?? 'Please try again or call emergency services directly.');
      } else {
        setActiveSos(sosRow);
        await logAudit({
          profileId: profile.profile_id,
          action: 'INSERT',
          tableName: 'sos_alerts',
          recordId: sosRow.sos_id,
          newValues: sosRow,
        });
      }
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {activeSos ? (
        <View style={styles.activeWrap}>
          <StatusBadge label={activeSos.status} />
          <Text style={styles.activeTitle}>
            {activeSos.status === 'Triggered' ? 'Help is on the way' : 'A responder is handling your alert'}
          </Text>
          <Text style={styles.activeBody}>
            Your location was sent at {new Date(activeSos.triggered_at).toLocaleTimeString()}. Stay in a safe
            place if you can.
          </Text>
          {activeSos.location_address ? <Text style={styles.activeAddress}>{activeSos.location_address}</Text> : null}
        </View>
      ) : (
        <View style={styles.center}>
          <Pressable onPress={triggerSos} disabled={triggering} style={styles.sosButton}>
            {triggering ? (
              <ActivityIndicator color={colors.white} size="large" />
            ) : (
              <Text style={styles.sosButtonText}>SOS</Text>
            )}
          </Pressable>
          <Text style={styles.helperText}>Press and confirm to send your location to an emergency responder</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButtonText: { color: colors.white, fontSize: 40, fontFamily: 'PlusJakartaSans_700Bold' as any },
  helperText: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  activeWrap: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  activeTitle: { ...typography.heading, color: colors.text, marginTop: spacing.md },
  activeBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
  activeAddress: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
});

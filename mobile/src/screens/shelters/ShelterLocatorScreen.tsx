import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Linking, Pressable } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { AlertMessage, Card, EmptyState, PrimaryButton } from '../../components/ui';
import { ScreenHeader } from '../../components/ScreenHeader';
import { FirstVisitTip } from '../../components/FirstVisitTip';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import { distanceKm } from '../../lib/geo';
import { MapErrorBoundary } from '../../components/MapErrorBoundary';
import type { Shelter } from '../../types/database.types';

type Nav = CompositeNavigationProp<BottomTabNavigationProp<AppTabParamList, 'SheltersTab'>, NativeStackNavigationProp<AppStackParamList>>;

export function ShelterLocatorScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<Nav>();
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase.from('shelters').select('*').eq('is_active', true);
      if (error) throw error;
      setShelters(data ?? []);

      // Foreground location is purely an optional convenience for
      // nearest-first sorting — denying it (or it failing) never blocks
      // shelter discovery, matching the brief's "search without requiring
      // precise location sharing" requirement.
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      } catch {
        // Location unavailable — shelters still show, just unsorted by distance.
      }
    } catch (e) {
      console.error('[ShelterLocatorScreen] load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = userLocation
    ? [...shelters].sort(
        (a, b) =>
          distanceKm(userLocation.latitude, userLocation.longitude, a.latitude ?? 0, a.longitude ?? 0) -
          distanceKm(userLocation.latitude, userLocation.longitude, b.latitude ?? 0, b.longitude ?? 0)
      )
    : shelters;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title="Shelters" />
      <FirstVisitTip
        id="shelters"
        title="Find available shelter support"
        body="Explore shelter information and available services."
      />
      <View style={[styles.mapWrap, { borderColor: palette.border }]}>
        <MapErrorBoundary palette={palette} fallbackMessage="Map unavailable — shelters are still listed below.">
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={{
              latitude: userLocation?.latitude ?? 15.75,
              longitude: userLocation?.longitude ?? 121.55,
              latitudeDelta: 0.5,
              longitudeDelta: 0.5,
            }}
          >
            {shelters
              .filter((s) => s.latitude && s.longitude)
              .map((s) => (
                <Marker
                  key={s.shelter_id}
                  coordinate={{ latitude: s.latitude!, longitude: s.longitude! }}
                  title={s.shelter_name}
                  description={s.address}
                />
              ))}
          </MapView>
        </MapErrorBoundary>
      </View>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg }}
        data={sorted}
        keyExtractor={(s) => s.shelter_id}
        ListEmptyComponent={
          loading ? null : loadError ? (
            <AlertMessage variant="error" title="We couldn't load shelters" message="Please check your connection and try again." onRetry={load} />
          ) : (
            <EmptyState title="No shelters found" />
          )
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={[styles.name, { color: palette.text }]}>{item.shelter_name}</Text>
            <Text style={[styles.address, { color: palette.textMuted }]}>{item.address}</Text>
            {userLocation && item.latitude && item.longitude && (
              <Text style={[styles.distance, { color: palette.primary }]}>
                {distanceKm(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(1)} km away
              </Text>
            )}
            <Text style={[styles.capacity, { color: palette.textMuted }]}>
              Capacity: {item.current_occupancy}/{item.capacity ?? '—'}
            </Text>
            {item.services_available ? (
              <Text style={[styles.capacity, { color: palette.textMuted }]}>Services: {item.services_available}</Text>
            ) : null}

            <View style={styles.actionsRow}>
              {item.contact_number && (
                <Pressable onPress={() => Linking.openURL(`tel:${item.contact_number}`)}>
                  <Text style={[styles.call, { color: palette.primary }]}>Call</Text>
                </Pressable>
              )}
              {item.latitude != null && item.longitude != null && (
                <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`)}>
                  <Text style={[styles.call, { color: palette.primary }]}>Directions</Text>
                </Pressable>
              )}
            </View>

            <View style={{ marginTop: spacing.sm }}>
              <PrimaryButton title="Request this shelter" size="md" onPress={() => navigation.navigate('RequestShelter', { shelterId: item.shelter_id })} />
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  mapWrap: { height: 200, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', margin: spacing.lg, marginBottom: spacing.sm },
  name: { ...typography.subheading },
  address: { ...typography.caption, marginTop: 2 },
  distance: { ...typography.caption, marginTop: spacing.xs },
  capacity: { ...typography.caption, marginTop: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  call: { ...typography.bodyMedium },
  radiusHelper: { borderRadius: radius.sm },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Linking, Pressable } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { Card, EmptyState } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import type { Shelter } from '../../types/database.types';

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function ShelterLocatorScreen() {
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('shelters').select('*').eq('is_active', true);
      setShelters(data ?? []);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      }
      setLoading(false);
    })();
  }, []);

  const sorted = userLocation
    ? [...shelters].sort(
        (a, b) =>
          distanceKm(userLocation.latitude, userLocation.longitude, a.latitude ?? 0, a.longitude ?? 0) -
          distanceKm(userLocation.latitude, userLocation.longitude, b.latitude ?? 0, b.longitude ?? 0)
      )
    : shelters;

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrap}>
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
      </View>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg }}
        data={sorted}
        keyExtractor={(s) => s.shelter_id}
        ListEmptyComponent={!loading ? <EmptyState title="No shelters found" /> : null}
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.name}>{item.shelter_name}</Text>
            <Text style={styles.address}>{item.address}</Text>
            {userLocation && item.latitude && item.longitude && (
              <Text style={styles.distance}>
                {distanceKm(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude).toFixed(1)} km away
              </Text>
            )}
            <Text style={styles.capacity}>
              Capacity: {item.current_occupancy}/{item.capacity}
            </Text>
            {item.contact_number && (
              <Pressable onPress={() => Linking.openURL(`tel:${item.contact_number}`)}>
                <Text style={styles.call}>Call {item.contact_number}</Text>
              </Pressable>
            )}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  mapWrap: { height: 220, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { ...typography.subheading, color: colors.text },
  address: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  distance: { ...typography.caption, color: colors.primary, marginTop: spacing.xs },
  capacity: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  call: { ...typography.bodyMedium, color: colors.primary, marginTop: spacing.xs },
  radiusHelper: { borderRadius: radius.sm },
});

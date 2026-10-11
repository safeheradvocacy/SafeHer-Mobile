import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, SafeAreaView } from 'react-native';
import MapView, { Marker, type Region, type LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';
import { AlertMessage, PrimaryButton } from './ui';
import { MapErrorBoundary } from './MapErrorBoundary';
import { preflightLocation, acquireSosLocation } from '../lib/sosLocation';
import type { AddressLocationSource } from '../types/database.types';

// Approximate Aurora municipality town-center coordinates — used ONLY for
// the "does this pin look plausible" sanity-check warning below, never
// stored or treated as authoritative. No municipality boundary/polygon
// data exists anywhere in this project's schema (confirmed) — a real
// boundary check would need real GIS data this app doesn't have.
const MUNICIPALITY_CENTERS: Record<string, LatLng> = {
  baler: { latitude: 15.7592, longitude: 121.5629 },
  casiguran: { latitude: 16.2667, longitude: 122.1333 },
  dilasag: { latitude: 16.5667, longitude: 122.2833 },
  dinalungan: { latitude: 16.1167, longitude: 122.0 },
  dingalan: { latitude: 15.3833, longitude: 121.4 },
  dipaculao: { latitude: 15.9333, longitude: 121.6 },
  'maria aurora': { latitude: 15.7333, longitude: 121.3667 },
  'san luis': { latitude: 15.6333, longitude: 121.3167 },
};

// Beyond this, the confirmed pin is treated as implausibly far from the
// selected municipality to be a simple mis-tap — shown as a warning the
// user can dismiss and confirm anyway, never a hard block.
const IMPLAUSIBLE_DISTANCE_KM = 25;

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Default starting view (Baler, the provincial capital) when no
// existing coordinates are available at all.
const DEFAULT_REGION: Region = { latitude: 15.7592, longitude: 121.5629, latitudeDelta: 0.15, longitudeDelta: 0.15 };

export interface LocationPickerResult {
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
  source: AddressLocationSource;
}

export function LocationMapPicker({
  visible,
  onClose,
  initialLatitude,
  initialLongitude,
  municipalityName,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  /** Used only for the approximate distance sanity-check warning below. */
  municipalityName?: string | null;
  onConfirm: (result: LocationPickerResult) => void;
}) {
  const { palette } = useTheme();
  const mapRef = useRef<MapView>(null);
  const [pin, setPin] = useState<LatLng | null>(
    initialLatitude != null && initialLongitude != null ? { latitude: initialLatitude, longitude: initialLongitude } : null
  );
  const [source, setSource] = useState<AddressLocationSource>('map_pin');
  const [address, setAddress] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Reset to the passed-in starting point every time the picker opens —
  // otherwise a cancelled previous attempt would leak into the next open.
  useEffect(() => {
    if (!visible) return;
    setPin(initialLatitude != null && initialLongitude != null ? { latitude: initialLatitude, longitude: initialLongitude } : null);
    setSource('map_pin');
    setAddress(null);
    setLocateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const reverseGeocode = async (coords: LatLng) => {
    setGeocoding(true);
    try {
      const geocoded = await Location.reverseGeocodeAsync(coords);
      const first = geocoded[0];
      setAddress(first ? [first.street, first.city, first.region].filter(Boolean).join(', ') || null : null);
    } catch {
      setAddress(null); // best-effort — coordinates alone are still usable
    } finally {
      setGeocoding(false);
    }
  };

  const placePin = (coords: LatLng, nextSource: AddressLocationSource) => {
    setPin(coords);
    setSource(nextSource);
    reverseGeocode(coords);
  };

  const onUseCurrentLocation = async () => {
    setLocating(true);
    setLocateError(null);
    const preflight = await preflightLocation();
    if (!preflight.ok) {
      setLocating(false);
      setLocateError(
        preflight.reason === 'services-disabled'
          ? 'Location services are turned off on this device. Please enable them, or drop the pin manually.'
          : "SafeSpace doesn't have permission to use your location. Please drop the pin manually, or enable location access in your device settings."
      );
      return;
    }
    const result = await acquireSosLocation();
    setLocating(false);
    if (result.latitude == null || result.longitude == null) {
      setLocateError("Couldn't determine your current location. Please drop the pin manually.");
      return;
    }
    const coords = { latitude: result.latitude, longitude: result.longitude };
    placePin(coords, 'current_location');
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  const municipalityCenter = municipalityName ? MUNICIPALITY_CENTERS[municipalityName.trim().toLowerCase()] : undefined;
  const distanceWarning =
    pin && municipalityCenter && haversineKm(pin, municipalityCenter) > IMPLAUSIBLE_DISTANCE_KM
      ? `This pin looks far from ${municipalityName}. Please double-check your address, or adjust the pin if needed.`
      : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { borderBottomColor: palette.border }]}>
          <Text style={[styles.headerTitle, { color: palette.text }]}>Set your location</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>

        <MapErrorBoundary palette={palette} fallbackMessage="The map couldn't be loaded on this device. You can still confirm using your current location." style={styles.flex}>
          <MapView
            ref={mapRef}
            style={styles.flex}
            initialRegion={pin ? { ...pin, latitudeDelta: 0.03, longitudeDelta: 0.03 } : DEFAULT_REGION}
            onPress={(e) => placePin(e.nativeEvent.coordinate, 'map_pin')}
          >
            {pin ? (
              <Marker
                coordinate={pin}
                draggable
                onDragEnd={(e) => placePin(e.nativeEvent.coordinate, 'map_pin')}
              />
            ) : null}
          </MapView>
        </MapErrorBoundary>

        <View style={[styles.panel, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
          {!pin ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>Tap the map to drop a pin, or use your current location.</Text>
          ) : (
            <View style={styles.addressRow}>
              <Ionicons name="location" size={16} color={palette.primary} />
              <Text style={[styles.addressText, { color: palette.text }]} numberOfLines={2}>
                {geocoding ? 'Looking up address...' : address ?? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
              </Text>
            </View>
          )}

          {distanceWarning ? <AlertMessage variant="info" title="Double-check this location" message={distanceWarning} /> : null}
          {locateError ? <AlertMessage variant="error" title="Location unavailable" message={locateError} /> : null}

          <Pressable onPress={onUseCurrentLocation} style={styles.currentLocationBtn} disabled={locating} accessibilityRole="button">
            {locating ? <ActivityIndicator color={palette.primary} /> : <Ionicons name="locate" size={18} color={palette.primary} />}
            <Text style={[styles.currentLocationText, { color: palette.primary }]}>
              {locating ? 'Getting your location...' : 'Use My Current Location'}
            </Text>
          </Pressable>

          <PrimaryButton
            title="Confirm Location"
            onPress={() => {
              if (!pin) return;
              onConfirm({ latitude: pin.latitude, longitude: pin.longitude, formattedAddress: address, source });
            }}
            disabled={!pin}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerTitle: { ...typography.heading, fontSize: 17 },
  panel: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  hint: { ...typography.body, marginBottom: spacing.sm },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginBottom: spacing.sm },
  addressText: { ...typography.bodyMedium, flex: 1 },
  currentLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  currentLocationText: { ...typography.bodyMedium },
});

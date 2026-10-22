import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { MapErrorBoundary } from '../MapErrorBoundary';
import { SectionHeader } from '../ui';
import { locationQuality } from '../../lib/sosLocation';
import { toFiniteCoord, isValidLatLng } from '../../lib/coords';
import { radius, spacing, typography } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

const CARD_HEIGHT = 240; // within the 220-280pt range this was redesigned for

function freshnessLabel(iso: string | null): string {
  if (!iso) return 'Location update time unavailable.';
  return `Last location update: ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Fixed, redesigned replacement for the old oversized, blank-tiles map.
 *
 * ROOT CAUSE OF THE BLANK MAP: sos_alerts.latitude/longitude are Postgres
 * `decimal(10,8)`/`decimal(11,8)` columns — PostgREST's documented default
 * serializes `numeric`/`decimal` columns as JSON *strings*, not numbers,
 * to avoid float precision loss. The old code passed `activeSos.latitude`/
 * `longitude` straight into MapView's `region`/Marker `coordinate` props.
 * Every other place those same fields were read (distance math, accuracy
 * comparisons) kept "working" anyway because `-`, `*`, `Math.sin`, `<=`
 * all silently coerce a numeric-looking string to a number — but the
 * react-native-maps native bridge does NOT coerce a string where its
 * native prop setter expects a real `number`, so the camera region/marker
 * position was silently never applied, leaving the native Google Maps
 * view mounted but un-positioned (exactly "blank, just the Google logo").
 * `toFiniteCoord` below fixes this at the one place it actually breaks,
 * and is a safe no-op if the values ever do arrive as real numbers.
 *
 * This card is read-only display of an ALREADY-RECORDED alert location —
 * it never calls any location-permission API itself, so there is no
 * "permission denied" state to handle here (brief: "do not unnecessarily
 * request the user's current location merely to display an already
 * recorded alert location").
 */
export function SosAlertMapCard({ sos, loading }: { sos: SosAlert | null; loading?: boolean }) {
  const { palette } = useTheme();
  const mapRef = useRef<MapView>(null);

  const latitude = useMemo(() => toFiniteCoord(sos?.latitude ?? null), [sos?.latitude]);
  const longitude = useMemo(() => toFiniteCoord(sos?.longitude ?? null), [sos?.longitude]);
  const hasValidPosition = isValidLatLng(latitude, longitude);

  const region = hasValidPosition
    ? { latitude: latitude as number, longitude: longitude as number, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : null;

  const recenter = () => {
    if (region) mapRef.current?.animateToRegion(region, 300);
  };

  const openExternalMaps = () => {
    if (!hasValidPosition) return;
    Linking.openURL(`https://www.google.com/maps?q=${latitude},${longitude}`);
  };

  const locationSummary = sos?.location_address || (hasValidPosition ? `${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}` : null);
  const accuracyLabel = sos ? locationQuality(toFiniteCoord(sos.location_accuracy)) : 'Unavailable';

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionHeader title="Alert Location" />
      <View style={[styles.mapWrap, { borderColor: palette.border, backgroundColor: palette.surfaceMuted, marginTop: spacing.xs }]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.primary} />
            <Text style={[styles.centerText, { color: palette.textMuted }]}>Loading alert location…</Text>
          </View>
        ) : !sos ? null : !hasValidPosition ? (
          <View style={styles.center}>
            <Ionicons name="location-outline" size={22} color={palette.textMuted} />
            <Text style={[styles.centerText, { color: palette.textMuted }]}>Location is not available for this alert.</Text>
          </View>
        ) : (
          // Note on "tiles failed to load": react-native-maps gives no JS
          // callback for a native tile/provider failure (a missing or
          // restricted Android Maps API key, no connectivity reaching
          // Google's tile servers, etc.) — the native view simply renders
          // blank with just the Google wordmark, exactly the original bug
          // here, and nothing is thrown for MapErrorBoundary to catch
          // either. That boundary still earns its place for genuine JS
          // render crashes; it just can't detect this specific failure
          // mode. The location summary below is NOT inside this map box,
          // so the recorded address/coordinates stay visible either way.
          <MapErrorBoundary palette={palette} fallbackMessage="The map couldn't load. The recorded location is still shown below." style={StyleSheet.absoluteFill as object}>
            <MapView ref={mapRef} style={StyleSheet.absoluteFill} region={region!}>
              <Marker coordinate={{ latitude: latitude as number, longitude: longitude as number }} pinColor={palette.danger} title="Alert location" />
            </MapView>
            <Pressable
              onPress={recenter}
              style={[styles.recenterBtn, { backgroundColor: palette.surface, borderColor: palette.border }]}
              accessibilityRole="button"
              accessibilityLabel="Recenter map on alert location"
              hitSlop={6}
            >
              <Ionicons name="locate" size={18} color={palette.primary} />
            </Pressable>
          </MapErrorBoundary>
        )}
      </View>

      {sos ? (
        <View style={styles.summaryRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryText, { color: palette.text }]} numberOfLines={2}>
              {locationSummary ?? 'No location recorded for this alert.'}
            </Text>
            <Text style={[styles.summaryMeta, { color: palette.textMuted }]}>
              {hasValidPosition ? `${accuracyLabel} accuracy · ` : ''}
              {freshnessLabel(sos.location_timestamp)}
            </Text>
          </View>
          {hasValidPosition ? (
            <Pressable onPress={openExternalMaps} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open this location in an external maps application">
              <Text style={[styles.directionsLink, { color: palette.primary }]}>Open in Maps</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: CARD_HEIGHT, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md, gap: spacing.xs },
  centerText: { ...typography.caption, textAlign: 'center' },
  recenterBtn: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm, gap: spacing.sm },
  summaryText: { ...typography.body },
  summaryMeta: { ...typography.caption, marginTop: 2 },
  directionsLink: { ...typography.bodyMedium },
});

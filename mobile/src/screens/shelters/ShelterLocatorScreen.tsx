import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Linking, Pressable, TextInput, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { AlertMessage, EmptyState } from '../../components/ui';
import { ScreenHeader } from '../../components/ScreenHeader';
import { FirstVisitTip } from '../../components/FirstVisitTip';
import { ShelterPhoto } from '../../components/shelters/ShelterPhoto';
import { ShelterFilterSheet, DEFAULT_SHELTER_FILTERS, type ShelterFilters } from '../../components/shelters/ShelterFilterSheet';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import { distanceKm } from '../../lib/geo';
import { toFiniteCoord, isValidLatLng } from '../../lib/coords';
import { MapErrorBoundary } from '../../components/MapErrorBoundary';
import type { Municipality, Shelter } from '../../types/database.types';

type Nav = CompositeNavigationProp<BottomTabNavigationProp<AppTabParamList, 'SheltersTab'>, NativeStackNavigationProp<AppStackParamList>>;
type ShelterRow = Shelter & { municipalities?: { municipality_name: string } | null };

const AURORA_FALLBACK_REGION = { latitude: 15.75, longitude: 121.55, latitudeDelta: 0.5, longitudeDelta: 0.5 };

function availabilityOf(s: Shelter): 'available' | 'full' | 'unknown' {
  if (s.capacity == null) return 'unknown';
  return s.capacity - s.current_occupancy > 0 ? 'available' : 'full';
}

export function ShelterLocatorScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<Nav>();
  const [shelters, setShelters] = useState<ShelterRow[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ShelterFilters>(DEFAULT_SHELTER_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Browsing shelters never requires location permission (brief,
      // Part D: "do not require GPS permission to browse shelter
      // information") — this query alone already populates the whole
      // screen; location below is purely an optional, separately-gated
      // enhancement for distance sorting/filtering.
      const { data, error } = await supabase.from('shelters').select('*, municipalities(municipality_name)').eq('is_active', true);
      if (error) throw error;
      setShelters((data as ShelterRow[]) ?? []);
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

  // Only requested when the user explicitly opts into distance sorting —
  // never on mount, never required to see the shelter list itself.
  const useMyLocationForSorting = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({});
      setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      // Denied/unavailable — the list simply stays unsorted by distance.
    }
  };

  const municipalities = useMemo<Municipality[]>(() => {
    const seen = new Map<string, Municipality>();
    shelters.forEach((s) => {
      if (!seen.has(s.municipality_id)) {
        seen.set(s.municipality_id, {
          municipality_id: s.municipality_id,
          municipality_name: s.municipalities?.municipality_name ?? '—',
          province: 'Aurora',
          contact_number: null,
          is_active: true,
          psgc_code: null,
          created_at: '',
          updated_at: '',
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.municipality_name.localeCompare(b.municipality_name));
  }, [shelters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shelters.filter((s) => {
      if (q) {
        const haystack = [s.shelter_name, s.address, s.services_available, s.municipalities?.municipality_name].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.availability !== 'all' && availabilityOf(s) !== filters.availability) return false;
      if (filters.municipalityId && s.municipality_id !== filters.municipalityId) return false;
      if (filters.maxDistanceKm != null && userLocation) {
        const lat = toFiniteCoord(s.latitude);
        const lng = toFiniteCoord(s.longitude);
        if (!isValidLatLng(lat, lng)) return false;
        if (distanceKm(userLocation.latitude, userLocation.longitude, lat as number, lng as number) > filters.maxDistanceKm) return false;
      }
      return true;
    });
  }, [shelters, query, filters, userLocation]);

  const sorted = useMemo(() => {
    if (!userLocation) return filtered;
    return [...filtered].sort((a, b) => {
      const aLat = toFiniteCoord(a.latitude), aLng = toFiniteCoord(a.longitude);
      const bLat = toFiniteCoord(b.latitude), bLng = toFiniteCoord(b.longitude);
      const aDist = isValidLatLng(aLat, aLng) ? distanceKm(userLocation.latitude, userLocation.longitude, aLat as number, aLng as number) : Infinity;
      const bDist = isValidLatLng(bLat, bLng) ? distanceKm(userLocation.latitude, userLocation.longitude, bLat as number, bLng as number) : Infinity;
      return aDist - bDist;
    });
  }, [filtered, userLocation]);

  const mappable = useMemo(
    () => sorted.filter((s) => isValidLatLng(toFiniteCoord(s.latitude), toFiniteCoord(s.longitude))),
    [sorted]
  );
  const selected = mappable.find((s) => s.shelter_id === selectedShelterId) ?? null;
  const activeFilterCount = (filters.availability !== 'all' ? 1 : 0) + (filters.municipalityId ? 1 : 0) + (filters.maxDistanceKm != null ? 1 : 0);

  const mapRegion = selected
    ? { latitude: toFiniteCoord(selected.latitude) as number, longitude: toFiniteCoord(selected.longitude) as number, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : userLocation
      ? { ...userLocation, latitudeDelta: 0.5, longitudeDelta: 0.5 }
      : AURORA_FALLBACK_REGION;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title="Shelters" />
      <FirstVisitTip id="shelters" title="Find available shelter support" body="Explore shelter information and available services." />

      <View style={styles.toolbar}>
        <View style={[styles.searchRow, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <Ionicons name="search" size={17} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search shelters or locations"
            placeholderTextColor={palette.textMuted}
            style={[styles.searchInput, { color: palette.text }]}
            accessibilityLabel="Search shelters or locations"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={[styles.filterBtn, { borderColor: activeFilterCount > 0 ? palette.primary : palette.border, backgroundColor: activeFilterCount > 0 ? palette.primaryLight : palette.surface }]}
          accessibilityRole="button"
          accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
        >
          <Ionicons name="options-outline" size={18} color={activeFilterCount > 0 ? palette.primary : palette.text} />
          {activeFilterCount > 0 ? (
            <View style={[styles.filterDot, { backgroundColor: palette.primary }]}>
              <Text style={styles.filterDotText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.resultCount, { color: palette.textMuted }]}>
          {loading ? 'Loading shelters...' : `${sorted.length} shelter${sorted.length === 1 ? '' : 's'} found`}
        </Text>
        <View style={[styles.toggle, { borderColor: palette.border }]}>
          <Pressable onPress={() => setViewMode('list')} style={[styles.toggleBtn, viewMode === 'list' && { backgroundColor: palette.primary }]}>
            <Text style={[styles.toggleText, { color: viewMode === 'list' ? palette.white : palette.text }]}>List</Text>
          </Pressable>
          <Pressable onPress={() => setViewMode('map')} style={[styles.toggleBtn, viewMode === 'map' && { backgroundColor: palette.primary }]}>
            <Text style={[styles.toggleText, { color: viewMode === 'map' ? palette.white : palette.text }]}>Map</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : loadError ? (
        <View style={{ padding: spacing.lg }}>
          <AlertMessage variant="error" title="We couldn't load shelters" message="Please check your connection and try again." onRetry={load} />
        </View>
      ) : viewMode === 'map' ? (
        <View style={{ flex: 1 }}>
          <View style={[styles.mapWrap, { borderColor: palette.border }]}>
            <MapErrorBoundary palette={palette} fallbackMessage="Map unavailable — shelters are still listed in List view." style={StyleSheet.absoluteFill as object}>
              <MapView style={StyleSheet.absoluteFill} region={mapRegion}>
                {mappable.map((s) => (
                  <Marker
                    key={s.shelter_id}
                    coordinate={{ latitude: toFiniteCoord(s.latitude) as number, longitude: toFiniteCoord(s.longitude) as number }}
                    title={s.shelter_name}
                    description={s.address}
                    pinColor={s.shelter_id === selectedShelterId ? palette.primary : palette.danger}
                    onPress={() => setSelectedShelterId(s.shelter_id)}
                  />
                ))}
              </MapView>
            </MapErrorBoundary>
            {!userLocation ? (
              <Pressable onPress={useMyLocationForSorting} style={[styles.locateBtn, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Ionicons name="locate" size={18} color={palette.primary} />
              </Pressable>
            ) : null}
          </View>

          {shelters.length > 0 && mappable.length === 0 ? (
            <Text style={[styles.noCoordsNote, { color: palette.textMuted }]}>
              None of the shelters matching your search have a mapped location yet — switch to List view to see them.
            </Text>
          ) : null}

          {selected ? (
            <View style={[styles.previewCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Pressable onPress={() => setSelectedShelterId(null)} style={styles.previewClose} hitSlop={8} accessibilityLabel="Dismiss preview">
                <Ionicons name="close" size={16} color={palette.textMuted} />
              </Pressable>
              <Text style={[styles.previewName, { color: palette.text }]} numberOfLines={1}>{selected.shelter_name}</Text>
              <Text style={[styles.previewMeta, { color: palette.textMuted }]} numberOfLines={1}>{selected.address}</Text>
              <Pressable
                onPress={() => navigation.navigate('ShelterDetail', { shelterId: selected.shelter_id })}
                style={[styles.previewBtn, { backgroundColor: palette.primary }]}
              >
                <Text style={[styles.previewBtnText, { color: palette.white }]}>View Details</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg }}
          data={sorted}
          keyExtractor={(s) => s.shelter_id}
          ListEmptyComponent={<EmptyState title="No shelters match your search" subtitle="Try a different search term or reset your filters." />}
          ListFooterComponent={
            <Pressable onPress={() => navigation.navigate('MyShelterRequests')} style={styles.myRequestsLink}>
              <Text style={[styles.myRequestsText, { color: palette.primary }]}>My Shelter Requests</Text>
              <Ionicons name="chevron-forward" size={16} color={palette.primary} />
            </Pressable>
          }
          renderItem={({ item }) => {
            const avail = availabilityOf(item);
            const lat = toFiniteCoord(item.latitude), lng = toFiniteCoord(item.longitude);
            const dist = userLocation && isValidLatLng(lat, lng) ? distanceKm(userLocation.latitude, userLocation.longitude, lat as number, lng as number) : null;
            return (
              <Pressable
                onPress={() => navigation.navigate('ShelterDetail', { shelterId: item.shelter_id })}
                style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}
              >
                <ShelterPhoto path={item.photo_path} style={styles.cardImage} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>{item.shelter_name}</Text>
                  <Text style={[styles.address, { color: palette.textMuted }]} numberOfLines={1}>
                    {item.municipalities?.municipality_name ?? item.address}
                  </Text>
                  <View style={styles.badgeRow}>
                    <Text
                      style={[
                        styles.availBadge,
                        { color: avail === 'available' ? palette.success : avail === 'full' ? palette.warning : palette.textMuted },
                      ]}
                    >
                      {avail === 'available' ? 'Spaces available' : avail === 'full' ? 'Full capacity' : 'Availability unknown'}
                    </Text>
                    {dist != null ? <Text style={[styles.distance, { color: palette.textMuted }]}> · {dist.toFixed(1)} km away</Text> : null}
                  </View>
                  {item.services_available ? (
                    <Text style={[styles.services, { color: palette.textMuted }]} numberOfLines={1}>{item.services_available}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <ShelterFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        onChange={setFilters}
        municipalities={municipalities}
        hasUserLocation={!!userLocation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  searchRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, height: 44 },
  searchInput: { flex: 1, ...typography.body, height: '100%' },
  filterBtn: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterDot: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  filterDotText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_600SemiBold' as any },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  resultCount: { ...typography.caption },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.pill, overflow: 'hidden' },
  toggleBtn: { paddingHorizontal: spacing.md, paddingVertical: 6 },
  toggleText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  mapWrap: { height: 260, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', margin: spacing.lg, marginBottom: spacing.sm },
  locateBtn: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  noCoordsNote: { ...typography.caption, textAlign: 'center', paddingHorizontal: spacing.lg },
  previewCard: { margin: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  previewClose: { position: 'absolute', top: spacing.sm, right: spacing.sm, padding: 4 },
  previewName: { ...typography.bodyMedium, paddingRight: spacing.lg },
  previewMeta: { ...typography.caption, marginTop: 2 },
  previewBtn: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: spacing.sm },
  previewBtnText: { ...typography.bodyMedium },
  card: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  cardImage: { width: 84, height: 84, borderRadius: radius.sm },
  name: { ...typography.subheading },
  address: { ...typography.caption, marginTop: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  availBadge: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  distance: { ...typography.caption },
  services: { ...typography.caption, marginTop: 2 },
  myRequestsLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: spacing.md, marginTop: spacing.xs },
  myRequestsText: { ...typography.bodyMedium },
});

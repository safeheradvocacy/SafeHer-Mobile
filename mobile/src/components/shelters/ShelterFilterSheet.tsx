import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, radius, typography } from '../../theme/theme';
import type { Municipality } from '../../types/database.types';

export type AvailabilityFilter = 'all' | 'available' | 'full';
export const DISTANCE_OPTIONS = [5, 10, 25, 50] as const;

export interface ShelterFilters {
  availability: AvailabilityFilter;
  municipalityId: string | null;
  maxDistanceKm: number | null;
}

export const DEFAULT_SHELTER_FILTERS: ShelterFilters = { availability: 'all', municipalityId: null, maxDistanceKm: null };

function OptionChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? palette.primary : palette.border, backgroundColor: active ? palette.primary : palette.surface }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, { color: active ? palette.white : palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Only offers filters that correspond to real, queryable fields:
 * availability derives from capacity/current_occupancy (both real
 * columns), municipality from the municipalities already loaded for the
 * visible shelters, and distance only appears at all once a real device
 * location is available (never requested just to show this drawer —
 * ShelterLocatorScreen only asks for location when the user opts into
 * sorting/filtering by it).
 */
export function ShelterFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  municipalities,
  hasUserLocation,
}: {
  visible: boolean;
  onClose: () => void;
  filters: ShelterFilters;
  onChange: (next: ShelterFilters) => void;
  municipalities: Municipality[];
  hasUserLocation: boolean;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityViewIsModal accessibilityLabel="Shelter filters">
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface, paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <View style={styles.headRow}>
            <Text style={[styles.title, { color: palette.text }]}>Filter Shelters</Text>
            <Pressable onPress={() => onChange(DEFAULT_SHELTER_FILTERS)} hitSlop={8}>
              <Text style={[styles.reset, { color: palette.primary }]}>Reset</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Availability</Text>
            <View style={styles.chipRow}>
              <OptionChip label="All" active={filters.availability === 'all'} onPress={() => onChange({ ...filters, availability: 'all' })} />
              <OptionChip label="Available now" active={filters.availability === 'available'} onPress={() => onChange({ ...filters, availability: 'available' })} />
              <OptionChip label="Full capacity" active={filters.availability === 'full'} onPress={() => onChange({ ...filters, availability: 'full' })} />
            </View>

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Municipality</Text>
            <View style={styles.chipRow}>
              <OptionChip label="All" active={filters.municipalityId === null} onPress={() => onChange({ ...filters, municipalityId: null })} />
              {municipalities.map((m) => (
                <OptionChip
                  key={m.municipality_id}
                  label={m.municipality_name}
                  active={filters.municipalityId === m.municipality_id}
                  onPress={() => onChange({ ...filters, municipalityId: m.municipality_id })}
                />
              ))}
            </View>

            {hasUserLocation ? (
              <>
                <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Distance</Text>
                <View style={styles.chipRow}>
                  <OptionChip label="Any distance" active={filters.maxDistanceKm === null} onPress={() => onChange({ ...filters, maxDistanceKm: null })} />
                  {DISTANCE_OPTIONS.map((km) => (
                    <OptionChip key={km} label={`Within ${km} km`} active={filters.maxDistanceKm === km} onPress={() => onChange({ ...filters, maxDistanceKm: km })} />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>

          <Pressable onPress={onClose} style={[styles.applyBtn, { backgroundColor: palette.primary }]} accessibilityRole="button">
            <Ionicons name="checkmark" size={16} color={palette.white} />
            <Text style={[styles.applyText, { color: palette.white }]}>Apply Filters</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(32,26,45,0.42)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { ...typography.heading, fontSize: 18 },
  reset: { ...typography.bodyMedium },
  sectionLabel: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill, paddingVertical: 12, marginTop: spacing.md },
  applyText: { ...typography.bodyMedium },
});

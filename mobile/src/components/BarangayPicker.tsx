import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import type { Barangay } from '../types/database.types';

export type BarangayLoadState = 'loading' | 'success' | 'empty' | 'error' | 'no-municipality';

/**
 * Barangay counterpart to MunicipalityPicker — same bottom-sheet/search/
 * checkmark presentation, but unlike MunicipalityPicker (presentation-only,
 * caller owns the fetch), this one owns its own fetch: it re-queries
 * `barangays` filtered by `municipalityId` whenever that prop changes,
 * since two different call sites (registration, profile address edit)
 * would otherwise need to duplicate the exact same reactive-fetch logic.
 * The caller still owns clearing its own selected `value` when the
 * municipality changes (cascading-clear rule) — this component only
 * re-fetches and re-renders the list for the new municipality.
 */
export function BarangayPicker({
  visible,
  onClose,
  municipalityId,
  value,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  municipalityId: string | null;
  value: string | null;
  onSelect: (id: string, name: string) => void;
}) {
  const { palette } = useTheme();
  const [query, setQuery] = useState('');
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [state, setState] = useState<BarangayLoadState>('no-municipality');

  const load = async () => {
    if (!municipalityId) {
      setBarangays([]);
      setState('no-municipality');
      return;
    }
    setState('loading');
    const { data, error } = await supabase
      .from('barangays')
      .select('*')
      .eq('municipality_id', municipalityId)
      .eq('is_active', true)
      .order('barangay_name');
    if (error) {
      // Sanitized diagnostic — Supabase's own error shape only (code/
      // message/details/hint), never request/response bodies or auth
      // tokens. The user-facing state stays the generic "Couldn't load
      // barangays." message below; this is what actually identifies
      // RLS-vs-grant-vs-network-vs-schema failures during development
      // (see supabase/module15_barangay_anon_read_grant.sql for the bug
      // this caught: a missing GRANT, not an RLS or data problem).
      console.error(
        `[BarangayPicker] query failed for municipality_id=${municipalityId} — code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
      );
      setState('error');
      return;
    }
    if (!data || data.length === 0) {
      setBarangays([]);
      setState('empty');
      return;
    }
    setBarangays(data);
    setState('success');
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipalityId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return barangays;
    const q = query.trim().toLowerCase();
    return barangays.filter((b) => b.barangay_name.toLowerCase().includes(q));
  }, [barangays, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityViewIsModal>
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={[styles.title, { color: palette.text }]}>Select barangay</Text>

          {state === 'success' ? (
            <View style={[styles.searchRow, { backgroundColor: palette.surfaceMuted }]}>
              <Ionicons name="search" size={17} color={palette.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search barangay"
                placeholderTextColor={palette.textMuted}
                style={[styles.searchInput, { color: palette.text }]}
                autoCapitalize="words"
                accessibilityLabel="Search barangay"
                accessibilityHint="Filters the list below as you type"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={17} color={palette.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {state === 'no-municipality' ? (
            <View style={styles.centerState}>
              <Ionicons name="location-outline" size={28} color={palette.textMuted} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>Please select a municipality first.</Text>
            </View>
          ) : null}

          {state === 'loading' ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={palette.primary} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>Loading barangays...</Text>
            </View>
          ) : null}

          {state === 'error' ? (
            <View style={styles.centerState}>
              <Ionicons name="alert-circle" size={28} color={palette.danger} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>Couldn't load barangays.</Text>
              <Pressable onPress={load} style={styles.retryBtn} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.retryText, { color: palette.primary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {state === 'empty' ? (
            <View style={styles.centerState}>
              <Ionicons name="location-outline" size={28} color={palette.textMuted} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>No barangays available for this municipality yet.</Text>
            </View>
          ) : null}

          {state === 'success' && filtered.length === 0 ? (
            <View style={styles.centerState}>
              <Ionicons name="search" size={28} color={palette.textMuted} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>No matches for "{query}".</Text>
            </View>
          ) : null}

          {state === 'success' && filtered.length > 0 ? (
            <FlatList
              data={filtered}
              keyExtractor={(b) => b.barangay_id}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const active = item.barangay_id === value;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item.barangay_id, item.barangay_name);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      active ? { backgroundColor: palette.primaryLight } : null,
                      pressed ? { opacity: 0.7 } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.barangay_name}
                  >
                    <Text
                      style={[styles.optionText, { color: active ? palette.primaryDark : palette.text }]}
                      numberOfLines={1}
                    >
                      {item.barangay_name}
                    </Text>
                    {active ? <Ionicons name="checkmark-circle" size={20} color={palette.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(32,26,45,0.42)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  title: { ...typography.heading, fontSize: 18, marginBottom: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 44,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  searchInput: { flex: 1, ...typography.body, height: '100%' },
  centerState: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  centerStateText: { ...typography.body, textAlign: 'center' },
  retryBtn: { marginTop: spacing.xs, paddingVertical: 8, paddingHorizontal: spacing.md },
  retryText: { ...typography.bodyMedium },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  optionText: { ...typography.body, flex: 1, marginRight: spacing.sm },
});

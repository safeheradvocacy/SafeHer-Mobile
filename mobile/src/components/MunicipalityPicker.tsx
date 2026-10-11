import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';
import type { Municipality } from '../types/database.types';

export type MunicipalityLoadState = 'loading' | 'success' | 'empty' | 'error';

/**
 * A proper bottom-sheet municipality selector — search + scrollable list +
 * a selected checkmark + its own loading/empty/error states — replacing
 * the plain full-height dropdown modal. Data fetching stays owned by the
 * caller (already reads from the existing `municipalities` table); this
 * component only presents whatever state it's handed. Colors come from
 * ThemeContext so it follows Light/Dark like every other auth surface.
 */
export function MunicipalityPicker({
  visible,
  onClose,
  municipalities,
  state,
  value,
  onSelect,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  municipalities: Municipality[];
  state: MunicipalityLoadState;
  value: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const { palette } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return municipalities;
    const q = query.trim().toLowerCase();
    return municipalities.filter((m) => m.municipality_name.toLowerCase().includes(q));
  }, [municipalities, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityViewIsModal>
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={[styles.title, { color: palette.text }]}>Select municipality</Text>

          {state === 'success' ? (
            <View style={[styles.searchRow, { backgroundColor: palette.surfaceMuted }]}>
              <Ionicons name="search" size={17} color={palette.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search municipality"
                placeholderTextColor={palette.textMuted}
                style={[styles.searchInput, { color: palette.text }]}
                autoCapitalize="words"
                accessibilityLabel="Search municipality"
                accessibilityHint="Filters the list below as you type"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={17} color={palette.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {state === 'loading' ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={palette.primary} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>Loading municipalities...</Text>
            </View>
          ) : null}

          {state === 'error' ? (
            <View style={styles.centerState}>
              <Ionicons name="alert-circle" size={28} color={palette.danger} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>Couldn't load municipalities.</Text>
              <Pressable onPress={onRetry} style={styles.retryBtn} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.retryText, { color: palette.primary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {state === 'empty' ? (
            <View style={styles.centerState}>
              <Ionicons name="location-outline" size={28} color={palette.textMuted} />
              <Text style={[styles.centerStateText, { color: palette.textMuted }]}>No municipalities available yet.</Text>
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
              keyExtractor={(m) => m.municipality_id}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const active = item.municipality_id === value;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item.municipality_id);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      active ? { backgroundColor: palette.primaryLight } : null,
                      pressed ? { opacity: 0.7 } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.municipality_name}
                  >
                    <Text
                      style={[styles.optionText, { color: active ? palette.primaryDark : palette.text }]}
                      numberOfLines={1}
                    >
                      {item.municipality_name}
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

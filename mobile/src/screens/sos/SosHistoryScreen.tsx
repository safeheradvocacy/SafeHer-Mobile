import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBadge, EmptyState, AlertMessage } from '../../components/ui';
import { useSosHistory, SOS_HISTORY_FILTERS } from '../../lib/useSosHistory';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { SosAlert } from '../../types/database.types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function latestUpdateLabel(a: SosAlert): string {
  const latest = a.resolved_at ?? a.acknowledged_at ?? null;
  return latest ? `Last update: ${new Date(latest).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No updates recorded yet';
}

export function SosHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'SosHistory'>>();
  const { palette } = useTheme();
  const { alerts, loading, refreshing, loadingMore, hasMore, error, filter, setFilter, reload, loadMore } = useSosHistory();

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Text style={[styles.intro, { color: palette.textMuted }]}>Review your previous emergency alerts and their recorded outcomes.</Text>

      <View style={styles.filterRow}>
        {SOS_HISTORY_FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={[styles.filterChip, { borderColor: active ? palette.primary : palette.border, backgroundColor: active ? palette.primary : palette.surface }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.filterChipText, { color: active ? palette.white : palette.text }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <AlertMessage variant="error" title="Couldn't load your SOS history" message="Please check your connection and try again." onRetry={reload} />
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.sos_id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={palette.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListEmptyComponent={
            !error ? (
              <EmptyState title="No SOS history yet" subtitle="Your previous alerts will appear here when available." />
            ) : null
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={palette.primary} style={{ marginVertical: spacing.md }} /> : null}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('SosHistoryDetail', { sosId: item.sos_id })}
              style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}
              accessibilityRole="button"
              accessibilityLabel={`SOS alert, ${item.status}, ${formatDateTime(item.triggered_at)}. Tap to view details.`}
            >
              <View style={styles.rowHead}>
                <Text style={[styles.rowTitle, { color: palette.text }]}>SOS Alert</Text>
                <StatusBadge label={item.status} />
              </View>
              <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{formatDateTime(item.triggered_at)}</Text>
              {item.location_address ? <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>{item.location_address}</Text> : null}
              <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{latestUpdateLabel(item)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  intro: { ...typography.body, marginBottom: spacing.md },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  filterChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  filterChipText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  rowTitle: { ...typography.bodyMedium },
  rowMeta: { ...typography.caption, marginTop: 2 },
});

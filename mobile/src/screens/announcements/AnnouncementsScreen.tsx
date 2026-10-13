import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, AppState, AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { Card, EmptyState, StatusBadge } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Announcement } from '../../types/database.types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'Announcements'>;

/**
 * Live announcement feed (module28, Part D). RLS on `announcements`
 * (module28_provincial_announcements.sql) is the only thing that
 * decides what shows here — drafts/scheduled/expired/archived/
 * unpublished rows are invisible to this query no matter what, so
 * there is no client-side status/date filter to get wrong.
 *
 * Realtime (Part E): rather than trusting a Realtime payload's
 * `new`/`old` row content directly — which the brief explicitly warns
 * against ("do not assume receiving a Realtime event automatically
 * grants permission to read the referenced record") — any INSERT/
 * UPDATE/DELETE on the table just triggers a debounced re-fetch
 * through the normal RLS-enforced SELECT below. That one mechanism
 * covers every case the brief lists: a newly published announcement
 * appearing, an edit updating a card in place, and an unpublished/
 * archived/expired announcement disappearing — because a reload
 * naturally stops returning a row the moment RLS stops allowing it,
 * with no separate "remove from feed" code path to maintain.
 */
export function AnnouncementsScreen() {
  const navigation = useNavigation<Nav>();
  const { palette } = useTheme();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'important'>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('published_at', { ascending: false });
      if (error) {
        console.error('[AnnouncementsScreen] load:', error.message);
        setLoadError(true);
      } else {
        setLoadError(false);
        setItems(data ?? []);
      }
    } catch (e) {
      console.error('[AnnouncementsScreen] load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedReload = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 400);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Reconciliation on reconnect/foreground — the brief's own fallback
  // for whatever a live subscription might have missed while
  // backgrounded or disconnected.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('announcements-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, debouncedReload)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedReload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = filter === 'important' ? items.filter((a) => a.priority === 'Important' || a.priority === 'Urgent') : items;

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.filterRow}>
        {(['all', 'important'] as const).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterChip,
                { borderColor: active ? palette.primary : palette.border, backgroundColor: active ? palette.primaryLight : palette.surface },
              ]}
              accessibilityRole="button"
              accessibilityLabel={f === 'all' ? 'All announcements' : 'Important and urgent announcements'}
            >
              <Text style={[styles.filterChipText, { color: active ? palette.primaryDark : palette.textMuted }]}>
                {f === 'all' ? 'All' : 'Important'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {loadError ? (
        <View style={styles.center}>
          <EmptyState title="Couldn't load announcements" subtitle="Check your connection and pull down to try again." />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          data={filtered}
          keyExtractor={(item) => item.announcement_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState
              title={filter === 'important' ? 'No important announcements' : 'No announcements yet'}
              subtitle="Provincial updates and advisories will appear here as soon as they're published."
            />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('AnnouncementDetail', { announcementId: item.announcement_id })}>
              <Card>
                <View style={styles.cardHeaderRow}>
                  <StatusBadge label={item.priority} icon={item.priority === 'Urgent' ? 'warning' : undefined} />
                  <Text style={[styles.cardDate, { color: palette.textMuted }]}>
                    {item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}
                  </Text>
                </View>
                <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[styles.cardPreview, { color: palette.textMuted }]} numberOfLines={2}>
                  {item.summary || item.content}
                </Text>
                <View style={styles.cardFooterRow}>
                  <Text style={[styles.cardCategory, { color: palette.textMuted }]}>{item.category}</Text>
                  <View style={styles.cardOpenRow}>
                    <Text style={[styles.cardOpen, { color: palette.primary }]}>Read more</Text>
                    <Ionicons name="chevron-forward" size={14} color={palette.primary} />
                  </View>
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  filterChipText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { ...typography.caption },
  cardTitle: { ...typography.subheading, marginTop: spacing.xs },
  cardPreview: { ...typography.body, fontSize: 13.5, marginTop: 4 },
  cardFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  cardCategory: { ...typography.caption },
  cardOpenRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cardOpen: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
});

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { EmptyState, StatusBadge } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Announcement } from '../../types/database.types';

type DetailRoute = RouteProp<AppStackParamList, 'AnnouncementDetail'>;

// A fixed office designation, never the publishing staff member's own
// name/profile id — per the brief's "do not expose internal user IDs
// or unnecessary administrative metadata".
const PUBLISHER_DESIGNATION = 'Provincial Social Welfare and Development Office — Aurora';

export function AnnouncementDetailScreen() {
  const { palette } = useTheme();
  const route = useRoute<DetailRoute>();
  const { announcementId } = route.params;
  const [item, setItem] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    // RLS (module28) is the only gate here — a stale, unpublished,
    // expired, archived, or wrong id all resolve to the same "not
    // found" state below; this screen never learns which. A thrown
    // exception (e.g. total connection loss) now resolves to the same
    // state too, rather than leaving `loading` stuck forever.
    try {
      const { data } = await supabase.from('announcements').select('*').eq('announcement_id', announcementId).maybeSingle();
      setItem(data ?? null);
      setNotFound(!data);
    } catch (e) {
      console.error('[AnnouncementDetailScreen] load:', e);
      setItem(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [announcementId]);

  useEffect(() => {
    load();
  }, [load]);

  const openLink = (url: string) => {
    if (/^https:\/\//i.test(url)) Linking.openURL(url);
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      </View>
    );
  }

  if (notFound || !item) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.center}>
          <EmptyState title="Announcement no longer available" subtitle="It may have expired, been withdrawn, or no longer applies to you." />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={styles.badgeRow}>
          <StatusBadge label={item.priority} icon={item.priority === 'Urgent' ? 'warning' : undefined} />
          <StatusBadge label={item.category} />
        </View>

        <Text style={[styles.title, { color: palette.text }]} allowFontScaling>
          {item.title}
        </Text>

        <Text style={[styles.meta, { color: palette.textMuted }]}>{PUBLISHER_DESIGNATION}</Text>
        {item.published_at && (
          <Text style={[styles.meta, { color: palette.textMuted }]}>Published {new Date(item.published_at).toLocaleString()}</Text>
        )}
        {item.expires_at && (
          <Text style={[styles.meta, { color: palette.textMuted }]}>Available until {new Date(item.expires_at).toLocaleString()}</Text>
        )}

        <Text style={[styles.content, { color: palette.text }]} allowFontScaling selectable>
          {item.content}
        </Text>

        {item.external_link && (
          <Pressable
            onPress={() => openLink(item.external_link!)}
            style={[styles.linkRow, { borderColor: palette.border }]}
            accessibilityRole="link"
            accessibilityLabel="Open related link"
          >
            <Ionicons name="open-outline" size={16} color={palette.primary} />
            <Text style={[styles.linkText, { color: palette.primary }]} numberOfLines={1}>
              {item.external_link}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  title: { ...typography.display, fontSize: 22, lineHeight: 28 },
  meta: { ...typography.caption, marginTop: 4 },
  content: { ...typography.body, fontSize: 15.5, lineHeight: 23, marginTop: spacing.lg },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.lg,
  },
  linkText: { ...typography.bodyMedium, flex: 1 },
});

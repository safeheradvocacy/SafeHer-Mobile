import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import type { Notification } from '../../types/database.types';

const TYPE_LABEL: Record<string, string> = {
  'Case Update': 'Case update',
  SOS: 'Emergency',
  Assignment: 'Assignment',
  Referral: 'Referral',
  Announcement: 'Announcement',
};

export function NotificationsScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .order('created_at', { ascending: false });
    setItems(data ?? []);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`notifications-${profile.profile_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profile.profile_id}` },
        (payload) => setItems((prev) => [payload.new as Notification, ...prev])
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile]);

  const markRead = async (n: Notification) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((i) => (i.notification_id === n.notification_id ? { ...i, is_read: true } : i)));
    await supabase.from('notifications').update({ is_read: true }).eq('notification_id', n.notification_id);
  };

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      data={items}
      keyExtractor={(n) => n.notification_id}
      ListHeaderComponent={<Text style={styles.title}>Notifications</Text>}
      ListEmptyComponent={<EmptyState title="You're all caught up" subtitle="New updates about your cases and SOS alerts will show up here." />}
      renderItem={({ item }) => (
        <Pressable onPress={() => markRead(item)} style={[styles.row, !item.is_read && styles.rowUnread]}>
          <View style={styles.rowHeader}>
            <Text style={styles.type}>{TYPE_LABEL[item.notification_type] ?? item.notification_type}</Text>
            {!item.is_read && <View style={styles.dot} />}
          </View>
          <Text style={styles.notifTitle}>{item.title}</Text>
          <Text style={styles.message}>{item.message}</Text>
          <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.display, fontSize: 24, color: colors.text, marginBottom: spacing.lg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowUnread: { borderColor: colors.primary },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  type: { ...typography.caption, color: colors.primary, textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  notifTitle: { ...typography.bodyMedium, color: colors.text, marginTop: 4 },
  message: { ...typography.body, color: colors.textMuted, marginTop: 2 },
  time: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});

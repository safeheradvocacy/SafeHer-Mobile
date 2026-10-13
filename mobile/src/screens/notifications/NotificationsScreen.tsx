import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertMessage, EmptyState } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Notification } from '../../types/database.types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'Notifications'>;

const TYPE_LABEL: Record<string, string> = {
  'Case Update': 'Case update',
  SOS: 'Emergency',
  Assignment: 'Assignment',
  Referral: 'Referral',
  Announcement: 'Announcement',
  Support: 'Support',
};

export function NotificationsScreen() {
  const { palette, prefs } = useTheme();
  const { profile } = useAuth();
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoadError(false);
    try {
      let query = supabase.from('notifications').select('*').eq('profile_id', profile.profile_id).order('created_at', { ascending: false });
      if (!prefs.emergencyAlertsEnabled) {
        // Only hides them from this device's list — SOS triggering,
        // creation, and responder dispatch never go through this screen.
        query = query.neq('notification_type', 'SOS');
      }
      const { data, error } = await query;
      if (error) throw error;
      setItems(data ?? []);
    } catch (e) {
      console.error('[NotificationsScreen] load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [profile, prefs.emergencyAlertsEnabled]);

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
        (payload) => {
          const inserted = payload.new as Notification;
          if (!prefs.emergencyAlertsEnabled && inserted.notification_type === 'SOS') return;
          setItems((prev) => [inserted, ...prev]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, prefs.emergencyAlertsEnabled]);

  const markRead = async (n: Notification) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((i) => (i.notification_id === n.notification_id ? { ...i, is_read: true } : i)));
    try {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('notification_id', n.notification_id);
      if (error) throw error;
    } catch (e) {
      console.error('[NotificationsScreen] markRead:', e);
      // Roll back the optimistic update — a silently-failed update
      // previously left the dot permanently cleared even though the
      // notification was still unread server-side.
      setItems((prev) => prev.map((i) => (i.notification_id === n.notification_id ? { ...i, is_read: false } : i)));
    }
  };

  const onPressNotification = (n: Notification) => {
    markRead(n);
    if (n.announcement_id) {
      navigation.navigate('AnnouncementDetail', { announcementId: n.announcement_id });
    }
  };

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      data={items}
      keyExtractor={(n) => n.notification_id}
      ListHeaderComponent={
        <>
          <Text style={[styles.title, { color: palette.text }]}>Notifications</Text>
          {!prefs.emergencyAlertsEnabled ? (
            <View style={[styles.alertsOffBanner, { backgroundColor: palette.warning + '1A', borderColor: palette.warning + '55' }]}>
              <Text style={[styles.alertsOffText, { color: palette.text }]}>
                Emergency alerts are turned off on this device. Turn them back on from Settings to see SOS and
                case-status updates here.
              </Text>
            </View>
          ) : null}
        </>
      }
      ListEmptyComponent={
        loading ? null : loadError ? (
          <AlertMessage variant="error" title="We couldn't load your notifications" message="Please check your connection and try again." onRetry={load} />
        ) : (
          <EmptyState title="You're all caught up" subtitle="New updates about your cases and SOS alerts will show up here." />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onPressNotification(item)}
          style={[
            styles.row,
            { backgroundColor: palette.surface, borderColor: palette.border },
            !item.is_read && { borderColor: palette.primary },
          ]}
        >
          <View style={styles.rowHeader}>
            <Text style={[styles.type, { color: palette.primary }]}>{TYPE_LABEL[item.notification_type] ?? item.notification_type}</Text>
            {!item.is_read && <View style={[styles.dot, { backgroundColor: palette.danger }]} />}
          </View>
          <Text style={[styles.notifTitle, { color: palette.text }]}>{item.title}</Text>
          <Text style={[styles.message, { color: palette.textMuted }]}>{item.message}</Text>
          <Text style={[styles.time, { color: palette.textMuted }]}>{new Date(item.created_at).toLocaleString()}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { ...typography.display, fontSize: 24, marginBottom: spacing.lg },
  alertsOffBanner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: -spacing.md, marginBottom: spacing.lg },
  alertsOffText: { ...typography.caption },
  row: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  type: { ...typography.caption, textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notifTitle: { ...typography.bodyMedium, marginTop: 4 },
  message: { ...typography.body, marginTop: 2 },
  time: { ...typography.caption, marginTop: spacing.xs },
});

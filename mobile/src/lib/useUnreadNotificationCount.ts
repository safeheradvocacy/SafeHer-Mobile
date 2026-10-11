import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from './supabase';

/**
 * The one real unread-notification count, shared by every screen's
 * header — previously only computed inside HomeScreen.tsx, which meant
 * no other screen could show the same badge without re-deriving (and
 * risking disagreeing with) the same number. Same filter logic as
 * before: SOS-type notifications are excluded from the count when the
 * user has turned off Emergency Alerts on this device — the underlying
 * notification rows, SOS trigger, and responder dispatch are entirely
 * unaffected by that preference, only this badge count is.
 */
export function useUnreadNotificationCount() {
  const { profile } = useAuth();
  const { prefs } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    if (!profile) return;
    let unreadQuery = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profile.profile_id)
      .eq('is_read', false);
    if (!prefs.emergencyAlertsEnabled) {
      unreadQuery = unreadQuery.neq('notification_type', 'SOS');
    }
    const { count } = await unreadQuery;
    setUnreadCount(count ?? 0);
  }, [profile, prefs.emergencyAlertsEnabled]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { unreadCount, reload: load };
}

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { spacing, typography, radius } from '../theme/theme';

/**
 * The lighter, independent mechanism from the brief's "contextual
 * tooltip system" — a small dismissible inline banner shown once per
 * screen, NOT a spotlight (that's TourOverlay.tsx, the bigger first-run
 * sequence). Each `id` gets its own per-profile AsyncStorage flag so it
 * never reappears once dismissed, and a different account on the same
 * device still sees it once for itself.
 */
export function FirstVisitTip({ id, title, body }: { id: string; title: string; body: string }) {
  const { profile } = useAuth();
  const { palette } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let mounted = true;
    AsyncStorage.getItem(`safespace_tip_seen_${id}_${profile.profile_id}`).then((seen) => {
      if (mounted && seen !== '1') setVisible(true);
    });
    return () => {
      mounted = false;
    };
  }, [id, profile]);

  const dismiss = () => {
    setVisible(false);
    if (profile) AsyncStorage.setItem(`safespace_tip_seen_${id}_${profile.profile_id}`, '1');
  };

  if (!visible) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.primaryLight, borderColor: palette.primary + '33' }]}>
      <Ionicons name="information-circle" size={18} color={palette.primaryDark} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[styles.title, { color: palette.primaryDark }]}>{title}</Text>
        <Text style={[styles.body, { color: palette.text }]}>{body}</Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss tip" style={styles.closeBtn}>
        <Ionicons name="close" size={16} color={palette.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  title: { ...typography.bodyMedium, fontSize: 13.5 },
  body: { ...typography.caption, marginTop: 2 },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import RAnimated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTour } from '../contexts/TourContext';
import { measureAndRegister } from '../lib/tourMeasure';
import { useUnreadNotificationCount } from '../lib/useUnreadNotificationCount';
import { useAvatarUrl } from '../lib/useAvatarUrl';
import { ClaySurface } from '../theme/clay';
import { PressableScale } from './ui';
import { spacing, typography } from '../theme/theme';
import { AppStackParamList } from '../navigation/types';

/**
 * The notification bell + profile avatar cluster — previously only
 * ever rendered on Home, so every other primary screen (Cases, SOS,
 * Shelters, Assistant) had no way to reach Notifications/Profile at
 * all except by first going back to Home. Self-contained (reads auth/
 * theme/unread-count itself) so any screen can drop it in without
 * threading props through.
 */
export function HeaderActions() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { profile } = useAuth();
  const { palette, prefs } = useTheme();
  const { unreadCount } = useUnreadNotificationCount();
  const { registerTarget, registerTargetRef, skip: skipTour } = useTour();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = useAvatarUrl(profile?.profile_picture);
  const prevUnreadRef = useRef(0);
  const avatarRef = useRef<View>(null);
  const badgePop = useSharedValue(1);

  // A prior broken-image failure must not stick around once the photo
  // itself has actually changed (new path -> new signed URL).
  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  // A brief pop — never continuous — the moment unread count goes UP,
  // not just whenever it happens to be > 0 on render.
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && prefs.inAppBadgeEnabled) {
      badgePop.value = withSequence(withTiming(1.35, { duration: 140 }), withTiming(1, { duration: 180 }));
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, badgePop, prefs.inAppBadgeEnabled]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgePop.value }] }));

  return (
    <View style={styles.row}>
      <PressableScale
        onPress={() => {
          skipTour();
          navigation.navigate('Notifications');
        }}
        style={styles.iconButtonWrap}
        accessibilityLabel="Notifications"
        accessibilityHint={unreadCount > 0 ? `${unreadCount} unread notifications` : 'No unread notifications'}
      >
        <ClaySurface radius={22} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.iconButtonShadow} innerStyle={styles.iconButtonInner} highlightOpacity={0.24}>
          <Ionicons name="notifications-outline" size={19} color={palette.text} />
        </ClaySurface>
        {unreadCount > 0 && prefs.inAppBadgeEnabled && (
          <RAnimated.View style={[styles.badgeDot, { backgroundColor: palette.dangerDark, borderColor: palette.background }, badgeStyle]}>
            <Text style={styles.badgeDotText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </RAnimated.View>
        )}
      </PressableScale>
      <View
        ref={avatarRef}
        onLayout={() => {
          measureAndRegister(avatarRef, 'profile', registerTarget, registerTargetRef, { shape: 'circle' });
        }}
      >
        <PressableScale
          onPress={() => {
            skipTour();
            navigation.navigate('Profile');
          }}
          style={styles.avatarButtonWrap}
          accessibilityLabel="Profile"
        >
          <ClaySurface radius={22} tint={palette.primaryLight} shadowTint={palette.primaryDark} intensity="sm" style={styles.iconButtonShadow} innerStyle={styles.avatarInner} highlightOpacity={0.24}>
            {avatarUrl && !avatarFailed ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} onError={() => setAvatarFailed(true)} />
            ) : (
              <Text style={[styles.avatarInitial, { color: palette.primaryDark }]}>{profile?.first_name?.[0]?.toUpperCase() ?? '?'}</Text>
            )}
          </ClaySurface>
        </PressableScale>
      </View>
    </View>
  );
}

/**
 * The compact `title …… <HeaderActions/>` row used by screens that
 * only need a page title (Cases/SOS/Shelters) — Home keeps its own
 * bespoke header (wordmark + personalized greeting is genuinely
 * different content) but reuses HeaderActions for its own bell/avatar
 * instead of duplicating that cluster a second time.
 */
export function ScreenHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  return (
    <View style={[styles.screenHeaderRow, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={[styles.screenTitle, { color: palette.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      {trailing}
      <HeaderActions />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  screenHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  screenTitle: { ...typography.heading, fontSize: 22 },
  iconButtonWrap: { width: 44, height: 44 },
  iconButtonShadow: { width: 44, height: 44 },
  iconButtonInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  avatarButtonWrap: { width: 44, height: 44 },
  avatarInner: { alignItems: 'center', justifyContent: 'center', flex: 1, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { ...typography.subheading },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
  },
  badgeDotText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter_600SemiBold' as any },
});

import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { IoniconName } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, radius } from '../../theme/theme';

/**
 * Plain bordered card — was a claymorphic tile (tinted shadow, animated
 * shadow-softening on press) matching this app's older visual language;
 * flattened to match every other screen already redesigned this way
 * (Login/Register/ReportIncident/RequestShelter) — a white surface, a
 * subtle border, a restrained press-scale, nothing else. Fixed height
 * (not minHeight), with always-reserved description/badge slots, is kept
 * from the prior version for the same reason it existed there: all grid
 * tiles stay pixel-identical whether or not a given tile has a badge.
 *
 * `fullWidth` supports the Announcements tile spanning the row alone
 * (HomeScreen's 5-card grid) instead of leaving an empty spacer column —
 * same card, same height, just not wrapped in a `flex:1` sibling pair.
 */
export function QuickActionCard({
  icon,
  tint,
  title,
  description,
  badge,
  reduced,
  onPress,
  fullWidth,
}: {
  icon: IoniconName;
  tint: string;
  title: string;
  description: string;
  badge?: string;
  reduced: boolean;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  const { palette } = useTheme();
  const scale = useSharedValue(1);
  const cardAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const pressIn = () => {
    if (!reduced) scale.value = withTiming(0.97, { duration: 90 });
  };
  const pressOut = () => {
    if (!reduced) scale.value = withSpring(1, { damping: 15, stiffness: 180 });
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      style={fullWidth ? undefined : { flex: 1 }}
    >
      <RAnimated.View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }, fullWidth ? styles.cardFullWidth : null, cardAnimatedStyle]}>
        <View style={[styles.iconWrap, { backgroundColor: tint + '14' }, fullWidth ? { marginTop: 0 } : null]}>
          <Ionicons name={icon} size={18} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.text }, fullWidth ? styles.titleInline : null]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.description, { color: palette.textMuted }, fullWidth ? styles.descriptionInline : null]} numberOfLines={1}>
            {description}
          </Text>
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: tint + '14' }, fullWidth ? styles.badgeInline : null]}>
            <Text style={[styles.badgeText, { color: tint }]} numberOfLines={1}>
              {badge}
            </Text>
          </View>
        ) : null}
      </RAnimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, height: 132, padding: 14, flexDirection: 'column', justifyContent: 'space-between' },
  // Full-width variant (Announcements): a row layout reads better than a
  // tall square once there's a whole row's width to use — icon, title,
  // and description sit side by side instead of stacked.
  cardFullWidth: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.sm },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.bodyMedium, fontSize: 14.5, marginTop: 9 },
  titleInline: { marginTop: 0 },
  description: { ...typography.caption, fontSize: 12.5, marginTop: 2 },
  descriptionInline: { marginTop: 0 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start', marginTop: 4 },
  badgeInline: { marginTop: 0, marginLeft: spacing.xs },
  badgeText: { ...typography.caption, fontSize: 10.5, fontFamily: 'Inter_600SemiBold' as any },
});

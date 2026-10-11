import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { IoniconName } from '../../components/ui';
import { ClaySurface, clayShadow } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, radius } from '../../theme/theme';

/**
 * Claymorphic quick-action tile. Fixed overall height (not minHeight) with
 * a reserved, always-rendered description slot and badge slot — a card
 * without a badge ("Report Incident") renders an empty slot rather than
 * collapsing, so all four grid cards stay pixel-identical in height
 * whether or not they have a status to show. That equal-height guarantee
 * was the actual bug: minHeight let badge-bearing cards grow taller than
 * their neighbors.
 */
export function QuickActionCard({
  icon,
  tint,
  title,
  description,
  badge,
  reduced,
  onPress,
}: {
  icon: IoniconName;
  tint: string;
  title: string;
  description: string;
  badge?: string;
  reduced: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const restShadowOpacity = clayShadow(palette.primaryDark, 'sm').shadowOpacity;
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const shadowOpacity = useSharedValue<number>(restShadowOpacity);
  const iconScale = useSharedValue(1);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
    shadowOpacity: shadowOpacity.value,
  }));
  const iconAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  const pressIn = () => {
    if (!reduced) {
      scale.value = withTiming(0.97, { duration: 90 });
      translateY.value = withTiming(3, { duration: 90 });
      iconScale.value = withTiming(0.9, { duration: 90 });
    }
    shadowOpacity.value = withTiming(0.06, { duration: reduced ? 60 : 90 });
  };
  const pressOut = () => {
    if (!reduced) {
      scale.value = withSpring(1, { damping: 15, stiffness: 180 });
      translateY.value = withSpring(0, { damping: 15, stiffness: 180 });
      iconScale.value = withSpring(1, { damping: 13, stiffness: 200 });
    }
    shadowOpacity.value = withTiming(restShadowOpacity, { duration: reduced ? 90 : 180 });
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      style={{ flex: 1 }}
    >
      <ClaySurface
        radius={18}
        tint={palette.surface}
        shadowTint={palette.primaryDark}
        intensity="sm"
        style={styles.cardShadow}
        innerStyle={styles.cardInner}
        highlightOpacity={0.24}
        animatedStyle={cardAnimatedStyle}
      >
        <RAnimated.View style={iconAnimatedStyle}>
          <ClaySurface radius={14} tint={tint + '1A'} shadowTint={tint} intensity="sm" style={styles.iconShadow} innerStyle={styles.iconInner} highlightOpacity={0.35}>
            <Ionicons name={icon} size={18} color={tint} />
          </ClaySurface>
        </RAnimated.View>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.descriptionSlot}>
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={1}>
            {description}
          </Text>
        </View>
        <View style={styles.badgeSlot}>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: tint + '1A' }]}>
              <Text style={[styles.badgeText, { color: tint }]} numberOfLines={1}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
      </ClaySurface>
    </Pressable>
  );
}

// Fixed height (not minHeight) with always-reserved description/badge
// slots — kept from the prior design, which deliberately guarantees all
// four grid tiles stay pixel-identical whether or not a tile has a
// badge. Trimmed from 160->132 and the description to one line (every
// real description in this app — "Submit a report", "6 active cases" —
// already fits on one line) for a more content-driven, less cavernous
// card.
const styles = StyleSheet.create({
  cardShadow: { height: 132 },
  cardInner: { padding: 14, flex: 1 },
  iconShadow: { width: 34, height: 34 },
  iconInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  title: { ...typography.bodyMedium, fontSize: 14.5, marginTop: 9 },
  descriptionSlot: { height: 17, marginTop: 2, justifyContent: 'flex-start' },
  description: { ...typography.caption, fontSize: 12.5, lineHeight: 17 },
  badgeSlot: { height: 20, marginTop: 4, justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { ...typography.caption, fontSize: 10.5, fontFamily: 'Inter_600SemiBold' as any },
});

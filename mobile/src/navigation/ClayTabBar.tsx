import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RAnimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { ClaySurface } from '../theme/clay';
import { useTheme } from '../contexts/ThemeContext';
import { useTour } from '../contexts/TourContext';
import { measureAndRegister } from '../lib/tourMeasure';
import { IoniconName } from '../components/ui';
import { spacing, typography } from '../theme/theme';

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  HomeTab: { active: 'home', inactive: 'home-outline' },
  CasesTab: { active: 'document-text', inactive: 'document-text-outline' },
  SosTab: { active: 'alert-circle', inactive: 'alert-circle-outline' },
  ChatTab: { active: 'chatbubble', inactive: 'chatbubble-outline' },
  SheltersTab: { active: 'location', inactive: 'location-outline' },
};

function TabButton({
  routeName,
  label,
  isFocused,
  onPress,
}: {
  routeName: string;
  label: string;
  isFocused: boolean;
  onPress: () => void;
}) {
  const { palette, prefs } = useTheme();
  const { registerTarget, registerTargetRef } = useTour();
  const innerRef = useRef<View>(null);
  const reduced = prefs.reduceMotion;
  const isSos = routeName === 'SosTab';
  // SOS keeps its emergency tint constant regardless of focus — a muted
  // SOS icon would read as "this tab isn't important right now", which
  // is exactly the wrong message for the one tab that's always meant to
  // stay recognizable.
  const tint = isSos ? palette.danger : isFocused ? palette.primary : palette.textMuted;

  const iconScale = useSharedValue(isFocused ? 1.08 : 1);
  const labelOpacity = useSharedValue(isFocused ? 1 : 0);
  const pillScale = useSharedValue(isFocused ? 1 : 0.6);
  const pillOpacity = useSharedValue(isFocused ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      iconScale.value = isFocused ? 1.08 : 1;
      labelOpacity.value = isFocused ? 1 : 0;
      pillScale.value = isFocused ? 1 : 0.6;
      pillOpacity.value = isFocused ? 1 : 0;
      return;
    }
    iconScale.value = withSpring(isFocused ? 1.08 : 1, { damping: 15, stiffness: 200 });
    labelOpacity.value = withTiming(isFocused ? 1 : 0, { duration: 220 });
    pillScale.value = withSpring(isFocused ? 1 : 0.6, { damping: 15, stiffness: 200 });
    pillOpacity.value = withTiming(isFocused ? 1 : 0, { duration: 220 });
  }, [isFocused, reduced, iconScale, labelOpacity, pillScale, pillOpacity]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));
  const pillStyle = useAnimatedStyle(() => ({ opacity: pillOpacity.value, transform: [{ scale: pillScale.value }] }));

  const icons = TAB_ICONS[routeName];

  return (
    <Pressable
      onPress={onPress}
      style={styles.tabButton}
      accessibilityRole="button"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
      hitSlop={4}
    >
      <View
        ref={innerRef}
        onLayout={() => {
          // Measuring this inner content box (not the outer flex:1
          // Pressable, which spans this tab's whole 1/5 slice of the bar)
          // is what lets the tour spotlight hug just the icon+label pill
          // instead of a wide band across a fifth of the nav bar.
          measureAndRegister(innerRef, `tab:${routeName}`, registerTarget, registerTargetRef, { shape: 'pill' });
        }}
        style={styles.tabButtonInner}
      >
        <RAnimated.View style={[styles.activePill, { backgroundColor: isSos ? palette.danger + '1A' : palette.primaryLight }, pillStyle]} />
        <RAnimated.View style={iconStyle}>
          <Ionicons name={isFocused ? icons.active : icons.inactive} size={21} color={tint} />
        </RAnimated.View>
        <RAnimated.View style={labelStyle}>
          <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
        </RAnimated.View>
      </View>
    </Pressable>
  );
}

/**
 * Floating claymorphic tab bar replacing React Navigation's default flat
 * one. Reads colors from ThemeContext so it follows Light/Dark like every
 * other surface in the app — this is the one navigation chrome element
 * visible on every authenticated screen, so it mattered most to get
 * theme-reactive.
 */
export function ClayTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette } = useTheme();
  const { skip } = useTour();
  const insets = useSafeAreaInsets();

  // Deliberately NOT position:'absolute' — this View stays in normal
  // layout flow as the last sibling under the screen content, which is
  // what lets React Navigation measure its real height and reserve
  // matching space so screen content never ends up hidden underneath it.
  // The "floating" look comes from margins + rounded corners + shadow on
  // the clay surface inside, not from removing it from layout.
  return (
    <View style={[styles.wrap, { backgroundColor: palette.background, borderTopColor: palette.border, paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.xs }]}>
      <ClaySurface
        radius={16}
        tint={palette.surface}
        shadowTint={palette.primaryDark}
        intensity="sm"
        style={styles.barShadow}
        innerStyle={styles.barInner}
        highlightOpacity={0.14}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = (options.title ?? route.name) as string;
          const isFocused = state.index === index;

          const onPress = () => {
            // Any real tab press — including SOS — hands control back to
            // the real app immediately; the tour never gets a second
            // chance to resurface on its own after this.
            skip();
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return <TabButton key={route.key} routeName={route.name} label={label} isFocused={isFocused} onPress={onPress} />;
        })}
      </ClaySurface>
    </View>
  );
}

// Edge-to-edge and flat-top now ("integrated" rather than a pill-shaped
// island inset from the screen edges) — a small top border substitutes
// for the shadow/margin that used to separate it from content above.
const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.xs, borderTopWidth: 1 },
  barShadow: { borderRadius: 0 },
  barInner: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  tabButtonInner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 10, minWidth: 56 },
  activePill: { position: 'absolute', top: -3, width: 40, height: 40, borderRadius: 14 },
  label: { ...typography.caption, fontSize: 10.5, fontFamily: 'Inter_600SemiBold' as any, marginTop: 2 },
});

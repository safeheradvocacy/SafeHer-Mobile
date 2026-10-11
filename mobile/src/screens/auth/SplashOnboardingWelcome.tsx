import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Animated,
  Dimensions,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Modal,
  Linking,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, withRepeat, withSequence, withSpring, Easing, SharedValue } from 'react-native-reanimated';
import { colors, spacing, typography, radius } from '../../theme/theme';
import { ClaySurface, clayShadow, ClayPalette } from '../../theme/clay';
import { PrimaryButton, PressableScale, IoniconName, useReducedMotion, FadeInUp } from '../../components/ui';
import { LogoMark } from '../../components/branding/LogoMark';
import { AuthStackParamList } from '../../navigation/types';
import { markOnboardingComplete } from '../../lib/onboarding';
import { useTheme } from '../../contexts/ThemeContext';
import { SettingsSheet } from '../../components/SettingsSheet';
import { getOnboardingStrings, SLIDE_META, getSlideTint, SlideKey } from './onboardingContent';
import { getWelcomeStrings, getFeatureTint, FEATURE_META, FeatureKey } from './welcomeContent';

const { width } = Dimensions.get('window');

// A single dashed accent ring — the recurring "encrypted signal / protected
// perimeter" motif used across the onboarding icon compositions. Kept as
// thin line art (never filled) so it reads as structure, not decoration.
function DashedRing({ size, color, opacity = 1, strokeWidth = 1.5, dash = '2 6' }: { size: number; color: string; opacity?: number; strokeWidth?: number; dash?: string }) {
  const r = size / 2 - strokeWidth;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        opacity={opacity}
        fill="none"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------
// Shared onboarding illustration motion system — every slide's visual is
// built from these same few primitives (gentle float, occasional soft
// pulse, small glowing dots) so the three illustrations read as one
// designed family rather than three unrelated graphics. All loops are
// slow (3.5s+) and low-amplitude on purpose; none of them ever repeat
// faster than a natural breathing rhythm. Every one is skipped entirely
// under reduce-motion, settling immediately at its resting position.
// ---------------------------------------------------------------------

/** Gentle continuous up/down drift — used for each slide's primary
 * floating badge ("shield gently floating" / "gentle floating
 * animation"). */
function Float({ reduced, distance = 5, duration = 2200, children, style }: { reduced: boolean; distance?: number; duration?: number; children?: React.ReactNode; style?: object }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(withSequence(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [reduced, duration]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -progress.value * distance }] }));
  return <RAnimated.View style={[style, reduced ? null : animatedStyle]}>{children}</RAnimated.View>;
}

/** A soft ring that expands and fades once, then pauses before repeating
 * — SOS's "very subtle emergency pulse... once every few seconds", never
 * a continuous flash. */
function PulseRing({ tint, reduced }: { tint: string; reduced: boolean }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(
      withSequence(withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }), withDelay(2200, withTiming(0, { duration: 0 }))),
      -1,
      false
    );
  }, [reduced]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.45,
    transform: [{ scale: 1 + progress.value * 0.32 }],
  }));
  if (reduced) return null;
  return <RAnimated.View pointerEvents="none" style={[styles.pulseRing, { borderColor: tint }, animatedStyle]} />;
}

/** A small soft glowing dot that slowly fades in and out on its own
 * loop — used both as SOS/Report's "small floating indicator" and as
 * Report's "tiny security particle", just repositioned and retimed per
 * use so the same visual language covers both without inventing a
 * second motif. */
function FloatingDot({ tint, size = 9, delay = 0, style, reduced }: { tint: string; size?: number; delay?: number; style?: object; reduced: boolean }) {
  const progress = useSharedValue(0.25);
  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), withTiming(0.25, { duration: 1600, easing: Easing.inOut(Easing.sin) })), -1, false)
    );
  }, [reduced, delay]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.7 + progress.value * 0.3 }] }));
  return (
    <RAnimated.View
      pointerEvents="none"
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint },
        style,
        reduced ? { opacity: 0.6 } : animatedStyle,
      ]}
    />
  );
}

export function SplashScreen() {
  return (
    <LinearGradient
      colors={[colors.primaryDark, colors.primary, colors.accent]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.splash}
    >
      <StatusBar style="light" />
      <Text style={styles.brand}>SafeSpace</Text>
      <Text style={styles.tagline}>Safety • Trust • Protection • Compassion • Hope</Text>
      <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.white} />
    </LinearGradient>
  );
}

interface ResolvedSlide {
  key: SlideKey;
  icon: IoniconName;
  badgeIcon: IoniconName;
  title: string;
  body: string;
  tint: string;
  visualLabel: string;
}

/** One status node + (optionally) the connector after it. Pulled out
 * into its own component — rather than calling useAnimatedStyle inside
 * a .map() — so each node's hooks run unconditionally and in a stable
 * order every render, the same guarantee the rules of hooks require. */
function TimelineNode({ label, index, progress, tint, isLast, palette }: { label: string; index: number; progress: SharedValue<number>; tint: string; isLast: boolean; palette: ClayPalette }) {
  const dotStyle = useAnimatedStyle(() => {
    const active = progress.value > index;
    return {
      backgroundColor: active ? tint : palette.border,
      transform: [{ scale: active && progress.value < index + 1 ? 1.15 : 1 }],
    };
  });
  const labelStyle = useAnimatedStyle(() => ({ opacity: progress.value > index ? 1 : 0.55 }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: progress.value > index + 0.6 ? 1 : 0 }));
  const connectorStyle = useAnimatedStyle(() => ({ backgroundColor: progress.value > index + 1 ? tint : palette.border }));

  return (
    <React.Fragment>
      <View style={styles.timelineNode}>
        <RAnimated.View style={[styles.timelineDot, dotStyle]}>
          {isLast ? (
            <RAnimated.View style={checkStyle}>
              <Ionicons name="checkmark" size={8} color={palette.white} />
            </RAnimated.View>
          ) : null}
        </RAnimated.View>
        <RAnimated.View style={labelStyle}>
          <Text style={[styles.timelineLabel, { color: palette.textMuted }]}>{label}</Text>
        </RAnimated.View>
      </View>
      {!isLast ? <RAnimated.View style={[styles.timelineConnector, { backgroundColor: palette.border }, connectorStyle]} /> : null}
    </React.Fragment>
  );
}

/** The one slide whose supporting graphic is data-shaped (a status
 * timeline) rather than a single icon — animates a slow, looping
 * "sweep" through the three stages purely as ambient motion. This is
 * illustrative onboarding content, not a real case, so it intentionally
 * keeps auto-repeating rather than landing on a fixed state. */
function CaseTimeline({ tint, reduced, steps, palette }: { tint: string; reduced: boolean; steps: readonly [string, string, string]; palette: ClayPalette }) {
  const progress = useSharedValue(reduced ? 3 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(
      500,
      withRepeat(withSequence(withTiming(3, { duration: 1800, easing: Easing.out(Easing.cubic) }), withDelay(1800, withTiming(0, { duration: 0 }))), -1, false)
    );
  }, [reduced]);

  return (
    <ClaySurface radius={18} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.timelineCard}>
      <View style={styles.timeline}>
        {steps.map((step, i) => (
          <TimelineNode key={step} label={step} index={i} progress={progress} tint={tint} isLast={i === steps.length - 1} palette={palette} />
        ))}
      </View>
    </ClaySurface>
  );
}

// Every slide's core icon sits in the same soft-3D "medallion": a solid
// tint-colored circle, a diagonal translucent-white gloss for a glass
// highlight, and a colored ambient shadow — one consistent light source
// and depth treatment reused across all three illustrations rather than
// three different graphic styles. This is the one deliberately
// "level 3" (most dimensional) surface on the screen — header controls
// and the CTA are level 2, intentionally quieter.
function SlideVisual({ item, reduced, timelineSteps, palette }: { item: ResolvedSlide; reduced: boolean; timelineSteps: readonly [string, string, string]; palette: ClayPalette }) {
  return (
    <View style={styles.visualColumn} accessible accessibilityLabel={item.visualLabel}>
      <View style={styles.iconRing}>
        <View style={[styles.claySeat, { backgroundColor: palette.surfaceMuted }]} />
        <DashedRing size={172} color={item.tint} opacity={0.13} dash="1 7" />
        <DashedRing size={152} color={item.tint} opacity={0.26} dash="3 6" />

        {item.key === 'sos' ? <PulseRing tint={item.tint} reduced={reduced} /> : null}

        <View style={[styles.medallionShadow, { shadowColor: item.tint }]}>
          <View style={[styles.iconCircle, { backgroundColor: item.tint }]}>
            <LinearGradient
              colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.75, y: 0.8 }}
              style={StyleSheet.absoluteFill}
            />
            <Ionicons name={item.icon} size={46} color={palette.white} />
          </View>
        </View>

        <Float reduced={reduced} distance={5} duration={2200} style={styles.iconBadge}>
          <View style={[styles.iconBadgeInner, { backgroundColor: palette.surface, borderColor: palette.background, shadowColor: palette.primaryDark }]}>
            <Ionicons name={item.badgeIcon} size={18} color={item.tint} />
          </View>
        </Float>

        <FloatingDot tint={item.tint} size={9} delay={200} reduced={reduced} style={styles.dotTopLeft} />
        <FloatingDot tint={item.tint} size={6} delay={900} reduced={reduced} style={styles.dotBottomLeft} />
      </View>

      {item.key === 'track' ? <CaseTimeline tint={item.tint} reduced={reduced} steps={timelineSteps} palette={palette} /> : null}
    </View>
  );
}

function SkipConfirmModal({
  visible,
  onCancel,
  onConfirm,
  palette,
  strings,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  palette: ClayPalette;
  strings: ReturnType<typeof getOnboardingStrings>;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.confirmBackdrop} onPress={onCancel} accessibilityViewIsModal>
        <ClaySurface
          radius={22}
          tint={palette.surface}
          shadowTint={palette.primaryDark}
          intensity="lg"
          style={styles.confirmCardShadow}
          innerStyle={styles.confirmCardInner}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.confirmTitle, { color: palette.text }]}>{strings.skipConfirmTitle}</Text>
            <Text style={[styles.confirmBody, { color: palette.textMuted }]}>{strings.skipConfirmBody}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={onCancel}
                hitSlop={6}
                style={({ pressed }) => [styles.confirmBtn, { backgroundColor: palette.surfaceMuted }, pressed ? { opacity: 0.7 } : null]}
                accessibilityRole="button"
                accessibilityLabel={strings.skipConfirmContinue}
              >
                <Text style={[styles.confirmBtnGhostText, { color: palette.text }]}>{strings.skipConfirmContinue}</Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                hitSlop={6}
                style={({ pressed }) => [styles.confirmBtn, { backgroundColor: palette.primary }, pressed ? { opacity: 0.9 } : null]}
                accessibilityRole="button"
                accessibilityLabel={strings.skipConfirmSkip}
              >
                <Text style={styles.confirmBtnPrimaryText}>{strings.skipConfirmSkip}</Text>
              </Pressable>
            </View>
          </Pressable>
        </ClaySurface>
      </Pressable>
    </Modal>
  );
}

/** Small circular claymorphic control — the shared shell for both the
 * header's Back and Settings buttons, so they're guaranteed to look
 * identical (same radius, shadow, highlight) regardless of which icon
 * or action they carry. Never recolored per-slide. */
function ClayCircleButton({ icon, onPress, palette, label, hint }: { icon: IoniconName; onPress: () => void; palette: ClayPalette; label: string; hint?: string }) {
  return (
    <PressableScale onPress={onPress} pressScale={0.94} accessibilityLabel={label} accessibilityHint={hint} hitSlop={4}>
      <ClaySurface radius={22} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={styles.clayCircle} innerStyle={styles.clayCircleInner}>
        <Ionicons name={icon} size={19} color={palette.primaryDark} />
      </ClaySurface>
    </PressableScale>
  );
}

function OnboardingHeader({
  showBack,
  onBack,
  showSkip,
  onSkip,
  onSettings,
  palette,
  strings,
  insetsTop,
}: {
  showBack: boolean;
  onBack: () => void;
  showSkip: boolean;
  onSkip: () => void;
  onSettings: () => void;
  palette: ClayPalette;
  strings: ReturnType<typeof getOnboardingStrings>;
  insetsTop: number;
}) {
  return (
    <View style={[styles.headerRow, { paddingTop: insetsTop + spacing.sm }]}>
      {showBack ? (
        <ClayCircleButton icon="chevron-back" onPress={onBack} palette={palette} label={strings.back} hint="Returns to the previous onboarding screen" />
      ) : (
        <View style={styles.clayCircle} />
      )}
      <View style={styles.headerRight}>
        {showSkip ? (
          <PressableScale onPress={onSkip} hitSlop={10} accessibilityLabel={strings.skip}>
            <Text style={[styles.skipText, { color: palette.textMuted }]}>{strings.skip}</Text>
          </PressableScale>
        ) : null}
        <ClayCircleButton icon="settings-outline" onPress={onSettings} palette={palette} label={strings.settingsTitle} hint="Opens accessibility, appearance, language, and privacy options" />
      </View>
    </View>
  );
}

export function OnboardingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>>();
  const insets = useSafeAreaInsets();
  const systemReducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const { palette, isDark, prefs } = useTheme();
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const listRef = useRef<FlatList<ResolvedSlide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Guards against rapid repeated taps firing another paging animation
  // before the current one settles, and against a swipe-in-progress plus
  // a Next/Back tap both trying to move the list at once.
  const transitioningRef = useRef(false);

  const reduced = systemReducedMotion || prefs.reduceMotion;
  const strings = useMemo(() => getOnboardingStrings(prefs.language), [prefs.language]);
  const slides: ResolvedSlide[] = useMemo(
    () =>
      SLIDE_META.map((meta) => ({
        ...meta,
        tint: getSlideTint(meta.key, palette),
        title: strings.slides[meta.key].title,
        body: strings.slides[meta.key].body,
      })),
    [palette, strings]
  );
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.15 : 1;
  const bodyFontScale = prefs.largerText ? 1.1 : 1;

  const finishOnboarding = async (target: 'Welcome') => {
    await markOnboardingComplete();
    navigation.replace(target);
  };

  const goToIndex = (i: number) => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    listRef.current?.scrollToOffset({ offset: i * width, animated: !reduced });
    setIndex(i);
    if (reduced) transitioningRef.current = false;
  };

  const next = () => {
    if (transitioningRef.current) return;
    if (index < slides.length - 1) goToIndex(index + 1);
    else finishOnboarding('Welcome');
  };

  const back = () => {
    if (transitioningRef.current || index === 0) return;
    goToIndex(index - 1);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    transitioningRef.current = false;
  };

  const requestSkip = () => setShowSkipConfirm(true);
  const confirmSkip = () => {
    setShowSkipConfirm(false);
    finishOnboarding('Welcome');
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <OnboardingHeader
        showBack={index > 0}
        onBack={back}
        showSkip={index < slides.length - 1}
        onSkip={requestSkip}
        onSettings={() => setShowSettings(true)}
        palette={palette}
        strings={strings}
        insetsTop={insets.top}
      />

      <Animated.FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => {
          transitioningRef.current = true;
        }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item, index: i }) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          // Illustration moves/scales the most while swiping (medium
          // parallax layer), text trails slightly behind it (subtle
          // layer) — the depth cue the brief asks for without a fully
          // custom gesture implementation.
          const illustrationScale = scrollX.interpolate({ inputRange, outputRange: [0.75, 1, 0.75], extrapolate: 'clamp' });
          const illustrationOpacity = scrollX.interpolate({ inputRange, outputRange: [0.4, 1, 0.4], extrapolate: 'clamp' });
          const textTranslate = scrollX.interpolate({ inputRange, outputRange: [18, 0, -18], extrapolate: 'clamp' });
          const textOpacity = scrollX.interpolate({ inputRange, outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' });
          return (
            <View style={[styles.slide, { width }]}>
              <Animated.View style={{ transform: [{ scale: illustrationScale }], opacity: illustrationOpacity }}>
                <SlideVisual item={item} reduced={reduced} timelineSteps={strings.timelineSteps} palette={palette} />
              </Animated.View>
              <Animated.View style={{ transform: [{ translateX: textTranslate }], opacity: textOpacity }}>
                <Text style={[styles.slideTitle, { color: palette.text, fontSize: 22 * titleFontScale }]}>{item.title}</Text>
                <Text style={[styles.slideBody, { color: bodyColor, fontSize: 15 * bodyFontScale }]}>{item.body}</Text>
              </Animated.View>
            </View>
          );
        }}
      />

      <View style={styles.dots} accessible accessibilityLabel={`Screen ${index + 1} of ${slides.length}`}>
        {slides.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const dotWidth = scrollX.interpolate({ inputRange, outputRange: [8, 26, 8], extrapolate: 'clamp' });
          const dotOpacity = scrollX.interpolate({ inputRange, outputRange: [1, 1, 1], extrapolate: 'clamp' });
          const isNear = index === i;
          return (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                { width: dotWidth, backgroundColor: isNear ? palette.primary : palette.surfaceMuted, opacity: dotOpacity },
                isNear ? clayShadow(palette.primaryDark, 'sm') : null,
              ]}
            />
          );
        })}
      </View>

      <View style={[styles.ctaRow, { paddingBottom: insets.bottom + spacing.md }]}>
        <PrimaryButton title={index === slides.length - 1 ? strings.getStarted : strings.next} onPress={next} size="lg" />
      </View>

      <SkipConfirmModal visible={showSkipConfirm} onCancel={() => setShowSkipConfirm(false)} onConfirm={confirmSkip} palette={palette} strings={strings} />
      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={strings.settingsTitle} />
    </View>
  );
}

// The old translucent ring halo (9-17% opacity white circles) read as
// barely-there against the purple hero — nowhere near enough contrast for
// the logo to stand out. This is now a proper solid warm-white
// claymorphic circle (the same ClaySurface material every other raised
// element on this screen uses), sized with generous padding around the
// mark so it reads as "logo set into a premium clay disc", not a busy
// halo. Entrance: the circle fades in, the mark itself fades in slightly
// after and scales 96% -> 100% with a soft spring settle. Under
// reduce-motion both still fade in (just no scale, no float) rather than
// snapping to their final state instantly.
function WelcomeHeroLogo({ reduced }: { reduced: boolean }) {
  const circleOpacity = useSharedValue(0);
  const markOpacity = useSharedValue(0);
  const markScale = useSharedValue(reduced ? 1 : 0.96);

  useEffect(() => {
    if (reduced) {
      circleOpacity.value = withTiming(1, { duration: 220 });
      markOpacity.value = withTiming(1, { duration: 220 });
      return;
    }
    circleOpacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    markOpacity.value = withDelay(90, withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
    markScale.value = withDelay(90, withSpring(1, { damping: 16, stiffness: 150, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const circleStyle = useAnimatedStyle(() => ({ opacity: circleOpacity.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));

  return (
    <View style={styles.heroIllustrationRing}>
      <RAnimated.View style={circleStyle}>
        <ClaySurface
          radius={74}
          tint={colors.surface}
          shadowTint={colors.primaryDark}
          intensity="md"
          style={styles.logoCircleShadow}
          innerStyle={styles.clayCircleInner}
          highlightOpacity={0.38}
        >
          <RAnimated.View style={markStyle}>
            <Float reduced={reduced} distance={2} duration={3600}>
              <LogoMark size="lg" />
            </Float>
          </RAnimated.View>
        </ClaySurface>
      </RAnimated.View>
      <FloatingDot tint="#FFFFFF" size={7} delay={200} reduced={reduced} style={styles.heroDotTopLeft} />
      <FloatingDot tint={colors.accent} size={5} delay={900} reduced={reduced} style={styles.heroDotBottomLeft} />
    </View>
  );
}

// A "How we can help" row: press feedback is a coordinated three-part
// response — the row itself compresses and nudges down slightly, its
// icon chip's clay shadow softens (reads as "pressed into the surface"),
// and the icon scales down a touch further than the row for a subtle
// extra pop. Release settles back with a spring, never a hard snap.
function ServiceRow({
  meta,
  copy,
  tint,
  isLast,
  palette,
  bodyColor,
  reduced,
  delay,
  onPress,
}: {
  meta: { key: FeatureKey; icon: IoniconName };
  copy: { title: string; short: string };
  tint: string;
  isLast: boolean;
  palette: ClayPalette;
  bodyColor: string;
  reduced: boolean;
  delay: number;
  onPress: () => void;
}) {
  const restIconShadowOpacity = clayShadow(tint, 'sm').shadowOpacity;
  const scale = useSharedValue(1);
  const iconScale = useSharedValue(1);
  const iconShadowOpacity = useSharedValue<number>(restIconShadowOpacity);

  // Rows compress and their icon settles inward (scales down + its clay
  // shadow softens) — no downward nudge, that's reserved for the primary
  // CTA so buttons and flat clay rows read as two distinct, consistent
  // "weights" within the same material system rather than everything
  // moving identically.
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    shadowOpacity: iconShadowOpacity.value,
  }));

  const pressIn = () => {
    if (!reduced) {
      scale.value = withTiming(0.98, { duration: 90 });
      iconScale.value = withTiming(0.9, { duration: 90 });
    }
    iconShadowOpacity.value = withTiming(0.04, { duration: reduced ? 60 : 90 });
  };
  const pressOut = () => {
    if (!reduced) {
      scale.value = withSpring(1, { damping: 15, stiffness: 180 });
      iconScale.value = withSpring(1, { damping: 13, stiffness: 200 });
    }
    iconShadowOpacity.value = withTiming(restIconShadowOpacity, { duration: reduced ? 90 : 180 });
  };

  return (
    <FadeInUp reduced={reduced} delay={delay} distance={10}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={copy.title}
        accessibilityHint={`Shows more information about ${copy.title}`}
      >
        <RAnimated.View style={[styles.featureRow, !isLast && { borderBottomWidth: 1, borderBottomColor: palette.border }, rowStyle]}>
          <ClaySurface
            radius={20}
            tint={tint + '1A'}
            shadowTint={tint}
            intensity="sm"
            style={styles.featureIconShadow}
            innerStyle={styles.clayCircleInner}
            highlightOpacity={0.24}
            animatedStyle={iconAnimatedStyle}
          >
            <Ionicons name={meta.icon} size={19} color={tint} />
          </ClaySurface>
          <View style={styles.featureRowText}>
            <Text style={[styles.featureRowTitle, { color: palette.text }]}>{copy.title}</Text>
            <Text style={[styles.featureRowDesc, { color: bodyColor }]}>{copy.short}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
        </RAnimated.View>
      </Pressable>
    </FadeInUp>
  );
}

function InfoSheet({
  visible,
  onClose,
  palette,
  icon,
  tint,
  title,
  body,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  palette: ClayPalette;
  icon: IoniconName;
  tint: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.confirmBackdrop} onPress={onClose} accessibilityViewIsModal>
        <ClaySurface radius={22} tint={palette.surface} shadowTint={palette.primaryDark} intensity="lg" style={styles.confirmCardShadow} innerStyle={styles.confirmCardInner}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[styles.infoSheetIcon, { backgroundColor: tint + '1A' }]}>
              <Ionicons name={icon} size={24} color={tint} />
            </View>
            <Text style={[styles.confirmTitle, { color: palette.text, textAlign: 'center' }]}>{title}</Text>
            <Text style={[styles.confirmBody, { color: palette.textMuted, textAlign: 'center' }]}>{body}</Text>
            {children}
            <PrimaryButton title="Got it" variant="outline" onPress={onClose} />
          </Pressable>
        </ClaySurface>
      </Pressable>
    </Modal>
  );
}

function EmergencySheet({
  visible,
  onClose,
  palette,
  strings,
  onCreateAccount,
}: {
  visible: boolean;
  onClose: () => void;
  palette: ClayPalette;
  strings: ReturnType<typeof getWelcomeStrings>;
  onCreateAccount: () => void;
}) {
  const call911 = () => Linking.openURL('tel:911');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.confirmBackdrop} onPress={onClose} accessibilityViewIsModal>
        <ClaySurface radius={22} tint={palette.surface} shadowTint={palette.primaryDark} intensity="lg" style={styles.confirmCardShadow} innerStyle={styles.confirmCardInner}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[styles.infoSheetIcon, { backgroundColor: palette.danger + '1A' }]}>
              <Ionicons name="alert-circle" size={24} color={palette.danger} />
            </View>
            <Text style={[styles.confirmTitle, { color: palette.text, textAlign: 'center' }]}>{strings.emergencySheetTitle}</Text>
            <Text style={[styles.confirmBody, { color: palette.textMuted, textAlign: 'center' }]}>{strings.emergencySheetCallDesc}</Text>
            <PrimaryButton title={strings.emergencySheetCall} variant="danger" icon="call" onPress={call911} />
            <View style={[styles.emergencyNote, { backgroundColor: palette.surfaceMuted }]}>
              <Text style={[styles.emergencyNoteText, { color: palette.textMuted }]}>{strings.emergencySheetAppNote}</Text>
            </View>
            <PrimaryButton title={strings.createAccount} variant="outline" onPress={onCreateAccount} />
          </Pressable>
        </ClaySurface>
      </Pressable>
    </Modal>
  );
}

// The "Need help now?" panel — deliberately NOT a red-outlined/glowing
// alert box. Urgency is carried by the blush fill, a darker pink accent
// strip, and red-toned icon/title text; the ambient shadow itself stays
// neutral (palette.primaryDark, same as every other card on this screen)
// so the card never reads as having a glowing red border. Tactile press
// feedback matches the primary CTA's language: a slight downward nudge
// and a softened shadow, not just an opacity dim.
function EmergencyBanner({
  palette,
  strings,
  reduced,
  delay,
  onPress,
}: {
  palette: ClayPalette;
  strings: ReturnType<typeof getWelcomeStrings>;
  reduced: boolean;
  delay: number;
  onPress: () => void;
}) {
  const restShadowOpacity = clayShadow(palette.primaryDark, 'sm').shadowOpacity;
  const scale = useSharedValue(1);
  const shadowOpacity = useSharedValue<number>(restShadowOpacity);

  // Cards compress and soften their shadow on press but don't nudge
  // downward — that vertical "physical push" is reserved for the primary
  // CTA (see PrimaryPressable) so buttons read as more dimensional than
  // flat clay surfaces, a deliberate distinction rather than every
  // pressable element moving the same way.
  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOpacity: shadowOpacity.value,
  }));

  const pressIn = () => {
    if (!reduced) {
      scale.value = withTiming(0.98, { duration: 100 });
    }
    shadowOpacity.value = withTiming(0.05, { duration: reduced ? 70 : 100 });
  };
  const pressOut = () => {
    if (!reduced) {
      scale.value = withSpring(1, { damping: 16, stiffness: 190 });
    }
    shadowOpacity.value = withTiming(restShadowOpacity, { duration: reduced ? 100 : 200 });
  };

  return (
    <FadeInUp reduced={reduced} delay={delay} style={{ marginTop: spacing.md }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={strings.emergencyTitle}
        accessibilityHint="Opens emergency help options, including calling 911"
      >
        {/* A deliberate, controlled two-stop rose gradient — not the
            generic diagonal white-gloss highlight every other ClaySurface
            gets (highlightOpacity=0 below), which read as a messy overlay
            once layered on top of a tinted fill. Just a calm light-rose
            to slightly-warmer-rose wash, plus a crisp accent strip. */}
        <ClaySurface
          radius={20}
          tint="transparent"
          shadowTint={palette.primaryDark}
          intensity="sm"
          style={styles.safetyBannerShadow}
          innerStyle={styles.safetyBannerInner}
          highlightOpacity={0}
          animatedStyle={cardAnimatedStyle}
        >
          <LinearGradient
            colors={[palette.danger + '0F', palette.danger + '1C']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={[styles.safetyAccentStrip, { backgroundColor: palette.dangerDark }]} />
          <ClaySurface
            radius={18}
            tint={palette.white}
            shadowTint={palette.dangerDark}
            intensity="sm"
            style={styles.safetyIconShadow}
            innerStyle={styles.clayCircleInner}
            highlightOpacity={0.28}
          >
            <Ionicons name="alert-circle" size={19} color={palette.dangerDark} />
          </ClaySurface>
          <View style={styles.safetyText}>
            <Text style={[styles.safetyTitle, { color: palette.dangerDark }]}>{strings.emergencyTitle}</Text>
            <Text style={[styles.safetyBody, { color: palette.text }]}>{strings.emergencyBody}</Text>
          </View>
          <Ionicons name="chevron-forward" size={15} color={palette.dangerDark} />
        </ClaySurface>
      </Pressable>
    </FadeInUp>
  );
}

export function WelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Welcome'>>();
  const insets = useSafeAreaInsets();
  const systemReducedMotion = useReducedMotion();
  // The hero banner keeps a fixed brand-blue gradient in both themes
  // (a deliberate choice — see welcomeHero below), so unlike Onboarding's
  // header this screen doesn't need `isDark` to pick a status bar style.
  const { palette, prefs } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [activeFeature, setActiveFeature] = useState<FeatureKey | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const reduced = systemReducedMotion || prefs.reduceMotion;
  const strings = useMemo(() => getWelcomeStrings(prefs.language), [prefs.language]);
  const bodyColor = prefs.highContrast ? palette.text : palette.textMuted;
  const titleFontScale = prefs.largerText ? 1.12 : 1;

  const goToRegister = () => navigation.navigate('Register');
  const goToLogin = () => navigation.navigate('Login');

  // Extremely subtle — the hero eases from 100% to 94% over the first
  // ~140px of scroll, then holds. Pure transform, so this can run on the
  // native/UI thread instead of the JS thread.
  const heroScale = scrollY.interpolate({ inputRange: [0, 140], outputRange: [1, 0.94], extrapolate: 'clamp' });

  const activeFeatureMeta = activeFeature ? FEATURE_META.find((f) => f.key === activeFeature) : null;
  const activeFeatureCopy = activeFeature ? strings.features[activeFeature] : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style="light" />

      {/* Content scrolls independently of the pinned CTA footer below, so
          nothing clips or pushes buttons off-screen on smaller phones no
          matter how tall this section grows. */}
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
          <LinearGradient
            colors={[colors.primaryDark, colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.welcomeHero, { paddingTop: insets.top + spacing.sm }]}
          >
            <Float reduced={reduced} distance={4} duration={5400} style={styles.heroDecoRingLarge} />
            <View style={styles.heroDecoRingSmall} />
            <Float reduced={reduced} distance={3} duration={4700} style={styles.heroDecoRingTiny} />
            <View style={styles.heroDecoRingMicro} />

            <View style={styles.heroTopRow}>
              <View style={{ width: 48 }} />
              <PressableScale onPress={() => setShowSettings(true)} pressScale={0.94} accessibilityLabel={strings.settingsTitle} accessibilityHint="Opens accessibility, appearance, language, and privacy options">
                <ClaySurface radius={24} tint="rgba(255,255,255,0.18)" shadowTint={colors.primaryDark} intensity="sm" style={styles.heroSettingsButton} innerStyle={styles.clayCircleInner} highlightOpacity={0.14}>
                  <Ionicons name="settings-outline" size={20} color={colors.white} />
                </ClaySurface>
              </PressableScale>
            </View>

            <View style={{ alignItems: 'center' }}>
              <WelcomeHeroLogo reduced={reduced} />
            </View>
            <FadeInUp reduced={reduced} delay={140} style={{ alignItems: 'center' }}>
              <Text style={styles.welcomeBrand}>SafeSpace</Text>
            </FadeInUp>
            <FadeInUp reduced={reduced} delay={220} style={{ alignItems: 'center' }}>
              <Text style={styles.welcomeHeroText}>{strings.heroTagline}</Text>
            </FadeInUp>
          </LinearGradient>
        </Animated.View>

        <View style={styles.welcomeContent}>
          <FadeInUp reduced={reduced} delay={270}>
            <Text style={[styles.welcomeHeadline, { color: palette.text, fontSize: 24 * titleFontScale }]}>{strings.headline}</Text>
            <Text style={[styles.welcomeBody, { color: bodyColor }]}>{strings.supporting}</Text>
          </FadeInUp>

          <FadeInUp reduced={reduced} delay={340} style={{ marginTop: spacing.lg }}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>{strings.howWeCanHelp}</Text>
          </FadeInUp>

          <ClaySurface radius={20} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" style={{ marginTop: spacing.sm }} innerStyle={styles.featureGroupInner}>
            {FEATURE_META.map((meta, i) => (
              <ServiceRow
                key={meta.key}
                meta={meta}
                copy={strings.features[meta.key]}
                tint={getFeatureTint(meta.key, palette)}
                isLast={i === FEATURE_META.length - 1}
                palette={palette}
                bodyColor={bodyColor}
                reduced={reduced}
                delay={380 + i * 100}
                onPress={() => setActiveFeature(meta.key)}
              />
            ))}
          </ClaySurface>

          <EmergencyBanner palette={palette} strings={strings} reduced={reduced} delay={700} onPress={() => setShowEmergency(true)} />
        </View>
      </Animated.ScrollView>

      <FadeInUp reduced={reduced} delay={780} style={[styles.footer, { backgroundColor: palette.background, borderTopColor: palette.border, paddingBottom: insets.bottom + spacing.md }]}>
        <PrimaryButton title={strings.createAccount} onPress={goToRegister} size="lg" reduced={reduced} />
        <PrimaryButton title={strings.logIn} variant="tertiary" onPress={goToLogin} reduced={reduced} />
        <View style={styles.trustIndicator}>
          <ClaySurface radius={13} tint={palette.primaryLight} shadowTint={palette.primaryDark} intensity="sm" style={styles.trustIconShadow} innerStyle={styles.clayCircleInner} highlightOpacity={0.28}>
            <Ionicons name="lock-closed" size={12} color={palette.primary} />
          </ClaySurface>
          <View style={styles.trustIndicatorText}>
            <Text style={[styles.trustIndicatorTitle, { color: palette.text }]}>{strings.privacyTitle}</Text>
            <Text style={[styles.trustIndicatorBody, { color: palette.textMuted }]}>{strings.privacyBody}</Text>
          </View>
        </View>
      </FadeInUp>

      {activeFeatureMeta && activeFeatureCopy ? (
        <InfoSheet
          visible={!!activeFeature}
          onClose={() => setActiveFeature(null)}
          palette={palette}
          icon={activeFeatureMeta.icon}
          tint={getFeatureTint(activeFeatureMeta.key, palette)}
          title={activeFeatureCopy.title}
          body={activeFeatureCopy.detail}
        />
      ) : null}

      <EmergencySheet
        visible={showEmergency}
        onClose={() => setShowEmergency(false)}
        palette={palette}
        strings={strings}
        onCreateAccount={() => {
          setShowEmergency(false);
          goToRegister();
        }}
      />

      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} title={strings.settingsTitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  brand: { ...typography.display, fontSize: 44, color: colors.white, letterSpacing: 0.5 },
  tagline: { ...typography.caption, color: colors.white, opacity: 0.9, marginTop: spacing.sm, textAlign: 'center' },

  // ---- Header (Back / Skip / Settings) ----
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, minHeight: 56 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skipText: { ...typography.bodyMedium, paddingVertical: spacing.sm },
  // The outer (shadow-bearing) size for both header clay buttons — kept
  // as its own style so the "no back button on screen 1" placeholder can
  // reserve the exact same footprint and avoid a header height/alignment
  // jump between screens.
  clayCircle: { width: 44, height: 44 },
  clayCircleInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },

  // ---- Skip confirmation ----
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(32,32,32,0.42)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCardShadow: { width: '100%', maxWidth: 340 },
  confirmCardInner: { padding: spacing.lg },
  confirmTitle: { ...typography.heading, fontSize: 19, marginBottom: spacing.xs },
  confirmBody: { ...typography.body, marginBottom: spacing.lg },
  confirmActions: { flexDirection: 'row', gap: spacing.sm },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  confirmBtnGhostText: { ...typography.bodyMedium },
  confirmBtnPrimaryText: { ...typography.bodyMedium, color: colors.white },

  // ---- Feature / emergency info sheets (Welcome) ----
  infoSheetIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  emergencyNote: {
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  emergencyNoteText: { ...typography.caption, lineHeight: 17 },

  // ---- Settings sheet ----
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(32,32,32,0.42)', justifyContent: 'flex-end' },
  sheetCard: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.heading, fontSize: 18, marginBottom: spacing.sm },
  sheetSectionLabel: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: spacing.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  sheetRowLabel: { ...typography.bodyMedium },
  sheetRowDesc: { ...typography.caption, marginTop: 2 },
  sheetDivider: { height: 1, marginVertical: spacing.sm },
  sheetPrivacyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  segmented: { flexDirection: 'row', borderRadius: radius.button, padding: 4, gap: 4 },
  segmentedOption: { flex: 1, paddingVertical: 10, borderRadius: radius.button - 4, alignItems: 'center', justifyContent: 'center' },
  segmentedOptionText: { ...typography.bodyMedium, fontSize: 13 },

  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  visualColumn: { alignItems: 'center', marginBottom: spacing.lg },
  iconRing: {
    width: 156,
    height: 156,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The soft recessed "dish" the medallion sits in — the claymorphic cue
  // that the puffy medallion is resting on/rising out of the surface
  // rather than just floating in front of it.
  claySeat: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: radius.pill,
  },
  // Ambient colored shadow — a separate wrapper from iconCircle because
  // the circle itself needs overflow:hidden to clip the glass-gloss
  // gradient, and shadows don't render on a view that clips its own
  // overflow.
  medallionShadow: {
    borderRadius: radius.pill,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 108,
    height: 108,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pulseRing: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  dotTopLeft: { position: 'absolute', top: 10, left: 6 },
  dotBottomLeft: { position: 'absolute', bottom: 18, left: -2 },
  // Position only — the visual (fill/shadow/border) lives on
  // iconBadgeInner so Float can animate this wrapper's transform without
  // fighting the shadow-bearing view's own layout.
  iconBadge: { position: 'absolute', bottom: 4, right: 4 },
  iconBadgeInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 4,
  },
  timelineCard: { marginTop: spacing.lg, width: '100%' },
  timeline: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  timelineNode: { alignItems: 'center', width: 68 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timelineLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  timelineConnector: { height: 2, backgroundColor: colors.border, flex: 1, marginTop: 4 },
  slideTitle: { ...typography.heading, fontSize: 22, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  slideBody: { ...typography.body, color: colors.textMuted, textAlign: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: spacing.lg },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.primary, marginHorizontal: 4 },

  ctaRow: { paddingHorizontal: spacing.lg },

  welcomeHero: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroTopRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  heroSettingsButton: { width: 48, height: 48 },
  // Hero focal point is the real logo now (see WelcomeHeroLogo) — this
  // ring just centers the white logo circle and anchors the two minimal
  // floating dots. Sized to exactly match the circle below so nothing
  // clips or leaves stray extra space in the hero's flow.
  heroIllustrationRing: { width: 148, height: 148, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  // The white claymorphic backdrop behind the logo (see WelcomeHeroLogo)
  // — the single biggest fix for the mark blending into the purple hero.
  // Warm-white fill, a real clay shadow, and a soft inner gloss, same
  // material language as every other raised surface on this screen.
  logoCircleShadow: { width: 148, height: 148 },
  heroDotTopLeft: { position: 'absolute', top: 6, left: 12 },
  heroDotBottomLeft: { position: 'absolute', bottom: 8, left: 2 },
  heroDecoRingLarge: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroDecoRingSmall: {
    position: 'absolute',
    top: 40,
    right: 50,
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  // A third, smaller ring lower-left balances the composition without
  // adding a second visual "system" — same line-art language, just
  // another size/position so the hero doesn't read as one lonely motif
  // stuck in a corner.
  heroDecoRingTiny: {
    position: 'absolute',
    bottom: 18,
    left: -20,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  // A fourth, smallest ring for extra layering depth — deliberately
  // static (no float) so not every element drifts at once.
  heroDecoRingMicro: {
    position: 'absolute',
    top: 26,
    left: 26,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  welcomeBrand: { ...typography.display, fontSize: 28, color: colors.white, letterSpacing: 0.3, textAlign: 'center' },
  welcomeHeroText: { ...typography.body, color: 'rgba(255,255,255,0.92)', marginTop: 4, textAlign: 'center' },

  welcomeContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  welcomeHeadline: { ...typography.heading, marginBottom: spacing.xs },
  welcomeBody: { ...typography.body },

  sectionLabel: { ...typography.bodyMedium, marginBottom: spacing.sm },
  featureGroupInner: { paddingHorizontal: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  featureIconShadow: { width: 40, height: 40 },
  featureRowText: { flex: 1, marginLeft: spacing.sm, marginRight: spacing.sm },
  featureRowTitle: { ...typography.bodyMedium, marginBottom: 2 },
  featureRowDesc: { ...typography.caption, lineHeight: 17 },

  // Distinguishable without being alarming: a soft blush clay surface
  // with a darker pink accent strip along the leading edge — urgency
  // comes from fill/icon/text color, never from a colored ambient
  // shadow (that read as a glowing red outline, which is exactly what
  // this is deliberately avoiding). The shadow itself stays neutral,
  // via shadowTint={palette.primaryDark} at the call site, same as
  // every other card on this screen.
  safetyBannerShadow: { borderRadius: 20 },
  safetyBannerInner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, paddingLeft: spacing.md + 6 },
  safetyAccentStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  safetyIconShadow: { width: 36, height: 36 },
  safetyText: { flex: 1, marginLeft: spacing.sm, marginRight: spacing.sm },
  safetyTitle: { ...typography.bodyMedium, marginBottom: 2 },
  safetyBody: { ...typography.caption, lineHeight: 17 },

  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  trustIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  trustIconShadow: { width: 26, height: 26 },
  trustIndicatorText: { flex: 1, marginLeft: spacing.sm },
  trustIndicatorTitle: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, color: colors.text },
  trustIndicatorBody: { ...typography.caption, color: colors.textMuted, marginTop: 1, lineHeight: 16 },
});

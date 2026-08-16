import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Animated,
  Dimensions,
  ActivityIndicator,
  Pressable,
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
import { colors, spacing, typography, radius } from '../../theme/theme';
import { PrimaryButton, FeatureCard, IoniconName } from '../../components/ui';
import { LogoMark } from '../../components/branding/LogoMark';
import { AuthStackParamList } from '../../navigation/types';

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

export function SplashScreen() {
  return (
    <LinearGradient
      colors={[colors.primaryDark, colors.primary, colors.accent]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.splash}
    >
      <StatusBar style="light" />
      <View style={styles.splashBadgeWrap}>
        <DashedRing size={128} color="rgba(255,255,255,0.35)" />
        <View style={styles.splashBadge}>
          <LogoMark size={64} tone="onDark" />
        </View>
      </View>
      <Text style={styles.brand}>SafeHer</Text>
      <Text style={styles.tagline}>Safety • Trust • Protection • Compassion • Hope</Text>
      <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.white} />
    </LinearGradient>
  );
}

type Slide = {
  key: 'report' | 'sos' | 'track';
  icon: IoniconName;
  badgeIcon: IoniconName;
  title: string;
  body: string;
  tint: string;
};

const slides: Slide[] = [
  {
    key: 'report',
    icon: 'document-text',
    badgeIcon: 'lock-closed',
    title: 'Report Safely',
    body: 'Share incidents securely and confidentially with authorized personnel.',
    tint: colors.primary,
  },
  {
    key: 'sos',
    icon: 'alert-circle',
    badgeIcon: 'shield-checkmark',
    title: 'Emergency SOS',
    body: 'Get quick access to emergency assistance when you need it most.',
    // "danger" is used sparingly across this app (see theme.ts) — this is
    // the one onboarding slide it belongs on.
    tint: colors.danger,
  },
  {
    key: 'track',
    icon: 'clipboard',
    badgeIcon: 'trending-up',
    title: 'Track Your Case',
    body: 'Stay informed about your submitted reports and available support.',
    tint: colors.primaryDark,
  },
];

const TIMELINE_STEPS = ['Submitted', 'In Progress', 'Resolved'];

function SlideVisual({ item }: { item: Slide }) {
  return (
    <View style={styles.visualColumn}>
      <View style={styles.iconRing}>
        {item.key === 'sos' ? (
          <>
            <DashedRing size={168} color={item.tint} opacity={0.14} dash="1 7" />
            <DashedRing size={148} color={item.tint} opacity={0.28} dash="3 6" />
          </>
        ) : (
          <DashedRing size={148} color={item.tint} opacity={0.3} />
        )}
        <View style={[styles.iconCircle, { backgroundColor: item.tint }]}>
          <Ionicons name={item.icon} size={44} color={colors.white} />
        </View>
        <View style={styles.iconBadge}>
          <Ionicons name={item.badgeIcon} size={18} color={item.tint} />
        </View>
      </View>

      {item.key === 'track' ? (
        <View style={styles.timeline}>
          {TIMELINE_STEPS.map((step, i) => (
            <React.Fragment key={step}>
              <View style={styles.timelineNode}>
                <View style={[styles.timelineDot, i <= 1 ? { backgroundColor: item.tint } : null]} />
                <Text style={[styles.timelineLabel, i <= 1 ? { color: colors.text } : null]}>{step}</Text>
              </View>
              {i < TIMELINE_STEPS.length - 1 ? (
                <View style={[styles.timelineConnector, i === 0 ? { backgroundColor: item.tint } : null]} />
              ) : null}
            </React.Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function OnboardingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>>();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const goToWelcome = () => navigation.replace('Welcome');

  const goToIndex = (i: number) => {
    listRef.current?.scrollToOffset({ offset: i * width, animated: true });
    setIndex(i);
  };

  const next = () => {
    if (index < slides.length - 1) goToIndex(index + 1);
    else goToWelcome();
  };

  const back = () => {
    if (index > 0) goToIndex(index - 1);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.skipRow, { paddingTop: insets.top + spacing.sm }]}>
        {index < slides.length - 1 ? (
          <Pressable onPress={goToWelcome} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ height: 20 }} />
        )}
      </View>

      <Animated.FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item, index: i }) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const scale = scrollX.interpolate({ inputRange, outputRange: [0.75, 1, 0.75], extrapolate: 'clamp' });
          const opacity = scrollX.interpolate({ inputRange, outputRange: [0.4, 1, 0.4], extrapolate: 'clamp' });
          return (
            <View style={[styles.slide, { width }]}>
              <Animated.View style={{ transform: [{ scale }], opacity }}>
                <SlideVisual item={item} />
              </Animated.View>
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideBody}>{item.body}</Text>
            </View>
          );
        }}
      />

      <View style={styles.dots}>
        {slides.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const dotWidth = scrollX.interpolate({ inputRange, outputRange: [8, 24, 8], extrapolate: 'clamp' });
          const dotOpacity = scrollX.interpolate({ inputRange, outputRange: [0.3, 1, 0.3], extrapolate: 'clamp' });
          return <Animated.View key={i} style={[styles.dot, { width: dotWidth, opacity: dotOpacity }]} />;
        })}
      </View>

      <View style={[styles.ctaRow, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.ctaButtons}>
          {index > 0 ? (
            <Pressable onPress={back} hitSlop={12} style={styles.backButton}>
              <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
          <View style={{ flex: 1 }}>
            <PrimaryButton title={index === slides.length - 1 ? 'Get started' : 'Next'} onPress={next} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function WelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'Welcome'>>();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.primaryDark, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.welcomeHero, { paddingTop: insets.top + spacing.xl }]}
      >
        <View style={styles.heroDecoRingLarge} />
        <View style={styles.heroDecoRingSmall} />
        <View style={styles.welcomeBadge}>
          <LogoMark size={40} tone="onDark" />
        </View>
        <Text style={styles.welcomeBrand}>SafeHer</Text>
        <Text style={styles.welcomeHeroText}>
          A confidential platform for the support and protection of survivors of violence against women and
          children.
        </Text>
      </LinearGradient>

      <View style={[styles.welcomeContent, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View>
          <Text style={styles.welcomeHeadline}>Ready when you are</Text>
          <Text style={styles.welcomeBody}>
            Create a free confidential account, or log back in to pick up where you left off.
          </Text>

          <Text style={styles.trustHeading}>Your Safety Matters</Text>
          <View style={styles.trustRow}>
            <FeatureCard
              icon="lock-closed"
              title="Confidential"
              description="Your information is handled securely."
              tint={colors.primary}
            />
            <FeatureCard
              icon="alert-circle"
              title="Emergency Support"
              description="Quick access to available assistance."
              tint={colors.danger}
            />
            <FeatureCard
              icon="clipboard"
              title="Case Tracking"
              description="Monitor submitted requests securely."
              tint={colors.primaryDark}
            />
          </View>
        </View>

        <View>
          <PrimaryButton title="Create an account" onPress={() => navigation.navigate('Register')} />
          <PrimaryButton title="Log in" variant="outline" onPress={() => navigation.navigate('Login')} />
          <View style={styles.privacyRow}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
            <Text style={styles.privacyText}>Your information stays private and secure.</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  splashBadgeWrap: {
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  splashBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  brand: { ...typography.display, fontSize: 40, color: colors.white, letterSpacing: 0.5 },
  tagline: { ...typography.caption, color: colors.white, opacity: 0.9, marginTop: spacing.sm, textAlign: 'center' },

  skipRow: { alignItems: 'flex-end', paddingHorizontal: spacing.lg },
  skipText: { ...typography.bodyMedium, color: colors.textMuted },

  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  visualColumn: { alignItems: 'center', marginBottom: spacing.xl },
  iconRing: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 104,
    height: 104,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  timeline: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  timelineNode: { alignItems: 'center', width: 68 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  timelineLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  timelineConnector: { height: 2, backgroundColor: colors.border, flex: 1, marginTop: 4 },
  slideTitle: { ...typography.heading, fontSize: 22, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  slideBody: { ...typography.body, color: colors.textMuted, textAlign: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: spacing.lg },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.primary, marginHorizontal: 4 },

  ctaRow: { paddingHorizontal: spacing.lg },
  ctaButtons: { flexDirection: 'row', alignItems: 'center' },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingRight: spacing.md,
    marginTop: spacing.sm,
  },
  backButtonPlaceholder: { width: spacing.xs },
  backText: { ...typography.bodyMedium, color: colors.textMuted },

  welcomeHero: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: 'hidden',
  },
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
  welcomeBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  welcomeBrand: { ...typography.display, fontSize: 32, color: colors.white, letterSpacing: 0.3 },
  welcomeHeroText: { ...typography.body, color: 'rgba(255,255,255,0.9)', marginTop: spacing.sm, maxWidth: '92%' },

  welcomeContent: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    justifyContent: 'space-between',
  },
  welcomeHeadline: { ...typography.heading, color: colors.text, marginBottom: spacing.xs },
  welcomeBody: { ...typography.body, color: colors.textMuted },
  trustHeading: { ...typography.subheading, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  trustRow: { flexDirection: 'row', gap: spacing.sm },
  privacyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  privacyText: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.xs },
});

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientButton } from '../../components/auth/GradientButton';
import { TextButton } from '../../components/auth/TextButton';
import { DotsIndicator } from '../../components/auth/DotsIndicator';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { AuthStackParamList } from '../../navigation/types';

const HAS_ONBOARDED_KEY = '@safeher/has_onboarded';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = NativeStackScreenProps<AuthStackParamList, 'Onboarding'>;

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  title: string;
  description: string;
  ctaLabel: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'shield-checkmark-outline',
    badgeIcon: 'shield-checkmark-outline',
    badgeLabel: 'CONFIDENTIAL & SECURE',
    badgeColor: colors.primary,
    badgeBg: colors.softLavender,
    title: 'Report Safely',
    description: 'Submit confidential reports anytime and connect with trusted social welfare professionals.',
    ctaLabel: 'Continue',
  },
  {
    icon: 'alert-circle-outline',
    badgeIcon: 'notifications-outline',
    badgeLabel: 'ONE-TAP EMERGENCY',
    badgeColor: colors.error,
    badgeBg: colors.errorContainer,
    title: 'Emergency SOS',
    description: 'Instantly send your live location during emergencies for faster response.',
    ctaLabel: 'Continue',
  },
  {
    icon: 'list-outline',
    badgeIcon: 'time-outline',
    badgeLabel: 'REAL-TIME UPDATES',
    badgeColor: colors.tertiary,
    badgeBg: colors.softLavender,
    title: 'Track Your Case',
    description: 'Monitor your report and receive updates throughout every stage of the case process.',
    ctaLabel: 'Get Started',
  },
];

export function OnboardingScreen({ navigation }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(HAS_ONBOARDED_KEY, 'true');
    navigation.replace('Welcome');
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(index);
  };

  const goToSlide = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setActiveIndex(index);
  };

  const isLastSlide = activeIndex === SLIDES.length - 1;
  const activeSlide = SLIDES[activeIndex];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TextButton label="Skip" onPress={finishOnboarding} testID="onboarding-skip-top" />
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={styles.illustration}>
              <Ionicons name={slide.icon} size={72} color={colors.primary} />
            </View>

            <View style={[styles.badge, { backgroundColor: slide.badgeBg }]}>
              <Ionicons name={slide.badgeIcon} size={14} color={slide.badgeColor} />
              <Text style={[styles.badgeText, { color: slide.badgeColor }]}>{slide.badgeLabel}</Text>
            </View>

            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.description}>{slide.description}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <DotsIndicator count={SLIDES.length} activeIndex={activeIndex} />

        <GradientButton
          label={activeSlide.ctaLabel}
          icon={isLastSlide ? undefined : 'chevron-forward'}
          onPress={() => (isLastSlide ? finishOnboarding() : goToSlide(activeIndex + 1))}
          style={styles.cta}
          testID="onboarding-continue"
        />

        <TextButton label="Skip" onPress={finishOnboarding} style={styles.skipBottom} testID="onboarding-skip-bottom" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  topBar: { alignItems: 'flex-end', paddingHorizontal: spacing.marginMobile, paddingTop: 8 },
  pager: { flex: 1 },
  slide: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.marginMobile, paddingTop: 24 },
  illustration: {
    width: '100%',
    height: 220,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.stackLg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
    marginBottom: spacing.stackMd,
  },
  badgeText: { ...typography.labelSm, marginLeft: 6, letterSpacing: 0.4 },
  title: { ...typography.headlineLg, color: colors.primary, marginBottom: spacing.stackSm, textAlign: 'center' },
  description: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.marginMobile, paddingBottom: 16 },
  cta: { marginTop: spacing.stackLg },
  skipBottom: { alignSelf: 'center', marginTop: spacing.stackMd },
});

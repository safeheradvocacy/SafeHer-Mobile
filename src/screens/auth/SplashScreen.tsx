import React, { useEffect, useRef } from 'react';
import { View, Text, Image, ImageBackground, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, typography, spacing, radii } from '../../constants/theme';
import type { AuthStackParamList } from '../../navigation/types';

// Matches the key OnboardingScreen.tsx actually writes to on completion.
// (utils/storage.ts's ONBOARDING_COMPLETE_KEY is a different, unused key —
// nothing in this codebase currently sets it, so checking it here would
// always come back empty and send everyone through Onboarding forever.)
const HAS_ONBOARDED_KEY = '@safeher/has_onboarded';

// Shared constant so the progress-bar animation and the real wait below
// can't drift apart — the bar's fill time is a truthful readout of the
// check happening underneath it, not a decorative loop.
const SPLASH_DURATION_MS = 1500;

type Props = NativeStackScreenProps<AuthStackParamList, 'Splash'>;

export function SplashScreen({ navigation }: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: SPLASH_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating `width`, which the native driver can't touch
    }).start();

    const checkStatus = async () => {
      // Brief pause so the splash branding is actually visible.
      await new Promise((resolve) => setTimeout(resolve, SPLASH_DURATION_MS));

      const hasOnboarded = await AsyncStorage.getItem(HAS_ONBOARDED_KEY);
      navigation.replace(hasOnboarded ? 'Welcome' : 'Onboarding');
    };

    checkStatus();
  }, [navigation, progress]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <ImageBackground
      source={require('../../assets/images/splash-background.png')}
      style={styles.background}
      resizeMode="cover"
    >
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>PSWDO · Aurora Province</Text>

          <Image
            source={require('../../assets/images/safeher-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={styles.wordmark}>
            <Text style={styles.wordmarkSafe}>Safe</Text>
            <Text style={styles.wordmarkHer}>Her</Text>
          </Text>

          <Text style={styles.subtitle}>
            A secure reporting and support platform for survivors of violence
            against women and children.
          </Text>

          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: barWidth }]}>
              <LinearGradient
                colors={[colors.brandIndigo, colors.brandViolet, colors.brandPink]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
  },
  // A translucent "plaque" over the artwork — guarantees text contrast
  // regardless of what the background crops to on a given screen size,
  // and reads as an official card/letterhead rather than a floating logo.
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 252, 250, 0.72)',
    borderRadius: radii.lg,
    paddingVertical: spacing.sectionPadding,
    paddingHorizontal: spacing.stackLg,
  },
  eyebrow: {
    ...typography.labelSm,
    color: colors.brandIndigo,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: spacing.stackMd,
  },
  logo: {
    width: 132,
    height: 132,
    marginBottom: spacing.stackMd,
  },
  wordmark: {
    ...typography.displayLg,
    marginBottom: spacing.stackSm,
  },
  wordmarkSafe: {
    color: colors.brandIndigo,
  },
  wordmarkHer: {
    color: colors.brandPink,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.stackLg,
  },
  progressTrack: {
    width: 120,
    height: 3,
    borderRadius: radii.full,
    backgroundColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
});

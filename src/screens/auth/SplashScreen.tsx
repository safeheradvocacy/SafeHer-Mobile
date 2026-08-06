import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getItem, ONBOARDING_COMPLETE_KEY } from '../../utils/storage';
import { Colors, Typography, Spacing } from '../../utils/theme';

const SplashScreen = () => {
  const navigation = useNavigation();

  useEffect(() => {
    const checkStatus = async () => {
      // Brief pause so the splash branding is actually visible.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // RootNavigator only mounts AuthStack (and therefore this screen)
      // once it already knows there's no authenticated user, so the only
      // thing left to decide here is Onboarding vs. Welcome.
      const onboardingComplete = await getItem(ONBOARDING_COMPLETE_KEY);
      navigation.replace(onboardingComplete ? 'Welcome' : 'Onboarding');
    };

    checkStatus();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/safeher-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.title}>SafeHer</Text>
      <Text style={styles.subtitle}>Protection, Support, and Hope in Every Step.</Text>
      <View style={styles.loadingContainer}>
        <View style={styles.dot} />
        <View style={[styles.dot, styles.dotMiddle]} />
        <View style={[styles.dot, styles.dotEnd]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.marginMobile,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: Spacing.stackMD,
  },
  title: {
    ...Typography.displayLG,
    color: Colors.primary,
    marginBottom: Spacing.stackSM,
  },
  subtitle: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    marginTop: Spacing.stackLG,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginHorizontal: 4,
    opacity: 0.4,
  },
  dotMiddle: {
    opacity: 0.7,
  },
  dotEnd: {
    opacity: 1,
  },
});

export default SplashScreen;

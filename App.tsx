import 'react-native-gesture-handler';
import React, { useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreenModule from 'expo-splash-screen';
import {
  useFonts as usePlusJakartaSans,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts as useInter, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';

import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { AuthNavigator } from './src/navigation/AuthNavigator';
import type { AuthStackParamList } from './src/navigation/types';

SplashScreenModule.preventAutoHideAsync().catch(() => {
  /* no-op: splash screen module may already be hidden in dev */
});

// Handles safeher://reset-password?access_token=...&refresh_token=...
// coming from the Supabase "reset your password" email.
const linking: LinkingOptions<AuthStackParamList> = {
  prefixes: ['safeher://'],
  config: {
    screens: {
      Splash: 'splash',
      Onboarding: 'onboarding',
      Welcome: 'welcome',
      Login: 'login',
      CreateAccount: 'create-account',
      RegistrationSuccess: 'registration-success',
      ForgotPassword: 'forgot-password',
      ResetPassword: 'reset-password',
    },
  },
};

function RootNavigator() {
  // Module 1 only implements the Auth stack. Once Module 2 (authenticated
  // app shell) exists, branch here on `isAuthenticated` to render it
  // instead of AuthNavigator.
  const { isLoading } = useAuth();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: '#FBF9F8' }} />;
  }

  return <AuthNavigator />;
}

export default function App() {
  const [jakartaLoaded] = usePlusJakartaSans({ PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  const [interLoaded] = useInter({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });

  const fontsLoaded = jakartaLoaded && interLoaded;

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreenModule.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <AuthProvider>
        <NavigationContainer linking={linking}>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

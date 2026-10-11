import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { SplashScreen } from '../screens/auth/SplashOnboardingWelcome';
import { ResetPasswordScreen } from '../screens/auth/PasswordRecovery';
import { AppLockGate } from '../components/AppLockGate';
import { TourProvider } from '../contexts/TourContext';
import { TourOverlay } from '../components/TourOverlay';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { usePushNotifications } from '../lib/usePushNotifications';
import type { AuthStackParamList, AppStackParamList } from './types';

// Created once, module-level, so it can be shared between the
// NavigationContainer (which needs it as a `ref`) and the push
// notification hook (which needs it to navigate on a notification
// tap) without threading it through prop drilling.
const navigationRef = createNavigationContainerRef<AppStackParamList>();

const RecoveryStack = createNativeStackNavigator<AuthStackParamList>();

// Exchanging a password-recovery link's code establishes a real Supabase
// session, same as any other sign-in — so without this dedicated stack,
// RootNavigator's normal `session && profile` check would drop the user
// straight into the authenticated app with their OLD password still set,
// instead of showing Reset Password. Deliberately has no other screens
// registered: there's nowhere else useful to navigate from mid-recovery.
function RecoveryNavigator() {
  return (
    <RecoveryStack.Navigator screenOptions={{ headerShown: false }}>
      <RecoveryStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
    </RecoveryStack.Navigator>
  );
}

// Reads the shared theme so the OS status bar (clock/battery/signal icons)
// stays legible on every screen that doesn't set its own — without this,
// dark-mode screens would keep dark-content icons invisible against a
// dark background. Splash/Onboarding/Welcome still set their own
// StatusBar locally for their non-standard hero backgrounds; this is what
// every other screen (Login, Register, Home, Cases, SOS, ...) falls back to.
function AppStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

// ThemeProvider lives here — ABOVE both AuthNavigator and AppNavigator —
// so Welcome/Onboarding/Login/Register/Forgot Password and Home/Cases/
// SOS/Assistant/Shelters all read appearance/accessibility/language from
// the exact same instance. It used to be mounted inside AuthNavigator
// only, which meant the authenticated app never saw it at all.
export function RootNavigator() {
  const { session, loading, profile, pendingPasswordRecovery, pendingCaseAccessToken, clearCaseAccessToken } = useAuth();

  // Registers this device's push token (only once a real profile is
  // signed in) and wires notification taps to in-app navigation. A
  // no-op while pendingPasswordRecovery/AuthNavigator is showing,
  // since profile is only set once fully signed in.
  usePushNotifications(session && profile ? profile.profile_id : undefined, navigationRef);

  // Resumes a `safeher://case-access/<token>` deep link (module14) once
  // a navigator actually exists to receive it. 'CaseAccess' is
  // registered as a screen name in BOTH AuthNavigator (an informational
  // "sign in to continue" screen) and AppNavigator (the real
  // check-and-route screen) — the SAME imperative navigate call below
  // resolves to whichever one is currently mounted, exactly like
  // usePushNotifications' navRef already does for notification taps.
  // While unauthenticated the token is deliberately kept (so it survives
  // the login/registration flow and can resume afterward); only once
  // authenticated is it consumed here — never left to silently
  // re-trigger navigation on some later, unrelated sign-in.
  useEffect(() => {
    if (!pendingCaseAccessToken) return;
    const authenticated = !!(session && profile);
    // Same isReady()-guarded delay usePushNotifications uses for its own
    // cold-start case — NavigationContainer may not have finished
    // hydrating yet on the very first tick after mount/navigator swap.
    const timer = setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('CaseAccess', { token: pendingCaseAccessToken });
      }
    }, 300);
    if (authenticated) clearCaseAccessToken();
    return () => clearTimeout(timer);
  }, [pendingCaseAccessToken, session, profile, clearCaseAccessToken]);

  if (loading) {
    return <SplashScreen />;
  }

  return (
    <ThemeProvider>
      <AppStatusBar />
      <AppLockGate>
        <TourProvider>
          <NavigationContainer ref={navigationRef}>
            {pendingPasswordRecovery ? <RecoveryNavigator /> : session && profile ? <AppNavigator /> : <AuthNavigator />}
          </NavigationContainer>
          <TourOverlay />
        </TourProvider>
      </AppLockGate>
    </ThemeProvider>
  );
}

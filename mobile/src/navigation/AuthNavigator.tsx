import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStackParamList } from './types';
import { OnboardingScreen, WelcomeScreen, SplashScreen } from '../screens/auth/SplashOnboardingWelcome';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { EmailVerificationScreen } from '../screens/auth/EmailVerificationScreen';
import { ForgotPasswordScreen, RecoveryCodeScreen, ResetPasswordScreen } from '../screens/auth/PasswordRecovery';
import { AuthCaseAccessScreen } from '../screens/caseAccess/AuthCaseAccessScreen';
import { TermsAndConditionsScreen } from '../screens/legal/TermsAndConditionsScreen';
import { hasCompletedOnboarding } from '../lib/onboarding';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  // Onboarding's completion state lives in AsyncStorage (see
  // lib/onboarding.ts) and must survive logout/app updates, so it's
  // checked once here rather than the stack always starting on
  // Onboarding. Reuses the same Splash screen RootNavigator shows during
  // the auth-session check, so there's no visible seam between the two
  // async checks that gate the very first screen a user sees.
  const [initialRoute, setInitialRoute] = useState<keyof AuthStackParamList | null>(null);

  useEffect(() => {
    let mounted = true;
    hasCompletedOnboarding().then((done) => {
      if (mounted) setInitialRoute(done ? 'Welcome' : 'Onboarding');
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ThemeProvider now lives in RootNavigator (above both this and
  // AppNavigator) — see contexts/ThemeContext — so it isn't mounted here
  // anymore. Mounting a second instance here would give this whole stack
  // its own separate preferences state instead of sharing the one Home/
  // Cases/SOS/etc. read from.
  if (!initialRoute) return <SplashScreen />;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRoute}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="RecoveryCode" component={RecoveryCodeScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      <Stack.Screen name="CaseAccess" component={AuthCaseAccessScreen} />
      <Stack.Screen name="Terms" component={TermsAndConditionsScreen} />
    </Stack.Navigator>
  );
}

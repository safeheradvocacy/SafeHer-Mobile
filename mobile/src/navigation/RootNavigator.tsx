import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { SplashScreen } from '../screens/auth/SplashOnboardingWelcome';

export function RootNavigator() {
  const { session, loading, profile } = useAuth();

  if (loading) {
    return <SplashScreen />;
  }

  return <NavigationContainer>{session && profile ? <AppNavigator /> : <AuthNavigator />}</NavigationContainer>;
}

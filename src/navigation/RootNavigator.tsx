import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../hooks/useAuth';
import AuthStack from './AuthStack';
import AppStack from './AppStack';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import { Colors } from '../utils/theme';

const RecoveryStack = createStackNavigator();

const PasswordRecoveryNavigator = () => (
  <RecoveryStack.Navigator screenOptions={{ headerShown: false }}>
    <RecoveryStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
  </RecoveryStack.Navigator>
);

const RootNavigator = () => {
  const { user, isLoading, isPasswordRecovery } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // A recovery link signs the user in behind the scenes so updatePassword()
  // is allowed to work — route to the reset screen instead of the main app
  // even though `user` is technically set at this point.
  if (isPasswordRecovery) {
    return <PasswordRecoveryNavigator />;
  }

  return user ? <AppStack /> : <AuthStack />;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});

export default RootNavigator;

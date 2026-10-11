import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconContainer, PrimaryButton, Screen } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

/**
 * Shown when a `safeher://case-access/<token>` link/QR is opened while
 * signed out — the "not authenticated" branch of the QR access flow
 * (module14). Deliberately shows no case information whatsoever (there
 * is none to show yet — the token hasn't even been redeemed). The token
 * itself stays held in AuthContext's pendingCaseAccessToken and survives
 * the sign-in/registration flow; RootNavigator resumes to the real
 * check-and-route screen (CaseAccessScreen, in AppNavigator) the moment
 * a session exists.
 */
export function AuthCaseAccessScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const route = useRoute<RouteProp<AuthStackParamList, 'CaseAccess'>>();
  void route.params?.token; // held in AuthContext, not needed directly here

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.md }}>
        <IconContainer icon="qr-code" size={72} tint={palette.primary} />
        <Text style={[typography.heading, { color: palette.text, marginTop: spacing.lg, textAlign: 'center' }]}>
          Client Case Access
        </Text>
        <Text style={[typography.body, { color: palette.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
          Sign in or create your SafeSpace account to continue.
        </Text>
        <Text style={[typography.caption, { color: palette.textMuted, marginTop: spacing.md, textAlign: 'center' }]}>
          A SafeSpace account and identity verification are required before any case information can be accessed. Scanning
          this code alone does not grant access.
        </Text>

        <View style={{ width: '100%', marginTop: spacing.xl, gap: spacing.sm }}>
          <PrimaryButton title="Sign In" onPress={() => navigation.navigate('Login')} />
          <PrimaryButton title="Create Account" variant="outline" onPress={() => navigation.navigate('Register')} />
        </View>
      </View>
    </Screen>
  );
}

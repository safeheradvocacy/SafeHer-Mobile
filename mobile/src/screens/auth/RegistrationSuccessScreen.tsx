import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PrimaryButton, IconContainer } from '../../components/ui';
import { colors, spacing, typography } from '../../theme/theme';
import { AuthStackParamList } from '../../navigation/types';

export function RegistrationSuccessScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'RegistrationSuccess'>>();
  return (
    <View style={styles.screen}>
      <View style={styles.iconWrap}>
        <IconContainer icon="checkmark-circle" size={96} tint={colors.success} tone="solid" />
      </View>
      <Text style={styles.title}>Account created</Text>
      <Text style={styles.body}>
        Welcome to SafeHer. You can now log in and access reporting, case tracking, and emergency support.
      </Text>
      <View style={{ width: '100%', marginTop: spacing.xl }}>
        <PrimaryButton title="Log in now" onPress={() => navigation.replace('Login')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  iconWrap: {
    marginBottom: spacing.lg,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  title: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

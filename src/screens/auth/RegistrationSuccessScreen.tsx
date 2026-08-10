import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { GradientButton } from '../../components/auth/GradientButton';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'RegistrationSuccess'>;

export function RegistrationSuccessScreen({ navigation }: Props) {
  return (
    <ScreenContainer scroll={false}>
      <View style={styles.center}>
        <View style={styles.iconOuter}>
          <View style={styles.iconInner}>
            <Ionicons name="checkmark-done-outline" size={40} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Account Created Successfully!</Text>
        <Text style={styles.description}>
          Your SafeHer account has been created. You may now securely sign in.
        </Text>
      </View>

      <GradientButton
        label="Continue to Login"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
        style={styles.button}
        testID="registration-success-continue"
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconOuter: {
    width: 160,
    height: 160,
    borderRadius: radii.full,
    backgroundColor: colors.softLavender,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sectionPadding,
  },
  iconInner: {
    width: 88,
    height: 88,
    borderRadius: radii.full,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineLg,
    fontSize: 26,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.stackMd,
  },
  description: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.stackMd,
  },
  button: { marginBottom: spacing.stackLg },
});

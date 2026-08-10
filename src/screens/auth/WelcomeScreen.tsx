import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/auth/ScreenContainer';
import { GradientButton } from '../../components/auth/GradientButton';
import { TextButton } from '../../components/auth/TextButton';
import { SafeHerLogo } from '../../components/branding/SafeHerLogo';
import { colors, radii, shadows, spacing, typography } from '../../constants/theme';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <SafeHerLogo size={88} />
        <Text style={styles.subtitle}>Protection, Support, and Hope in Every Step.</Text>
      </View>

      <View style={styles.partnerSection}>
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>IN PARTNERSHIP WITH</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.partnerRow}>
          <PartnerCard icon="business-outline" name="PSWDO" description="Provincial Social Welfare and Development Office" />
          <PartnerCard icon="shield-checkmark-outline" name="MSWDO" description="Municipal Social Welfare and Development Office" />
        </View>
      </View>

      <View style={styles.actions}>
        <GradientButton
          label="Get Started"
          icon="arrow-forward"
          onPress={() => navigation.navigate('CreateAccount')}
          testID="welcome-get-started"
        />
        <View style={styles.signInRow}>
          <Text style={styles.signInText}>Already have an account? </Text>
          <TextButton label="Sign In" onPress={() => navigation.navigate('Login')} testID="welcome-sign-in" />
        </View>
      </View>
    </ScreenContainer>
  );
}

function PartnerCard({
  icon,
  name,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  name: string;
  description: string;
}) {
  return (
    <View style={[styles.partnerCard, shadows.card]}>
      <View style={styles.partnerIconWrap}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.partnerName}>{name}</Text>
      <Text style={styles.partnerDescription}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.stackLg },
  subtitle: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.stackMd,
    paddingHorizontal: spacing.stackLg,
  },
  partnerSection: { marginTop: spacing.sectionPadding },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.stackLg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.outlineVariant },
  dividerLabel: { ...typography.labelSm, color: colors.outline, marginHorizontal: 12, letterSpacing: 1 },
  partnerRow: { flexDirection: 'row', gap: spacing.gutterMd },
  partnerCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.gutterMd,
    alignItems: 'center',
  },
  partnerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.softLavender,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.stackSm,
  },
  partnerName: { ...typography.labelLg, fontSize: 16, color: colors.onSurface, marginBottom: 4 },
  partnerDescription: { ...typography.bodySm, fontSize: 12, color: colors.onSurfaceVariant, textAlign: 'center' },
  actions: { marginTop: 'auto', paddingBottom: spacing.stackLg },
  signInRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.stackMd },
  signInText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});

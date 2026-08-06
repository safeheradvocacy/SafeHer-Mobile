import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Button from '../../components/common/Button';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';

const WelcomeScreen = () => {
  const navigation = useNavigation();

  const onGetStarted = () => {
    navigation.navigate('Register');
  };

  const onSignIn = () => {
    navigation.navigate('Login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/safeher-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>SafeHer</Text>
        <Text style={styles.subtitle}>Protection, Support, and Hope in Every Step.</Text>
      </View>

      <View style={styles.illustrationContainer}>
        <Image
          source={require('../../assets/images/welcome-illustration.png')}
          style={styles.illustration}
          resizeMode="contain"
        />
      </View>

      <View style={styles.partnersContainer}>
        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.partnersLabel}>In Partnership With</Text>
          <View style={styles.line} />
        </View>
        <View style={styles.partnerCards}>
          <View style={styles.partnerCard}>
            <Icon name="account-balance" size={32} color={Colors.primary} />
            <Text style={styles.partnerName}>PSWDO</Text>
            <Text style={styles.partnerDesc}>Provincial Social Welfare and Development Office</Text>
          </View>
          <View style={styles.partnerCard}>
            <Icon name="assured-workload" size={32} color={Colors.primary} />
            <Text style={styles.partnerName}>MSWDO</Text>
            <Text style={styles.partnerDesc}>Municipal Social Welfare and Development Office</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Button title="Get Started" onPress={onGetStarted} />
        <TouchableOpacity onPress={onSignIn} style={styles.signInLink}>
          <Text style={styles.signInText}>
            Already have an account? <Text style={styles.signInHighlight}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.marginMobile,
    paddingTop: Spacing.sectionPadding,
    paddingBottom: Spacing.sectionPadding,
  },
  header: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  title: {
    ...Typography.headlineLG_mobile,
    color: Colors.primary,
    marginTop: 4,
  },
  subtitle: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
  illustrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  illustration: {
    width: '100%',
    height: 200,
  },
  partnersContainer: {
    marginVertical: Spacing.stackLG,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.stackMD,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.outlineVariant,
  },
  partnersLabel: {
    ...Typography.labelSM,
    color: Colors.outline,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
  },
  partnerCards: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  partnerCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  partnerName: {
    ...Typography.labelLG,
    color: Colors.onSurface,
    marginTop: 8,
  },
  partnerDesc: {
    ...Typography.labelSM,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    fontSize: 10,
    marginTop: 4,
  },
  actions: {
    marginTop: Spacing.stackMD,
  },
  signInLink: {
    marginTop: Spacing.stackMD,
    alignItems: 'center',
  },
  signInText: {
    ...Typography.bodySM,
    color: Colors.onSurfaceVariant,
  },
  signInHighlight: {
    color: Colors.primary,
    fontWeight: '600',
  },
});

export default WelcomeScreen;

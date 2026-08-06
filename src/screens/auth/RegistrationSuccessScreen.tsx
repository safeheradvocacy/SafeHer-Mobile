import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Button from '../../components/common/Button';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';

const RegistrationSuccessScreen = () => {
  const navigation = useNavigation();

  const handleContinue = () => {
    navigation.navigate('Login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.illustrationContainer}>
        <View style={styles.iconContainer}>
          <Icon name="check-circle" size={80} color={Colors.primary} />
        </View>
      </View>

      <Text style={styles.title}>Account Created Successfully!</Text>
      <Text style={styles.subtitle}>
        Your SafeHer account has been created. You may now securely sign in.
      </Text>

      <Button title="Continue to Login" onPress={handleContinue} style={styles.button} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.marginMobile,
    paddingVertical: Spacing.sectionPadding,
    justifyContent: 'center',
    alignItems: 'center',
  },
  illustrationContainer: {
    marginBottom: Spacing.stackLG,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primaryFixed,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    ...Typography.headlineLG_mobile,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: Spacing.stackLG,
  },
  button: {
    width: '100%',
  },
});

export default RegistrationSuccessScreen;

import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { validateEmail } from '../../utils/validation';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';

const ForgotPasswordScreen = () => {
  const navigation = useNavigation();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email is required');
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(trimmedEmail);
      Alert.alert(
        'Reset Link Sent',
        'Check your email for instructions to reset your password.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-back" size={24} color={Colors.primary} />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.illustrationContainer}>
          <View style={styles.iconCircle}>
            <Icon name="lock" size={64} color={Colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.subtitle}>
          Enter your registered email address and we'll send you password reset instructions.
        </Text>

        <View style={styles.form}>
          <Input
            icon="mail"
            placeholder="Email Address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            error={error}
          />
          <Button title="Send Reset Link" onPress={handleSubmit} loading={loading} />
        </View>

        <View style={styles.footer}>
          <Icon name="lock" size={16} color={Colors.outline} />
          <Text style={styles.footerText}>
            Your information is protected under the Data Privacy Act of 2012.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  backButton: {
    padding: 16,
    marginTop: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.marginMobile,
    paddingBottom: Spacing.sectionPadding,
  },
  illustrationContainer: {
    alignItems: 'center',
    marginVertical: Spacing.stackLG,
  },
  iconCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
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
  form: {
    gap: Spacing.stackMD,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
    paddingTop: Spacing.stackLG,
  },
  footerText: {
    ...Typography.labelSM,
    color: Colors.outline,
    textAlign: 'center',
  },
});

export default ForgotPasswordScreen;

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import { useAuth } from '../../hooks/useAuth';
import { setItem, getItem, REMEMBER_ME_KEY, USER_EMAIL_KEY } from '../../utils/storage';
import { validateEmail } from '../../utils/validation';
import { Colors, Typography, Spacing } from '../../utils/theme';
import { MaterialIcons as Icon } from '@expo/vector-icons';

const LoginScreen = () => {
  const navigation = useNavigation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  useEffect(() => {
    // Load saved email if remember me
    const loadSaved = async () => {
      const savedEmail = await getItem(USER_EMAIL_KEY);
      const remember = await getItem(REMEMBER_ME_KEY);
      if (remember) {
        setEmail(savedEmail || '');
        setRememberMe(true);
      }
    };
    loadSaved();
  }, []);

  const validate = () => {
    let valid = true;
    const newErrors = { email: '', password: '' };
    if (!email) {
      newErrors.email = 'Email is required';
      valid = false;
    } else if (!validateEmail(email.trim())) {
      newErrors.email = 'Please enter a valid email';
      valid = false;
    }
    if (!password) {
      newErrors.password = 'Password is required';
      valid = false;
    }
    setErrors(newErrors);
    return valid;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    const trimmedEmail = email.trim();
    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
      // Save remember me
      if (rememberMe) {
        await setItem(REMEMBER_ME_KEY, true);
        await setItem(USER_EMAIL_KEY, trimmedEmail);
      } else {
        await setItem(REMEMBER_ME_KEY, false);
        await setItem(USER_EMAIL_KEY, '');
      }
      // RootNavigator will switch to AppStack
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const navigateToForgot = () => navigation.navigate('ForgotPassword');
  const navigateToRegister = () => navigation.navigate('Register');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-back" size={24} color={Colors.primary} />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in securely to continue.</Text>

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
            error={errors.email}
          />
          <Input
            icon="lock"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            error={errors.password}
          />

          <View style={styles.optionsRow}>
            <View style={styles.rememberMe}>
              <Checkbox checked={rememberMe} onToggle={() => setRememberMe(!rememberMe)} />
              <Text style={styles.rememberMeText}>Remember Me</Text>
            </View>
            <TouchableOpacity onPress={navigateToForgot}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <Button title="Login" onPress={handleLogin} loading={loading} />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Button
            title="Create Account"
            onPress={navigateToRegister}
            variant="outline"
          />
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
  title: {
    ...Typography.headlineLG_mobile,
    color: Colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    ...Typography.bodyMD,
    color: Colors.onSurfaceVariant,
    marginBottom: Spacing.stackLG,
  },
  form: {
    gap: Spacing.stackMD,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.stackSM,
  },
  rememberMe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rememberMeText: {
    ...Typography.bodySM,
    color: Colors.onSurfaceVariant,
  },
  forgotText: {
    ...Typography.labelSM,
    color: Colors.primary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.stackMD,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.outlineVariant,
  },
  dividerText: {
    ...Typography.labelSM,
    color: Colors.outlineVariant,
    paddingHorizontal: 16,
    textTransform: 'uppercase',
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

export default LoginScreen;

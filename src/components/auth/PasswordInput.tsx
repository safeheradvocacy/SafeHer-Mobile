import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/theme';
import { AuthTextInput } from './AuthTextInput';

interface PasswordInputProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  testID?: string;
}

export function PasswordInput({ placeholder, value, onChangeText, error, testID }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <AuthTextInput
      icon="lock-closed-outline"
      placeholder={placeholder}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={!isVisible}
      autoCapitalize="none"
      autoCorrect={false}
      error={error}
      testID={testID}
      rightElement={
        <Pressable onPress={() => setIsVisible((prev) => !prev)} hitSlop={8} accessibilityRole="button">
          <Ionicons name={isVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.outline} />
        </Pressable>
      }
    />
  );
}

import React from 'react';
import { Pressable, StyleSheet, Text, TextStyle } from 'react-native';
import { colors, typography } from '../../constants/theme';

interface TextButtonProps {
  label: string;
  onPress: () => void;
  style?: TextStyle;
  color?: string;
  testID?: string;
}

export function TextButton({ label, onPress, style, color = colors.primary, testID }: TextButtonProps) {
  return (
    <Pressable onPress={onPress} testID={testID} hitSlop={8} accessibilityRole="button">
      <Text style={[styles.label, { color }, style]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.labelLg,
    fontSize: 15,
  },
});

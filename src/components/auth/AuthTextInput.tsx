import React, { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, typography } from '../../constants/theme';

interface AuthTextInputProps extends TextInputProps {
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
  rightElement?: React.ReactNode;
}

export const AuthTextInput = forwardRef<TextInput, AuthTextInputProps>(
  ({ icon, error, rightElement, onFocus, onBlur, style, ...rest }, ref) => {
    const [isFocused, setIsFocused] = useState(false);

    return (
      <View style={styles.wrapper}>
        <View
          style={[
            styles.container,
            isFocused ? styles.containerFocused : null,
            error ? styles.containerError : null,
          ]}
        >
          <Ionicons
            name={icon}
            size={20}
            color={error ? colors.error : isFocused ? colors.primary : colors.outline}
            style={styles.icon}
          />
          <TextInput
            ref={ref}
            style={[styles.input, style]}
            placeholderTextColor={colors.outline}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            {...rest}
          />
          {rightElement}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }
);

AuthTextInput.displayName = 'AuthTextInput';

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
  },
  containerFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  containerError: {
    borderColor: colors.error,
  },
  icon: { marginRight: 10 },
  input: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  errorText: {
    ...typography.bodySm,
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
});

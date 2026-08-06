import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import { Colors, Typography, BorderRadius } from '../../utils/theme';

interface InputProps extends TextInputProps {
  icon?: string;
  onIconPress?: () => void;
  containerStyle?: ViewStyle;
  error?: string;
}

const Input: React.FC<InputProps> = ({
  icon,
  onIconPress,
  containerStyle,
  error,
  secureTextEntry,
  ...rest
}) => {
  const [isSecure, setIsSecure] = useState(!!secureTextEntry);
  const [isFocused, setIsFocused] = useState(false);

  const toggleSecure = () => {
    setIsSecure(!isSecure);
  };

  const renderRightIcon = () => {
    if (secureTextEntry) {
      return (
        <TouchableOpacity onPress={toggleSecure} style={styles.rightIcon}>
          <Icon
            name={isSecure ? 'visibility' : 'visibility-off'}
            size={24}
            color={Colors.outline}
          />
        </TouchableOpacity>
      );
    }
    if (onIconPress && icon) {
      return (
        <TouchableOpacity onPress={onIconPress} style={styles.rightIcon}>
          <Icon name={icon as any} size={24} color={Colors.outline} />
        </TouchableOpacity>
      );
    }
    return null;
  };

  const borderColor = error
    ? Colors.error
    : isFocused
    ? Colors.primary
    : Colors.outlineVariant;

  return (
    <View style={[styles.container, containerStyle]}>
      <View
        style={[
          styles.inputWrapper,
          {
            borderColor,
            backgroundColor: Colors.surfaceContainerLowest,
          },
        ]}
      >
        {icon && (
          <View style={styles.leftIcon}>
            <Icon name={icon as any} size={24} color={Colors.outline} />
          </View>
        )}
        <TextInput
          style={[
            styles.input,
            icon ? { paddingLeft: 48 } : { paddingLeft: 16 },
            secureTextEntry ? { paddingRight: 48 } : { paddingRight: 16 },
          ]}
          placeholderTextColor={Colors.outline}
          secureTextEntry={isSecure}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...rest}
        />
        {renderRightIcon()}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    height: 56,
    position: 'relative',
  },
  input: {
    flex: 1,
    height: '100%',
    ...Typography.bodyMD,
    color: Colors.onSurface,
  },
  leftIcon: {
    position: 'absolute',
    left: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightIcon: {
    position: 'absolute',
    right: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...Typography.labelSM,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
});

export default Input;

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography } from '../../utils/theme';
import { getPasswordStrength } from '../../utils/validation';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({ password }) => {
  const strength = getPasswordStrength(password);
  const percentage = (strength / 4) * 100;
  const getColor = () => {
    if (strength <= 1) return Colors.error;
    if (strength === 2) return Colors.secondary;
    if (strength >= 3) return '#10b981';
    return Colors.outline;
  };
  const getLabel = () => {
    if (strength <= 1) return 'Weak';
    if (strength === 2) return 'Medium';
    if (strength >= 3) return 'Strong';
    return '';
  };

  if (password.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.barBackground}>
        <View
          style={[
            styles.barFill,
            {
              width: `${percentage}%`,
              backgroundColor: getColor(),
            },
          ]}
        />
      </View>
      <Text style={[styles.label, { color: getColor() }]}>{getLabel()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    paddingHorizontal: 4,
  },
  barBackground: {
    height: 6,
    backgroundColor: Colors.outlineVariant,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  label: {
    ...Typography.labelSM,
    marginTop: 4,
    textAlign: 'right',
  },
});

export default PasswordStrengthIndicator;

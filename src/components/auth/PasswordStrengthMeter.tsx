import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../constants/theme';
import { getPasswordStrength } from '../../utils/validation';

const SEGMENT_COLORS = {
  error: colors.error,
  warning: '#E08A00',
  success: colors.success,
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;

  const { score, label, color } = getPasswordStrength(password);
  const filledColor = SEGMENT_COLORS[color];

  return (
    <View style={styles.wrapper}>
      <View style={styles.track}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[
              styles.segment,
              { backgroundColor: index < score ? filledColor : colors.surfaceContainerHigh },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: filledColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  track: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  label: { ...typography.labelSm, marginLeft: 10, minWidth: 44, textAlign: 'right' },
});

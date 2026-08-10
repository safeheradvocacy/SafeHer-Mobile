import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, typography } from '../../constants/theme';

interface CheckboxRowProps {
  checked: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
  error?: string;
  testID?: string;
}

export function CheckboxRow({ checked, onToggle, children, error, testID }: CheckboxRowProps) {
  return (
    <View>
      <Pressable
        style={styles.row}
        onPress={() => onToggle(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        testID={testID}
      >
        <View style={[styles.box, checked ? styles.boxChecked : null, error ? styles.boxError : null]}>
          {checked ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
        </View>
        <Text style={styles.label}>{children}</Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  boxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  boxError: { borderColor: colors.error },
  label: { flex: 1, ...typography.bodySm, fontSize: 14, color: colors.onSurfaceVariant, lineHeight: 20 },
  errorText: { ...typography.bodySm, fontSize: 12, color: colors.error, marginTop: 4, marginLeft: 30 },
});

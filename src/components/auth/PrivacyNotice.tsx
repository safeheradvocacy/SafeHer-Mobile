import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../../constants/theme';

export function PrivacyNotice() {
  return (
    <View style={styles.row}>
      <Ionicons name="lock-closed-outline" size={14} color={colors.outline} style={styles.icon} />
      <Text style={styles.text}>
        Your information is protected under the Data Privacy Act of 2012.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 32 },
  icon: { marginRight: 6, marginTop: 3 },
  text: { ...typography.bodySm, fontSize: 12, color: colors.outline, textAlign: 'center', flexShrink: 1 },
});

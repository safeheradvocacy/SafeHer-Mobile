import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { IoniconName } from '../ui';
import { spacing, radius, typography } from '../../theme/theme';

/**
 * A single selectable row — leading icon (optional), title, short
 * description (optional), and a radio indicator. Originally written
 * inline for ReportIncidentScreen's urgency/location choices; promoted
 * here so RequestShelterScreen's own urgency selector (same visual job:
 * one choice from a small, named set, with guidance text) reuses the
 * exact same component instead of a second hand-rolled copy.
 */
export function RadioOptionRow({
  icon,
  title,
  description,
  selected,
  onPress,
  trailing,
}: {
  icon?: IoniconName;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primaryLight : palette.surface }]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={description ? `${title}. ${description}` : title}
    >
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? palette.primary : palette.textMuted} />
      {icon ? (
        <View style={[styles.icon, { backgroundColor: selected ? palette.primary + '1F' : palette.surfaceMuted }]}>
          <Ionicons name={icon} size={16} color={selected ? palette.primary : palette.textMuted} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
        {description ? <Text style={[styles.description, { color: palette.textMuted }]}>{description}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm },
  icon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.bodyMedium },
  description: { ...typography.caption, marginTop: 2 },
});

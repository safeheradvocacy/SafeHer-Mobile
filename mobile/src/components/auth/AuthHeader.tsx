import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing } from '../../theme/theme';

/**
 * Shared header chrome for the standalone auth screens (Login, Register,
 * Forgot password, Terms) — a small back button top-left and an optional
 * settings button top-right. Either side can be omitted (e.g. no back
 * button on the first step of a flow) while keeping the row's
 * height/alignment stable. Plain bordered circles, no shadow — was a
 * claymorphic (tinted, shadowed) treatment, simplified for the
 * government-friendly minimalism pass ("subtle borders and restrained
 * shadows", not floating decorative controls). Settings stays available
 * here specifically because it's the only pre-login route to language,
 * larger text, high contrast, and reduce-motion — needed by some users
 * before they can comfortably read the form at all, so it isn't optional
 * chrome the way it was on the Welcome screen (which dropped its own
 * settings button since Login/Register already carry one). Reads its
 * colors from ThemeContext, so it stays in sync with whatever appearance
 * the user picked from any screen's Settings sheet.
 */
export function AuthHeader({ onBack, onSettings }: { onBack?: () => void; onSettings?: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={styles.row}>
      {onBack ? (
        <PressableScale onPress={onBack} pressScale={0.94} hitSlop={6} accessibilityLabel="Back" accessibilityHint="Returns to the previous screen">
          <View style={[styles.button, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Ionicons name="arrow-back" size={18} color={palette.primary} />
          </View>
        </PressableScale>
      ) : (
        <View style={styles.button} />
      )}
      <View style={{ flex: 1 }} />
      {onSettings ? (
        <PressableScale
          onPress={onSettings}
          pressScale={0.94}
          hitSlop={6}
          accessibilityLabel="Settings"
          accessibilityHint="Opens appearance, accessibility, notifications, and privacy and security options"
        >
          <View style={[styles.button, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Ionicons name="settings-outline" size={18} color={palette.primary} />
          </View>
        </PressableScale>
      ) : (
        <View style={styles.button} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

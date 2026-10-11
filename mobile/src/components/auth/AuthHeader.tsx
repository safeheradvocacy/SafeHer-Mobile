import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ClaySurface } from '../../theme/clay';
import { PressableScale } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing } from '../../theme/theme';

/**
 * Shared header chrome for the standalone auth screens (Login, Register,
 * Forgot password) — a small claymorphic back button top-left and an
 * optional settings button top-right, matching the same material language
 * as the Welcome/Onboarding header controls instead of each screen
 * inventing its own back-button placement (previously bottom-of-screen
 * text links). Either side can be omitted (e.g. no back button on the
 * first step of a flow) while keeping the row's height/alignment stable.
 * Reads its colors from ThemeContext, so it stays in sync with whatever
 * appearance the user picked from any screen's Settings sheet.
 */
export function AuthHeader({ onBack, onSettings }: { onBack?: () => void; onSettings?: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={styles.row}>
      {onBack ? (
        <PressableScale
          onPress={onBack}
          pressScale={0.94}
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
        >
          <ClaySurface
            radius={22}
            tint={palette.surface}
            shadowTint={palette.primaryDark}
            intensity="sm"
            style={styles.button}
            innerStyle={styles.buttonInner}
            highlightOpacity={0.32}
          >
            <Ionicons name="arrow-back" size={18} color={palette.primary} />
          </ClaySurface>
        </PressableScale>
      ) : (
        <View style={styles.button} />
      )}
      <View style={{ flex: 1 }} />
      {onSettings ? (
        <PressableScale
          onPress={onSettings}
          pressScale={0.94}
          accessibilityLabel="Settings"
          accessibilityHint="Opens appearance, accessibility, notifications, and privacy and security options"
        >
          <ClaySurface
            radius={22}
            tint={palette.surface}
            shadowTint={palette.primaryDark}
            intensity="sm"
            style={styles.button}
            innerStyle={styles.buttonInner}
            highlightOpacity={0.32}
          >
            <Ionicons name="settings-outline" size={18} color={palette.primary} />
          </ClaySurface>
        </PressableScale>
      ) : (
        <View style={styles.button} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  button: { width: 44, height: 44 },
  buttonInner: { alignItems: 'center', justifyContent: 'center', flex: 1 },
});

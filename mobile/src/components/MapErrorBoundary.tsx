import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { typography } from '../theme/theme';

type Palette = ReturnType<typeof useTheme>['palette'];

/**
 * A map is always an enhancement, never a dependency — if the native Maps
 * view throws for any reason (missing/misconfigured platform config,
 * etc.), this keeps that failure contained to the map area only, so
 * whatever the map was accompanying (a shelter list, an active SOS alert)
 * stays fully usable. A plain try/catch can't catch render errors from a
 * child component in React, hence the class-based error boundary.
 */
export class MapErrorBoundary extends React.Component<
  { palette: Palette; fallbackMessage: string; style?: object; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <View style={[styles.fallback, { backgroundColor: this.props.palette.surfaceMuted }, this.props.style]}>
          <Text style={{ color: this.props.palette.textMuted, ...typography.caption }}>{this.props.fallbackMessage}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});

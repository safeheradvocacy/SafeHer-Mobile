import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import RAnimated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from './theme';

export type AppearancePreference = 'system' | 'light' | 'dark';

// ---------------------------------------------------------------------
// Claymorphism, applied selectively (per the brief: minimal background +
// tactile controls + dimensional hero illustration + clean typography —
// NOT every element turned into a clay object). Two surface types:
//
//  - "raised": a soft ambient outer shadow + a translucent white gradient
//    across the top-left for a gentle glass-like highlight. Used for
//    controls meant to look physically pressable (header buttons, the
//    primary CTA, the active pagination pill, the hero medallion).
//  - "recessed": a flat, slightly muted fill with no shadow at all — RN
//    has no native inset/inner shadow, so recession is communicated by
//    the ABSENCE of a raised shadow against neighboring raised surfaces,
//    not a fake inner shadow that would render inconsistently across
//    platforms. Used for inactive pagination dots.
// ---------------------------------------------------------------------

export function clayShadow(tintColor: string = '#0B3A82', intensity: 'sm' | 'md' | 'lg' = 'md') {
  // Trimmed from the prior presets for a flatter, more institutional
  // feel ("refined, not heavily 3D") — same three tiers, same call
  // sites across every screen, just a lighter touch.
  const presets = {
    sm: { offset: 3, opacity: 0.09, radius: 7, elevation: 2 },
    md: { offset: 6, opacity: 0.12, radius: 12, elevation: 4 },
    lg: { offset: 9, opacity: 0.15, radius: 18, elevation: 7 },
  } as const;
  const p = presets[intensity];
  return {
    shadowColor: tintColor,
    shadowOffset: { width: 0, height: p.offset },
    shadowOpacity: p.opacity,
    shadowRadius: p.radius,
    elevation: p.elevation,
  };
}

/**
 * A raised claymorphic surface: outer shadow (on a wrapper, since a
 * shadow won't render on a view that also clips its own overflow) +
 * rounded fill + a soft top-left gloss highlight. `intensity` controls
 * how strongly it reads as "raised" — reserve "lg" for the hero
 * illustration, "md" for buttons/CTA, "sm" for small chips.
 */
export function ClaySurface({
  children,
  style,
  innerStyle,
  radius = 20,
  tint = colors.surface,
  shadowTint = colors.primaryDark,
  intensity = 'md',
  highlightOpacity = 0.2,
  animatedStyle,
}: {
  children?: React.ReactNode;
  style?: object;
  innerStyle?: object;
  radius?: number;
  tint?: string;
  shadowTint?: string;
  intensity?: 'sm' | 'md' | 'lg';
  highlightOpacity?: number;
  /** Optional reanimated animated style merged onto the outer
   * shadow-bearing wrapper — lets callers animate shadowOpacity/scale for
   * a tactile press response without reimplementing this component's
   * shadow/gloss structure. The wrapper is a reanimated View regardless
   * (harmless when this is omitted), so this is a drop-in addition. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  animatedStyle?: any;
}) {
  return (
    <RAnimated.View style={[{ borderRadius: radius }, clayShadow(shadowTint, intensity), style, animatedStyle]}>
      <View style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: tint }, innerStyle]}>
        <LinearGradient
          colors={[`rgba(255,255,255,${highlightOpacity})`, 'rgba(255,255,255,0)']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.65, y: 0.85 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    </RAnimated.View>
  );
}

// ---------------------------------------------------------------------
// Dark palette — deep navy, not an inverted light theme. Built the same
// way the prior violet dark palette was: `primary`/`primaryDark` swap
// relative lightness (primaryDark becomes the LIGHTER of the two, since
// it's used where light mode needs a darker tint but dark mode needs a
// brighter one to read against the near-black background) — same
// construction logic, just the blue identity instead of violet.
// Applied app-wide via ThemeContext/ThemeProvider (mounted once in
// RootNavigator, above both the pre-auth and authenticated navigators).
// ---------------------------------------------------------------------
export interface ClayPalette {
  background: string;
  surface: string;
  surfaceMuted: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  accent: string;
  pinkAccent: string;
  text: string;
  textMuted: string;
  border: string;
  danger: string;
  dangerDark: string;
  warning: string;
  success: string;
  info: string;
  white: string;
}

export const darkColors: ClayPalette = {
  background: '#0E1B2E',
  surface: '#16253D',
  surfaceMuted: '#1C3350',
  primary: '#6FA8E0',
  primaryDark: '#A8CCEF',
  primaryLight: '#1E3A5C',
  accent: '#58A6E0',
  pinkAccent: '#E08AB8', // same hex as the admin web app's dark-mode --color-accent-pink
  text: '#EAF1FA',
  textMuted: '#9FB4C9',
  border: '#2A4060',
  danger: '#E8798D',
  dangerDark: '#F2A5B3',
  warning: '#E0A85C',
  success: '#6FBF9C',
  info: '#7BA8D6',
  white: '#FFFFFF',
};

export const lightColors: ClayPalette = {
  background: colors.background,
  surface: colors.surface,
  surfaceMuted: colors.surfaceMuted,
  primary: colors.primary,
  primaryDark: colors.primaryDark,
  primaryLight: colors.primaryLight,
  accent: colors.accent,
  pinkAccent: colors.pinkAccent,
  text: colors.text,
  textMuted: colors.textMuted,
  border: colors.border,
  danger: colors.danger,
  dangerDark: colors.dangerDark,
  warning: colors.warning,
  success: colors.success,
  info: colors.info,
  white: colors.white,
};

/** Shared app-wide for the Appearance setting (System/Light/Dark) —
 * resolves a stored preference against the OS scheme so "System" tracks
 * live OS changes. */
export function useClayPalette(preference: AppearancePreference): { palette: ClayPalette; isDark: boolean } {
  const systemScheme = useColorScheme();
  const isDark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  return { palette: isDark ? darkColors : lightColors, isDark };
}

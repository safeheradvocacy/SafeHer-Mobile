import React, { createContext, useContext } from 'react';
import { ClayPalette, useClayPalette, lightColors } from '../theme/clay';
import { useAppPreferences, AppPreferences } from '../lib/preferences';

interface ThemeContextValue {
  palette: ClayPalette;
  isDark: boolean;
  prefs: AppPreferences;
  /** False only during the brief window before the stored preferences
   * have been read from AsyncStorage for the first time — App Lock uses
   * this to avoid flashing unprotected content before a stored
   * `appLockEnabled: true` has had a chance to load. */
  prefsLoaded: boolean;
  updatePreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
}

const DEFAULT_PREFS: AppPreferences = {
  reduceMotion: false,
  largerText: false,
  highContrast: false,
  appearance: 'system',
  language: 'en',
  inAppBadgeEnabled: true,
  emergencyAlertsEnabled: true,
  appLockEnabled: false,
};

// A concrete default (light palette, no-op updater) rather than
// `undefined` — this is what lets shared components in ui.tsx call
// useTheme() unconditionally and just work correctly even if ever
// rendered outside <ThemeProvider>, instead of throwing or requiring
// every call site to guard against a missing provider.
const ThemeContext = createContext<ThemeContextValue>({
  palette: lightColors,
  isDark: false,
  prefs: DEFAULT_PREFS,
  prefsLoaded: false,
  updatePreference: () => {},
});

/**
 * SINGLE SOURCE OF TRUTH for appearance/accessibility/language across the
 * ENTIRE app — pre-auth (Onboarding, Welcome, Login, Register, Forgot
 * Password) AND authenticated (Home, Cases, SOS, Assistant, Shelters,
 * Notifications, Profile, Report Incident). Wraps the existing,
 * already-working useAppPreferences (AsyncStorage persistence) +
 * useClayPalette (resolves the stored preference against the OS scheme)
 * hooks in one Provider mounted once in RootNavigator, above both
 * AuthNavigator and AppNavigator, so every screen reads the SAME live
 * state instead of each independently re-reading storage on mount. That
 * distinction matters specifically because React Navigation's
 * native-stack keeps previous screens mounted (not unmounted) as you push
 * new ones — with independent per-screen hook instances, backing out to
 * an already-mounted earlier screen after changing the theme elsewhere
 * would show stale colors until that screen happened to remount.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { prefs, update, loaded } = useAppPreferences();
  const { palette, isDark } = useClayPalette(prefs.appearance);
  return (
    <ThemeContext.Provider value={{ palette, isDark, prefs, prefsLoaded: loaded, updatePreference: update }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

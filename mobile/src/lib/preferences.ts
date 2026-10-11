import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { AppearancePreference } from '../theme/clay';

export type AppLanguage = 'en' | 'fil';

export interface AppPreferences {
  reduceMotion: boolean;
  largerText: boolean;
  highContrast: boolean;
  appearance: AppearancePreference;
  language: AppLanguage;
  /** Home's unread-notification badge dot + pop animation. Never affects
   * what notifications exist or are delivered — purely whether this
   * device draws attention to them. */
  inAppBadgeEnabled: boolean;
  /** SOS/case-status ("emergency") notifications specifically. Off hides
   * them from the badge count and the Notifications list on THIS device
   * only — it never touches SOS triggering, alert creation, or responder
   * dispatch, which stay fully independent of this preference. */
  emergencyAlertsEnabled: boolean;
  /** Requires device biometric authentication (Face ID / Touch ID /
   * fingerprint) before the app content is shown, on cold start and on
   * returning from the background. Defaults off since it depends on
   * device hardware/enrollment that not every device has. */
  appLockEnabled: boolean;
}

const DEFAULTS: AppPreferences = {
  reduceMotion: false,
  largerText: false,
  highContrast: false,
  appearance: 'system',
  language: 'en',
  inAppBadgeEnabled: true,
  emergencyAlertsEnabled: true,
  appLockEnabled: false,
};

const STORAGE_KEY = 'safeher_app_preferences';

async function readStoredPreferences(): Promise<AppPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

async function writeStoredPreferences(prefs: AppPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort — worst case the choice doesn't persist across launches
  }
}

/**
 * Display/accessibility/privacy preferences shared app-wide (pre-auth and
 * authenticated) via ThemeContext — Reduce Motion, Larger Text, High
 * Contrast, Appearance, Language, notification badge, Emergency Alerts,
 * and App Lock. Persisted so a choice made on one screen (e.g. during
 * onboarding) carries into every other screen rather than resetting.
 * Starts from in-memory defaults and swaps in the stored values once the
 * async read resolves, rather than blocking the first paint on it —
 * `loaded` tells callers (namely AppLockGate) when that swap has happened,
 * for the one preference here where showing the default before the real
 * value loads would be a real problem, not just a cosmetic one.
 */
export function useAppPreferences() {
  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULTS);
  // Distinguishes "still reading AsyncStorage" from "read, and the stored
  // value really is the default" — App Lock needs this to avoid a brief
  // flash of unprotected content before a stored `appLockEnabled: true`
  // has had a chance to load.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    readStoredPreferences().then((stored) => {
      if (mounted) {
        setPrefs(stored);
        setLoaded(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const update = useCallback(<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      writeStoredPreferences(next);
      return next;
    });
  }, []);

  return { prefs, update, loaded };
}

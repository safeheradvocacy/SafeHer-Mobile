import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'safeher_admin_theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore — falls through to default
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_MEDIA_QUERY).matches === true;
}

/**
 * Tracks the resolved light/dark theme, but deliberately does NOT stamp
 * `data-theme` onto <html> — this provider sits above the whole app
 * (public landing page, pre-login auth screens) so a document-level
 * attribute would half-repaint those with the dark palette too, even
 * though they use their own hardcoded brand colors, not the
 * var(--color-*) tokens this theme drives. Dark mode was only
 * requested for the authenticated admin shell, so AppLayout applies
 * `data-theme={resolvedTheme}` on its own root element instead — CSS
 * variable overrides only cascade to that subtree.
 * Preference (light/dark/system) persists across sessions in
 * localStorage; when set to "system", the resolved theme also tracks
 * OS-level changes live via a matchMedia listener.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    readStoredPreference() === 'dark' || (readStoredPreference() === 'system' && systemPrefersDark()) ? 'dark' : 'light'
  );

  useEffect(() => {
    setResolvedTheme(preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') return;
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = () => setResolvedTheme(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // best-effort only — theme still applies for this session
    }
  }, []);

  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

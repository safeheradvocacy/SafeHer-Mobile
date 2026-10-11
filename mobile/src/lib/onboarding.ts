import AsyncStorage from '@react-native-async-storage/async-storage';

// Deliberately its own key (not tied to auth/session storage) — this
// must survive logout and app updates, and must NOT be cleared by
// anything except an explicit reset. "Get Started" and "Skip" both set
// this; nothing else should.
const ONBOARDING_COMPLETE_KEY = 'safeher_onboarding_complete';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)) === '1';
  } catch {
    // If storage is unavailable for some reason, default to showing
    // onboarding rather than silently skipping a first-run experience.
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, '1');
  } catch {
    // best-effort — worst case onboarding shows again next launch
  }
}

/** Not wired to any UI yet — exists so a future "Reset onboarding"
 * settings option has something real to call. */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  } catch {
    // ignore
  }
}

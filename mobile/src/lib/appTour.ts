import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Completion state for the post-login in-app feature TOUR (spotlight
 * walkthrough of Home/Cases/SOS/Assistant/Shelters/Profile) —
 * deliberately a DIFFERENT concept from lib/onboarding.ts, which tracks
 * the pre-auth marketing carousel (Splash/Onboarding/Welcome) shown
 * before any account exists. Keyed per profile_id (not device-wide like
 * onboarding.ts/preferences.ts) so a second account on a shared device
 * still gets the tour even after a first account has completed it.
 */
function keyFor(profileId: string): string {
  return `safespace_tour_complete_${profileId}`;
}

export async function hasCompletedTour(profileId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyFor(profileId))) === '1';
  } catch {
    // If storage is unavailable, default to NOT showing the tour again
    // mid-session-odd-failure — but since this is only ever checked once
    // right after a successful load, a false negative here just means a
    // skippable tour reappears, never a blocked feature.
    return true;
  }
}

export async function markTourComplete(profileId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(profileId), '1');
  } catch {
    // best-effort — worst case the tour reappears next launch
  }
}

/** Not wired to any production UI — exists for development/testing per
 * the brief's explicit "resettable for development/testing" requirement. */
export async function resetTour(profileId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(profileId));
  } catch {
    // ignore
  }
}

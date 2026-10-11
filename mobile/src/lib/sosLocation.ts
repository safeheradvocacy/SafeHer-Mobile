import * as Location from 'expo-location';
import type { SosLocationSource } from '../types/database.types';

export interface SosLocationResult {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null; // meters
  timestamp: number | null; // epoch ms the fix was taken
  source: SosLocationSource;
}

export type LocationQuality = 'Excellent' | 'Good' | 'Approximate' | 'Low Accuracy' | 'Unavailable';

// Thresholds are radii in meters. Never claim GPS is perfectly accurate —
// this only ever describes how much to trust the reported radius, never
// implies the pin is exactly on the survivor.
export function locationQuality(accuracy: number | null): LocationQuality {
  if (accuracy == null) return 'Unavailable';
  if (accuracy <= 15) return 'Excellent';
  if (accuracy <= 50) return 'Good';
  if (accuracy <= 150) return 'Approximate';
  return 'Low Accuracy';
}

const FIRST_ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_TIMEOUT_MS = 5000;
// Beyond this radius, stage 1's fix is treated as poor enough to warrant
// the stage-2 retry rather than accepting it outright.
const POOR_ACCURACY_RETRY_THRESHOLD_M = 150;
// A cached last-known position older than this is treated the same as no
// last-known position at all, rather than silently reused however stale.
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function attemptCurrentPosition(accuracy: Location.LocationAccuracy, timeoutMs: number): Promise<Location.LocationObject | null> {
  try {
    return await withTimeout(Location.getCurrentPositionAsync({ accuracy }), timeoutMs);
  } catch {
    return null;
  }
}

function fromLocationObject(pos: Location.LocationObject, source: SosLocationSource): SosLocationResult {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
    source,
  };
}

const UNAVAILABLE: SosLocationResult = { latitude: null, longitude: null, accuracy: null, timestamp: null, source: 'UNAVAILABLE' };

/**
 * The multi-stage SOS location strategy:
 *   1. High-accuracy current fix, time-boxed so the emergency flow never
 *      waits indefinitely on GPS.
 *   2. One retry if stage 1 failed outright or came back too imprecise to
 *      be useful, at a slightly lower accuracy level (faster to acquire).
 *   3. The device's last-known cached position, clearly labeled
 *      LAST_KNOWN — never presented as if it were a current fix.
 * Returns UNAVAILABLE (not a thrown error) when all three stages fail —
 * callers decide what to do next (e.g. still send the alert).
 */
export async function acquireSosLocation(): Promise<SosLocationResult> {
  let pos = await attemptCurrentPosition(Location.Accuracy.Highest, FIRST_ATTEMPT_TIMEOUT_MS);
  if (!pos || pos.coords.accuracy == null || pos.coords.accuracy > POOR_ACCURACY_RETRY_THRESHOLD_M) {
    const retry = await attemptCurrentPosition(Location.Accuracy.High, RETRY_TIMEOUT_MS);
    if (retry) pos = retry;
  }
  if (pos) return fromLocationObject(pos, 'CURRENT');

  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) return fromLocationObject(last, 'LAST_KNOWN');
  } catch {
    // Fall through to UNAVAILABLE.
  }
  return UNAVAILABLE;
}

export type LocationPreflightResult =
  | { ok: true }
  | { ok: false; reason: 'services-disabled' }
  | { ok: false; reason: 'permission-denied' };

/**
 * Checks location services + foreground permission WITHOUT acquiring a
 * fix. Split out from acquireSosLocation() so callers can show a clear,
 * specific message ("turn on location services" vs "permission denied")
 * before spending time on a GPS attempt that's guaranteed to fail anyway.
 * Only ever requests FOREGROUND permission — background is never needed
 * for SOS and is never requested here.
 */
export async function preflightLocation(): Promise<LocationPreflightResult> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { ok: false, reason: 'services-disabled' };

  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.status === 'granted') return { ok: true };

  // Only actually prompt when the OS hasn't recorded a decision yet —
  // once denied, requesting again immediately just re-shows the same
  // native prompt (or, on Android after "don't ask again", nothing at
  // all) without giving the user any new information, which is the
  // "spamming" this is meant to avoid.
  if (!existing.canAskAgain) return { ok: false, reason: 'permission-denied' };

  const requested = await Location.requestForegroundPermissionsAsync();
  return requested.status === 'granted' ? { ok: true } : { ok: false, reason: 'permission-denied' };
}

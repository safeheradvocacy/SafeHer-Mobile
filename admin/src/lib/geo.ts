export function isValidLatitude(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLongitude(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

export function describeCoordinateError(lat: number | null, lng: number | null): string | null {
  if (lat == null && lng == null) return null;
  if (lat == null || lng == null) return 'Enter both latitude and longitude, or leave both blank.';
  if (!isValidLatitude(lat)) return 'Latitude must be a number between -90 and 90.';
  if (!isValidLongitude(lng)) return 'Longitude must be a number between -180 and 180.';
  return null;
}

export type LocationQuality = 'Excellent' | 'Good' | 'Approximate' | 'Low Accuracy' | 'Unavailable';

// Mirrors mobile/src/lib/sosLocation.ts's thresholds — describes how much
// to trust an SOS alert's accuracy radius, never that GPS is exact.
export function locationQuality(accuracy: number | null): LocationQuality {
  if (accuracy == null) return 'Unavailable';
  if (accuracy <= 15) return 'Excellent';
  if (accuracy <= 50) return 'Good';
  if (accuracy <= 150) return 'Approximate';
  return 'Low Accuracy';
}

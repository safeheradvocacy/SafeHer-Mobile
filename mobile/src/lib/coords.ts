// Root-cause note (originally written for SosAlertMapCard.tsx; the same
// bug applies verbatim to shelters.latitude/longitude, which is why this
// file was generalized out of sosCoords.ts): several tables' lat/lng
// columns are Postgres `decimal(10,8)`/`decimal(11,8)` (sos_alerts,
// shelters — supabase/00_schema.sql). PostgREST's documented,
// unconditional default is to serialize `numeric`/`decimal` columns as
// JSON STRINGS (not numbers), specifically to avoid float precision
// loss. The TypeScript types declare `latitude: number | null`, which is
// what the column *should* be treated as, not a verified guarantee of
// what actually arrives over the wire — every existing read site that
// only ever did arithmetic (`-`, `*`, `Math.sin`, `<=`) on these values
// kept "working" anyway, since JS silently coerces a numeric-looking
// STRING operand to a number for every one of those operators — so the
// bug stayed invisible everywhere except the one place that hands the
// value to a native module prop (react-native-maps' MapView/Marker)
// expecting a true `number`, where no such coercion happens and the
// camera/marker position silently fails to apply.
//
// `Number(x)` here is a safe, no-op fix either way: if the value already
// arrives as a real number (a future PostgREST/schema change, or a
// differently-configured client), Number(aNumber) === aNumber.
export function toFiniteCoord(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Valid world coordinate range — guards against corrupt/placeholder data
 * (e.g. a stray 0,0 or an out-of-range value) ever being handed to the
 * native map as if it were a real fix. Call after toFiniteCoord has
 * already ruled out null/non-numeric values. */
export function isValidLatLng(lat: number | null, lng: number | null): boolean {
  return lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

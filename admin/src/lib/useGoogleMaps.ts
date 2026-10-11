import { useEffect, useState } from 'react';
import { useLoadScript } from '@react-google-maps/api';

export type GoogleMapsStatus =
  | 'missing-key' // VITE_GOOGLE_MAPS_API_KEY is unset/blank
  | 'invalid-key' // set, but looks like an unfilled placeholder, not a real key
  | 'loading' // key looks plausible, script is being fetched
  | 'ready' // script loaded and Google accepted the key
  | 'load-error' // script failed to fetch (network issue)
  | 'auth-failed'; // script loaded, but Google rejected the key at runtime

const RAW_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

// A pre-load sanity check, not a substitute for Google's own validation.
// This exists to catch the concrete failure this app hit — an unfilled
// ".env" placeholder (`YOUR-GOOGLE-MAPS-KEY`) — and other obvious non-keys,
// without being so strict that it rejects a real key in an unexpected
// format. A syntactically plausible but wrong/restricted/unbilled key
// still has to be caught at runtime, which is what gm_authFailure (below)
// is for.
function looksLikePlaceholder(key: string): boolean {
  if (key.length < 20) return true;
  return /YOUR[-_ ]|PLACEHOLDER|CHANGE[-_]?ME|REPLACE[-_]?ME|INSERT[-_]?KEY|<.*>|XXXX/i.test(key);
}

function classifyKey(key: string): 'missing' | 'placeholder' | 'ok' {
  if (!key) return 'missing';
  if (looksLikePlaceholder(key)) return 'placeholder';
  return 'ok';
}

const KEY_STATUS = classifyKey(RAW_KEY);
const SCRIPT_ID_PREFIX = 'safeher-google-maps-script-';

// Google calls this global function (if defined) for every
// authentication-class failure: InvalidKeyMapError, RefererNotAllowedMapError,
// ApiNotActivatedMapError, BillingNotEnabledMapError, ExpiredKeyMapError, and
// MissingKeyMapError. It's the ONLY reliable signal for these — they're
// runtime rejections Google's own script injects visibly into the map div,
// not a script-load failure, so useLoadScript's `loadError` never sees them.
// This is why the old fallback logic (checking only for an empty key or a
// loadError) never caught a present-but-invalid key: the script itself
// loads fine over the network, and only Google's post-load auth check fails.
//
// Module-level (not component state) because window.gm_authFailure is a
// single global — every map on the page shares one auth status and one
// retry counter, so a retry never leaves a second, orphaned script tag
// behind for a still-mounted sibling map.
let authFailed = false;
let attempt = 0;
const listeners = new Set<() => void>();
function notifyAll() {
  listeners.forEach((listener) => listener());
}
if (typeof window !== 'undefined') {
  (window as typeof window & { gm_authFailure?: () => void }).gm_authFailure = () => {
    authFailed = true;
    notifyAll();
  };
}

function useSharedGoogleMapsState() {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

// Single shared loader — @react-google-maps/api requires the SAME script
// to be loaded exactly once per page; calling useLoadScript from multiple
// components with different config would throw. Every map-using component
// in this app should call this hook, never useLoadScript directly.
//
// Only the Maps JavaScript API is required here. Geocoding (address ->
// coordinates, used by ShelterLocationPicker's "Look up coordinates"
// button) uses google.maps.Geocoder, part of the core Maps JavaScript API
// bundle — it does NOT need a `libraries` entry the way Places or Drawing
// would. Places/Directions APIs are deliberately not used anywhere in this
// app: nearby-shelter sorting is plain client-side distance math, and
// "get directions" is a zero-cost `google.com/maps/dir` deep link — so
// there is nothing here that needs them enabled.
export function useGoogleMaps(): { status: GoogleMapsStatus; retry: () => void; detail: string | null } {
  useSharedGoogleMapsState();

  // A missing/placeholder key still results in useLoadScript building a
  // keyless script URL — there's no "don't load" option on the hook — but
  // since that state never reaches `ready` below, and no consumer ever
  // renders <GoogleMap> for a non-ready status, Google's broken overlay
  // never gets a map div to paint itself into.
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: KEY_STATUS === 'ok' ? RAW_KEY : '',
    id: `${SCRIPT_ID_PREFIX}${attempt}`,
  });

  const retry = () => {
    if (typeof document !== 'undefined') {
      document.querySelectorAll(`script[id^="${SCRIPT_ID_PREFIX}"]`).forEach((el) => el.remove());
    }
    authFailed = false;
    attempt += 1;
    notifyAll();
  };

  let status: GoogleMapsStatus;
  if (KEY_STATUS === 'missing') status = 'missing-key';
  else if (KEY_STATUS === 'placeholder') status = 'invalid-key';
  else if (authFailed) status = 'auth-failed';
  else if (loadError) status = 'load-error';
  else if (!isLoaded) status = 'loading';
  else status = 'ready';

  const detail =
    status === 'invalid-key'
      ? `VITE_GOOGLE_MAPS_API_KEY is set but looks like a placeholder (${RAW_KEY.length ? `"${RAW_KEY.slice(0, 24)}${RAW_KEY.length > 24 ? '…' : ''}"` : 'empty'}).`
      : status === 'load-error'
        ? loadError?.message ?? 'The map script failed to load.'
        : status === 'auth-failed'
          ? 'window.gm_authFailure fired — Google rejected the API key at runtime (invalid key, referrer restriction, API not enabled, or billing not enabled).'
          : null;

  return { status, retry, detail };
}

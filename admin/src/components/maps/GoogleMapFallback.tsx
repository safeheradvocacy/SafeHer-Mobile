import { RefreshCw } from 'lucide-react';
import type { GoogleMapsStatus } from '../../lib/useGoogleMaps';

const COPY: Record<Exclude<GoogleMapsStatus, 'ready' | 'loading'>, { title: string; message: string; canRetry: boolean }> = {
  'missing-key': {
    title: 'Map unavailable',
    message: 'No Google Maps API key is configured for this environment.',
    canRetry: false, // baked into the build — a retry can't change it
  },
  'invalid-key': {
    title: 'Map unavailable',
    message: "The configured Google Maps API key doesn't look valid.",
    canRetry: false,
  },
  'load-error': {
    title: 'Map unavailable',
    message: "The map couldn't be loaded — check your internet connection.",
    canRetry: true,
  },
  'auth-failed': {
    title: 'Map unavailable',
    message: "Google rejected this site's Maps API key.",
    canRetry: true,
  },
};

// Shown in place of <GoogleMap> for every non-ready status. Deliberately
// never lets Google's own broken-map overlay reach the screen — that
// overlay only ever paints into a div that had `new google.maps.Map()`
// called on it, and this component is what every map-using screen renders
// *instead of* that call whenever useGoogleMaps() isn't 'ready'.
export function GoogleMapFallback({
  status,
  detail,
  onRetry,
  minHeight = 220,
}: {
  status: Exclude<GoogleMapsStatus, 'ready' | 'loading'>;
  detail?: string | null;
  onRetry?: () => void;
  minHeight?: number;
}) {
  const copy = COPY[status];
  return (
    <div
      style={{
        minHeight,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-muted)',
        fontSize: 13,
        textAlign: 'center',
        padding: 20,
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{copy.title}</span>
      <span style={{ fontSize: 12, maxWidth: 320 }}>{copy.message}</span>
      {copy.canRetry && onRetry && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={onRetry}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}
        >
          <RefreshCw size={13} /> Retry
        </button>
      )}
      {import.meta.env.DEV && detail && (
        <span style={{ fontSize: 11, maxWidth: 360, color: 'var(--color-danger)', fontFamily: 'monospace', marginTop: 4 }}>{detail}</span>
      )}
    </div>
  );
}

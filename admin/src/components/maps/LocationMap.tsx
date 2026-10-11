import React from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/useGoogleMaps';
import { GoogleMapFallback } from './GoogleMapFallback';

const CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%', borderRadius: 'var(--radius-md)' };

// Read-only single-marker map — generalized from ShelterMap.tsx (same
// @react-google-maps/api pattern, just parameterized instead of
// shelter-specific) so it can display a survivor's registered address
// or a case's incident location equally. Same tolerant-of-every-failure
// posture: a missing/invalid API key, a network error, or a null
// lat/lng never blocks the rest of the page — this is always an
// enhancement alongside the address text, never a dependency.
export function LocationMap({
  latitude,
  longitude,
  label,
  emptyMessage = "This record doesn't have a pinned location yet.",
}: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  emptyMessage?: string;
}) {
  const { status, retry, detail } = useGoogleMaps();

  if (status === 'loading') {
    return <div className="skeleton" style={{ height: '100%', minHeight: 200 }} />;
  }
  if (status !== 'ready') {
    return <GoogleMapFallback status={status} detail={detail} onRetry={retry} />;
  }
  if (latitude == null || longitude == null) {
    return <NoLocationPinned message={emptyMessage} />;
  }

  const position = { lat: latitude, lng: longitude };
  return (
    <GoogleMap mapContainerStyle={CONTAINER_STYLE} center={position} zoom={15} options={{ streetViewControl: false, mapTypeControl: false }}>
      <MarkerF position={position} title={label} />
    </GoogleMap>
  );
}

function NoLocationPinned({ message }: { message: string }) {
  return (
    <div
      style={{
        height: '100%',
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-muted)',
        fontSize: 13,
        textAlign: 'center',
        padding: 16,
      }}
    >
      {message}
    </div>
  );
}

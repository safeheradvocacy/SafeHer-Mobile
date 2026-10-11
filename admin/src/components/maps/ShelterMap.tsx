import React from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/useGoogleMaps';
import { GoogleMapFallback } from './GoogleMapFallback';

const CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%', borderRadius: 'var(--radius-md)' };

// View-only single-marker map. Deliberately tolerant of every failure
// mode — a missing/invalid API key, a network error loading the script,
// Google rejecting the key at runtime, or a shelter with no coordinates
// yet — none of these should ever block the rest of the page. The map is
// an enhancement, never a dependency: callers render this alongside the
// shelter's address text, not instead of it.
export function ShelterMap({ latitude, longitude, label }: { latitude: number | null; longitude: number | null; label: string }) {
  const { status, retry, detail } = useGoogleMaps();

  if (status === 'loading') {
    return <div className="skeleton" style={{ height: '100%', minHeight: 220 }} />;
  }
  if (status !== 'ready') {
    return <GoogleMapFallback status={status} detail={detail} onRetry={retry} />;
  }
  if (latitude == null || longitude == null) {
    return <NoLocationPinned />;
  }

  const position = { lat: latitude, lng: longitude };
  return (
    <GoogleMap mapContainerStyle={CONTAINER_STYLE} center={position} zoom={15} options={{ streetViewControl: false, mapTypeControl: false }}>
      <MarkerF position={position} title={label} />
    </GoogleMap>
  );
}

function NoLocationPinned() {
  return (
    <div
      style={{
        height: '100%',
        minHeight: 220,
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
      This shelter doesn't have a pinned location yet.
    </div>
  );
}

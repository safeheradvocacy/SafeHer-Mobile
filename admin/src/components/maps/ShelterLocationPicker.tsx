import React, { useCallback, useEffect, useState } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/useGoogleMaps';
import { GoogleMapFallback } from './GoogleMapFallback';
import { describeCoordinateError, isValidLatitude, isValidLongitude } from '../../lib/geo';

const CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: 260, borderRadius: 'var(--radius-md)' };
// Aurora province — a non-committal starting point for the map's camera
// only. Never sent to onChange; a location only ever reaches the form once
// the admin explicitly clicks/drags the pin, geocodes an address, or types
// coordinates in themselves.
const DEFAULT_CENTER = { lat: 15.75, lng: 121.55 };

// Three ways to set a shelter's location, all kept in sync through the same
// lat/lng props/onChange — none of them is the "real" source of truth, the
// parent form's state is:
//   1. Search-by-address: geocode the address field via google.maps.Geocoder.
//   2. Click/drag a pin directly on the interactive map.
//   3. Type latitude/longitude in manually.
// Option 3 is ALWAYS available, even when the map itself can't load (bad
// API key, offline, Google auth failure, etc.) — this is what keeps the
// shelter form fully usable when Google Maps fails outright.
export function ShelterLocationPicker({
  latitude,
  longitude,
  address,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  address: string;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  const { status, retry, detail } = useGoogleMaps();
  const mapsReady = status === 'ready';

  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const [latDraft, setLatDraft] = useState(latitude != null ? String(latitude) : '');
  const [lngDraft, setLngDraft] = useState(longitude != null ? String(longitude) : '');

  // Re-sync the manual-entry drafts whenever the parent's lat/lng changes —
  // whether that came from a map click, a marker drag, a successful
  // geocode, or this same component's own commit below. Safe to always run:
  // commits from these fields only happen on blur/Enter, never per
  // keystroke, so there's no chance of this fighting live typing.
  useEffect(() => {
    setLatDraft(latitude != null ? String(latitude) : '');
    setLngDraft(longitude != null ? String(longitude) : '');
  }, [latitude, longitude]);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (e.latLng) onChange(e.latLng.lat(), e.latLng.lng());
    },
    [onChange]
  );

  const lookUpCoordinates = () => {
    if (!address.trim() || !mapsReady) return;
    setGeocoding(true);
    setGeocodeError(null);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address }, (results, geoStatus) => {
      setGeocoding(false);
      if (geoStatus === 'OK' && results && results[0]) {
        const loc = results[0].geometry.location;
        onChange(loc.lat(), loc.lng());
      } else {
        setGeocodeError('Could not find coordinates for that address. Please place the pin manually or enter coordinates directly.');
      }
    });
  };

  const parsedLat = latDraft.trim() === '' ? null : Number(latDraft);
  const parsedLng = lngDraft.trim() === '' ? null : Number(lngDraft);
  const draftHasNonNumeric = (latDraft.trim() !== '' && Number.isNaN(parsedLat)) || (lngDraft.trim() !== '' && Number.isNaN(parsedLng));
  const coordError = draftHasNonNumeric ? 'Latitude and longitude must be numbers.' : describeCoordinateError(parsedLat, parsedLng);

  const commitManualEntry = () => {
    if (draftHasNonNumeric) return;
    if (parsedLat == null && parsedLng == null) {
      onChange(null, null);
      return;
    }
    if (parsedLat == null || parsedLng == null) return; // incomplete — wait for both
    if (!isValidLatitude(parsedLat) || !isValidLongitude(parsedLng)) return; // out of range — leave draft as-is, error shows
    onChange(parsedLat, parsedLng);
  };

  const position = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null;
  const locationStatusText =
    position && !coordError ? `Location selected: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : coordError ? null : 'No location selected yet';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: position ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{locationStatusText}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={lookUpCoordinates} disabled={!address.trim() || !mapsReady || geocoding}>
          {geocoding ? 'Looking up...' : 'Find on map from address'}
        </button>
      </div>
      {geocodeError && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{geocodeError}</p>}

      <div style={{ marginBottom: 12 }}>
        {mapsReady ? (
          <GoogleMap
            mapContainerStyle={CONTAINER_STYLE}
            center={position ?? DEFAULT_CENTER}
            zoom={position ? 15 : 9}
            onClick={handleMapClick}
            options={{ streetViewControl: false, mapTypeControl: false }}
          >
            {position && <MarkerF position={position} draggable onDragEnd={(e) => e.latLng && onChange(e.latLng.lat(), e.latLng.lng())} />}
          </GoogleMap>
        ) : status === 'loading' ? (
          <div className="skeleton" style={{ height: 260 }} />
        ) : (
          <GoogleMapFallback status={status} detail={detail} onRetry={retry} minHeight={260} />
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {mapsReady ? 'Click the map to place or move the pin, or enter coordinates directly below.' : 'Enter the shelter\'s coordinates directly below.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="field">
          <label className="label">Latitude</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="e.g. 15.7500"
            value={latDraft}
            onChange={(e) => setLatDraft(e.target.value)}
            onBlur={commitManualEntry}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
        <div className="field">
          <label className="label">Longitude</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="e.g. 121.5500"
            value={lngDraft}
            onChange={(e) => setLngDraft(e.target.value)}
            onBlur={commitManualEntry}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      </div>
      {coordError && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>{coordError}</p>}
    </div>
  );
}

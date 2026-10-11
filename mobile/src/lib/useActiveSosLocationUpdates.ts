import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { acquireSosLocation } from './sosLocation';
import { distanceMeters } from './geo';
import type { SosAlert } from '../types/database.types';

const POLL_INTERVAL_MS = 45_000;
// Skip the write unless the phone moved at least this far since the last
// one, UNLESS the heartbeat below is due — keeps a stationary survivor
// (the common case: sheltering in place) from generating a write every
// single poll while still proving the app is alive to responders.
const MIN_MOVE_METERS = 20;
const HEARTBEAT_MS = 3 * 60 * 1000;

/**
 * Foreground-only, controlled location refresh for an SOS alert that's
 * still active — never a background task, never started unless `enabled`
 * (the caller is responsible for tying that to screen focus) and the
 * alert itself is still Triggered/Responding. Writes are additionally
 * gated by distance/heartbeat thresholds so a stationary phone doesn't
 * produce a write every poll. If the alert gets resolved server-side,
 * `sos_alerts`'s RLS policy for this UPDATE stops matching and the write
 * just silently affects 0 rows — treated as "stop mattering", not an
 * error, since the next status-driven re-render disables this hook anyway.
 */
export function useActiveSosLocationUpdates(sos: SosAlert | null, enabled: boolean) {
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const lastWrittenRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  // Seed from the alert's own initial fix whenever a genuinely new alert
  // shows up, so "Last updated" has a real value before the first poll.
  useEffect(() => {
    if (!sos) {
      setLastUpdatedAt(null);
      lastWrittenRef.current = null;
      return;
    }
    const seedTime = sos.location_timestamp ?? sos.triggered_at;
    setLastUpdatedAt(new Date(seedTime));
    lastWrittenRef.current = sos.latitude != null && sos.longitude != null ? { lat: sos.latitude, lng: sos.longitude, at: new Date(seedTime).getTime() } : null;
  }, [sos?.sos_id]);

  useEffect(() => {
    const isActive = enabled && sos != null && (sos.status === 'Triggered' || sos.status === 'Responding');
    if (!isActive || !sos) return;

    const sosId = sos.sos_id;
    let cancelled = false;

    const tick = async () => {
      const result = await acquireSosLocation();
      if (cancelled || result.latitude == null || result.longitude == null) return;

      const last = lastWrittenRef.current;
      const movedEnough = !last || distanceMeters(last.lat, last.lng, result.latitude, result.longitude) >= MIN_MOVE_METERS;
      const dueForHeartbeat = !last || Date.now() - last.at >= HEARTBEAT_MS;
      if (!movedEnough && !dueForHeartbeat) return;

      const { error } = await supabase
        .from('sos_alerts')
        .update({
          latitude: result.latitude,
          longitude: result.longitude,
          location_accuracy: result.accuracy,
          location_timestamp: result.timestamp != null ? new Date(result.timestamp).toISOString() : new Date().toISOString(),
          location_source: result.source,
        })
        .eq('sos_id', sosId);

      if (!cancelled && !error) {
        lastWrittenRef.current = { lat: result.latitude, lng: result.longitude, at: Date.now() };
        setLastUpdatedAt(new Date());
      }
    };

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, sos?.sos_id, sos?.status]);

  return { lastUpdatedAt };
}

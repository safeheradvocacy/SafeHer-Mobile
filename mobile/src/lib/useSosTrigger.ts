import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { logAudit } from './audit';
import { acquireSosLocation, preflightLocation, type SosLocationResult } from './sosLocation';
import type { SosAlert } from '../types/database.types';

export type SosPhase = 'idle' | 'locating' | 'located' | 'location-unavailable' | 'saving' | 'done' | 'error';
export type SosLocationIssue = 'services-disabled' | 'permission-denied' | 'unavailable';

const UNAVAILABLE_LOCATION: SosLocationResult = { latitude: null, longitude: null, accuracy: null, timestamp: null, source: 'UNAVAILABLE' };
// How long the "Location detected" state is held on screen before the
// flow proceeds to saving — long enough to register, short enough that
// the overall flow still reads as fast.
const LOCATED_DWELL_MS = 700;

/**
 * The real SOS activation flow, as a phase state machine both SosScreen
 * and the Home screen's SosConfirmSheet drive identically (a UI wrapper
 * around this shared backend logic, never a parallel implementation):
 *
 *   idle -> locating -> located -> saving -> done
 *                    \-> location-unavailable -> (retryLocation | sendWithoutLocation) -> ...
 *
 * `busyRef` (not just phase state) is what actually blocks a duplicate
 * submission if the SOS button is pressed again mid-flow — phase state
 * updates are async, a ref read is not.
 */
export function useSosTrigger(profileId: string | undefined) {
  const [phase, setPhase] = useState<SosPhase>('idle');
  const [locationResult, setLocationResult] = useState<SosLocationResult | null>(null);
  const [locationIssue, setLocationIssue] = useState<SosLocationIssue | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sos, setSos] = useState<SosAlert | null>(null);
  const busyRef = useRef(false);

  const save = useCallback(
    async (location: SosLocationResult) => {
      if (!profileId) {
        busyRef.current = false;
        setErrorMessage('You need to be signed in to send an SOS alert.');
        setPhase('error');
        return;
      }
      setPhase('saving');

      let address: string | null = null;
      if (location.latitude != null && location.longitude != null) {
        try {
          const geocoded = await Location.reverseGeocodeAsync({ latitude: location.latitude, longitude: location.longitude });
          if (geocoded[0]) address = [geocoded[0].street, geocoded[0].city, geocoded[0].region].filter(Boolean).join(', ') || null;
        } catch {
          // Reverse geocoding is best-effort; lat/lng alone is enough to respond.
        }
      }

      const { data: sosRow, error } = await supabase
        .from('sos_alerts')
        .insert({
          profile_id: profileId,
          latitude: location.latitude,
          longitude: location.longitude,
          location_address: address,
          location_accuracy: location.accuracy,
          location_timestamp: location.timestamp != null ? new Date(location.timestamp).toISOString() : null,
          location_source: location.source,
          status: 'Triggered',
        })
        .select()
        .single();

      busyRef.current = false;
      if (error || !sosRow) {
        setErrorMessage(error?.message ?? 'Please try again or call emergency services directly.');
        setPhase('error');
        return;
      }

      await logAudit({ profileId, action: 'INSERT', tableName: 'sos_alerts', recordId: sosRow.sos_id, newValues: sosRow });

      setSos(sosRow as SosAlert);
      setPhase('done');
    },
    [profileId]
  );

  const locate = useCallback(async () => {
    setPhase('locating');
    setLocationIssue(null);

    // Check services/permission first — this fails fast with a specific,
    // actionable reason instead of letting a GPS attempt time out when it
    // was always going to fail.
    const preflight = await preflightLocation();
    if (!preflight.ok) {
      busyRef.current = false;
      setLocationIssue(preflight.reason);
      setLocationResult(UNAVAILABLE_LOCATION);
      setPhase('location-unavailable');
      return;
    }

    const result = await acquireSosLocation();
    setLocationResult(result);

    if (result.source === 'UNAVAILABLE') {
      busyRef.current = false;
      setLocationIssue('unavailable');
      setPhase('location-unavailable');
      return;
    }

    setPhase('located');
    await new Promise((resolve) => setTimeout(resolve, LOCATED_DWELL_MS));
    await save(result);
  }, [save]);

  const start = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setErrorMessage(null);
    setSos(null);
    locate();
  }, [locate]);

  const retryLocation = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    locate();
  }, [locate]);

  const sendWithoutLocation = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    save(UNAVAILABLE_LOCATION);
  }, [save]);

  const reset = useCallback(() => {
    busyRef.current = false;
    setPhase('idle');
    setLocationResult(null);
    setLocationIssue(null);
    setErrorMessage(null);
    setSos(null);
  }, []);

  return {
    phase,
    triggering: phase !== 'idle' && phase !== 'done' && phase !== 'error',
    locationResult,
    locationIssue,
    errorMessage,
    sos,
    start,
    retryLocation,
    sendWithoutLocation,
    reset,
  };
}

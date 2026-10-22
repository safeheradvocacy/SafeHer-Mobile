import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePoliceSosAlerts, bucketOf, isCriticalSos, sosElapsedMinutes, sosUrgencyScore } from '../hooks/usePoliceSosAlerts';
import { useSosAlertFeed } from '../hooks/useSosAlertFeed';
import { SosAudioManager } from '../lib/sosAudio';
import { readNotifPrefs, writeNotifPrefs } from '../lib/notifPrefs';
import type { SosAlert } from '../types/database.types';

/** How often an unacknowledged SOS gets a repeat reminder chime, per the
 * brief's own suggested default. Not exposed as a user-facing setting —
 * the brief explicitly allows "a clearly documented constant" instead of
 * building a settings UI for a single number, since no existing settings
 * mechanism for numeric intervals exists in this app to hook into. */
const REMINDER_INTERVAL_MS = 30_000;

export type SoundState = 'disabled' | 'blocked' | 'enabled';

interface SosAlertContextValue {
  // Pass-through of the one, single usePoliceSosAlerts instance this
  // Provider owns — LawEnforcementDashboard and SosReferralsPage both
  // read it from here now instead of each calling the hook themselves,
  // which used to mean two independent 'police-sos-alerts' Realtime
  // channels/queries for the exact same data (brief, Phase 8: "Prevent
  // duplicate subscriptions").
  alerts: SosAlert[];
  officerNames: Record<string, string>;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: number | null;
  error: string | null;
  reload: (isRefresh?: boolean) => void;
  acknowledge: (alert: SosAlert) => Promise<{ message: string } | { message: string | undefined } | null | undefined>;
  setStatus: (alert: SosAlert, status: SosAlert['status']) => Promise<any>;

  // New-alert pop-up queue.
  visiblePopups: SosAlert[];
  dismissPopup: (sosId: string) => void;
  viewAlert: (sosId: string) => void;

  // Sound. `soundState` is the ACTUAL, honest state of this browser tab
  // right now (always starts 'disabled' on a fresh load — an AudioContext
  // is never pre-unlocked, no matter what was chosen last time; see
  // SosAudioManager). `preferenceEnabled` is the persisted choice from
  // notifPrefs, used only to phrase the control's copy ("re-enable" vs.
  // "enable") — never to claim sound already works.
  soundState: SoundState;
  preferenceEnabled: boolean;
  reminderCount: number;
  enableSound: () => Promise<void>;
  disableSound: () => void;
}

const SosAlertContext = createContext<SosAlertContextValue | undefined>(undefined);

/**
 * Mounted once, in AppLayout, only while the signed-in profile is
 * law_enforcement (see that file) — above the <Outlet/>, so it keeps
 * running (and the pop-up stack keeps showing) no matter which page
 * within the Police dashboard the officer is on, per the brief's "display
 * new alerts even when viewing another page" requirement. Logging out (or
 * any navigation that unmounts AppLayout) unmounts this with it, which is
 * what actually guarantees "no SOS sound after logout" — there is no
 * separate timer or AudioContext left running once this is gone.
 */
export function SosAlertProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const sos = usePoliceSosAlerts();
  const audioRef = useRef<SosAudioManager | null>(null);
  if (!audioRef.current) audioRef.current = new SosAudioManager();

  // Always starts 'disabled' regardless of the stored preference — a
  // fresh page load never has an unlocked AudioContext yet (see
  // SosAudioManager's own header), so claiming otherwise here would be
  // exactly the "falsely indicate sound was enabled" the brief warns
  // against.
  const [soundState, setSoundState] = useState<SoundState>('disabled');
  const [preferenceEnabled, setPreferenceEnabled] = useState<boolean>(() => readNotifPrefs().sosAlerts);
  const [reminderCount, setReminderCount] = useState(0);

  const playIfEnabled = useCallback((kind: 'new-alert' | 'reminder') => {
    const mgr = audioRef.current;
    if (!mgr || !mgr.unlocked) return;
    mgr.play(kind);
  }, []);

  const handleNewAlert = useCallback(
    (_alert: SosAlert) => {
      playIfEnabled('new-alert');
    },
    [playIfEnabled]
  );

  const { activeQueue, visiblePopups, dismiss } = useSosAlertFeed(sos.alerts, handleNewAlert);

  const activeQueueRef = useRef(activeQueue);
  activeQueueRef.current = activeQueue;

  // Single shared reminder cycle for every outstanding alert combined
  // (brief, Phase 3.2: "avoid an overwhelming stream of simultaneous
  // sounds... a single reminder cycle that reflects outstanding
  // unacknowledged alerts") — one interval for the whole queue, not one
  // per alert, created exactly once for the life of this provider so
  // navigating between pages can never restart or duplicate it.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (activeQueueRef.current.length === 0) return;
      const played = audioRef.current?.unlocked ? audioRef.current.play('reminder') : false;
      if (played) setReminderCount((c) => c + 1);
    }, REMINDER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Release the AudioContext when this provider goes away (logout,
  // navigating out of the Police dashboard entirely) — brief, Phase 3.5.
  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
    };
  }, []);

  const enableSound = useCallback(async () => {
    const mgr = audioRef.current!;
    const ok = await mgr.unlock();
    if (ok) {
      const prefs = readNotifPrefs();
      writeNotifPrefs({ ...prefs, sosAlerts: true });
      setPreferenceEnabled(true);
      setSoundState('enabled');
      // Brief, 3.3: "a short confirmation sound only if appropriate" —
      // reuses the lighter reminder tone rather than the full new-alert
      // chime, so it reads as "this is a test", not "new emergency".
      mgr.play('reminder');
    } else {
      setSoundState('blocked');
    }
  }, []);

  const disableSound = useCallback(() => {
    const prefs = readNotifPrefs();
    writeNotifPrefs({ ...prefs, sosAlerts: false });
    setPreferenceEnabled(false);
    setSoundState('disabled');
  }, []);

  const dismissPopup = useCallback((sosId: string) => dismiss(sosId), [dismiss]);

  const viewAlert = useCallback(
    (sosId: string) => {
      navigate('/admin/law-enforcement/sos-referrals', { state: { openSosId: sosId } });
    },
    [navigate]
  );

  const value: SosAlertContextValue = {
    alerts: sos.alerts,
    officerNames: sos.officerNames,
    loading: sos.loading,
    refreshing: sos.refreshing,
    lastUpdated: sos.lastUpdated,
    error: sos.error,
    reload: sos.reload,
    acknowledge: sos.acknowledge,
    setStatus: sos.setStatus,
    visiblePopups,
    dismissPopup,
    viewAlert,
    soundState,
    preferenceEnabled,
    reminderCount,
    enableSound,
    disableSound,
  };

  return <SosAlertContext.Provider value={value}>{children}</SosAlertContext.Provider>;
}

export function useSosAlertContext() {
  const ctx = useContext(SosAlertContext);
  if (!ctx) throw new Error('useSosAlertContext must be used within a SosAlertProvider');
  return ctx;
}

// Re-exported so pages that previously imported these directly from
// usePoliceSosAlerts keep working unchanged after switching their data
// source to this context.
export { bucketOf, isCriticalSos, sosElapsedMinutes, sosUrgencyScore };

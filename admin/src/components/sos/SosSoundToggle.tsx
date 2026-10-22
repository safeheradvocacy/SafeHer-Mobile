import React from 'react';
import { Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import { useSosAlertContext } from '../../contexts/SosAlertContext';

/**
 * The one "Enable SOS Sound Alerts" control the brief asks for (Phase
 * 3.3/3.4/10) — rendered in the two Police-dashboard pages that have an
 * SOS queue (LawEnforcementDashboard, SosReferralsPage), not in the
 * shared DashboardHeaderActions every role's page uses, since an audio
 * unlock button makes sense only for this role's emergency queue.
 *
 * Three honest states, never a fourth "probably works" state:
 *  - disabled   — sound not yet unlocked this browser tab (the default on
 *                 every fresh load, see SosAudioManager) or turned off.
 *  - enabled    — AudioContext confirmed 'running'; alerts will chime.
 *  - blocked    — the officer clicked Enable and the browser still
 *                 refused (autoplay policy, OS-level audio restriction,
 *                 etc.) — visible pop-ups keep working regardless.
 */
export function SosSoundToggle() {
  const { soundState, preferenceEnabled, enableSound, disableSound } = useSosAlertContext();

  if (soundState === 'enabled') {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm sos-sound-btn sos-sound-btn-on"
        onClick={disableSound}
        aria-pressed="true"
      >
        <Volume2 size={15} strokeWidth={2} />
        Sound Alerts On
      </button>
    );
  }

  if (soundState === 'blocked') {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm sos-sound-btn sos-sound-btn-blocked"
        onClick={enableSound}
        aria-pressed="false"
      >
        <AlertTriangle size={15} strokeWidth={2} />
        Sound Blocked — Retry
      </button>
    );
  }

  return (
    <button type="button" className="btn btn-primary btn-sm sos-sound-btn" onClick={enableSound} aria-pressed="false">
      <VolumeX size={15} strokeWidth={2} />
      {preferenceEnabled ? 'Re-enable SOS Sound Alerts' : 'Enable SOS Sound Alerts'}
    </button>
  );
}

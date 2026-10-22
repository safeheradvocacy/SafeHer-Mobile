import React from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, MapPin, X } from 'lucide-react';
import { useSosAlertContext } from '../../contexts/SosAlertContext';
import { sosReference } from '../../hooks/usePoliceSosAlerts';
import { locationQuality } from '../../lib/geo';
import type { SosAlert } from '../../types/database.types';

const MAX_VISIBLE_CARDS = 3;

function locationSummary(a: SosAlert): { text: string; gpsAvailable: boolean } {
  if (a.latitude == null || a.longitude == null) {
    return { text: 'Location unavailable', gpsAvailable: false };
  }
  const text = a.location_address || `${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}`;
  return { text, gpsAvailable: true };
}

function Card({ alert, onView, onDismiss }: { alert: SosAlert; onView: () => void; onDismiss: () => void }) {
  const loc = locationSummary(alert);
  return (
    <div className="sos-popup-card" role="alertdialog" aria-label={`New emergency SOS, reference ${sosReference(alert)}`}>
      <div className="sos-popup-head">
        <span className="sos-popup-heading">
          <AlertOctagon size={16} strokeWidth={2.2} aria-hidden="true" />
          NEW EMERGENCY SOS
        </span>
        <button type="button" className="sos-popup-dismiss" onClick={onDismiss} aria-label="Dismiss this notification (does not acknowledge or resolve the alert)">
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="sos-popup-body">
        <div className="sos-popup-row">
          <span className="sos-popup-label">Reference</span>
          <strong>{sosReference(alert)}</strong>
        </div>
        <div className="sos-popup-row">
          <span className="sos-popup-label">Triggered</span>
          <span>{new Date(alert.triggered_at).toLocaleTimeString()}</span>
        </div>
        <div className="sos-popup-row">
          <span className="sos-popup-label">Status</span>
          <span>{alert.status}</span>
        </div>
        <div className="sos-popup-row">
          <span className="sos-popup-label">
            <MapPin size={12} strokeWidth={2} style={{ verticalAlign: -1 }} aria-hidden="true" /> Location
          </span>
          <span style={{ textAlign: 'right' }}>
            {loc.text}
            {loc.gpsAvailable && (
              <span className="sos-popup-gps">
                {' '}
                · {locationQuality(alert.location_accuracy)}
                {alert.location_source === 'LAST_KNOWN' ? ' (last known)' : ''}
              </span>
            )}
          </span>
        </div>
        {/* No survivor name/contact shown — a police officer's RLS access
            never extends to user_profiles beyond their own row, matching
            SosReferralsPage's own restraint (see that page's header). */}
      </div>

      <button type="button" className="btn btn-primary btn-sm sos-popup-view" onClick={onView}>
        View SOS Alert
      </button>
    </div>
  );
}

/**
 * Non-blocking floating stack, portaled straight into <body> (same reason
 * Modal does — see ui.tsx's own comment: anything `position: fixed`
 * inside .page-transition gets the wrong containing block otherwise).
 * Deliberately NOT a Modal: brief, Phase 2/10 — must never interrupt an
 * officer already responding, must never cover response controls, and
 * dismissing it must be possible without touching the underlying alert.
 */
export function SosAlertPopup() {
  const { visiblePopups, dismissPopup, viewAlert } = useSosAlertContext();

  if (visiblePopups.length === 0) return null;

  const shown = visiblePopups.slice(0, MAX_VISIBLE_CARDS);
  const overflow = visiblePopups.length - shown.length;

  return createPortal(
    <div className="sos-popup-stack" aria-live="polite">
      {shown.map((alert) => (
        <Card
          key={alert.sos_id}
          alert={alert}
          onView={() => viewAlert(alert.sos_id)}
          onDismiss={() => dismissPopup(alert.sos_id)}
        />
      ))}
      {overflow > 0 && (
        <button type="button" className="sos-popup-overflow" onClick={() => viewAlert(shown[0]?.sos_id ?? '')}>
          +{overflow} more new SOS alert{overflow === 1 ? '' : 's'} — view all
        </button>
      )}
    </div>,
    document.body
  );
}

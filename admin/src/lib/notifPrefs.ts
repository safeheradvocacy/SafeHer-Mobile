// Extracted from SettingsPage.tsx (same key, same shape, same default —
// no behavior change for Settings itself) so the new Police Dashboard SOS
// sound feature can read/write the existing `sosAlerts` preference instead
// of inventing a second, parallel "are SOS alerts wanted" flag. Settings'
// own "SOS Alerts" toggle was previously a cosmetic preference nothing
// actually read; it now doubles as the persisted on/off switch for the
// dashboard's audible alerts, which is the "appropriate existing
// preference mechanism" the SOS pop-up/sound feature was asked to reuse.
const NOTIF_PREFS_KEY = 'safeher_admin_notif_prefs';

export interface NotifPrefs {
  caseReports: boolean;
  sosAlerts: boolean;
  caseUpdates: boolean;
  referralUpdates: boolean;
  systemNotifications: boolean;
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  caseReports: true,
  sosAlerts: true,
  caseUpdates: true,
  referralUpdates: true,
  systemNotifications: true,
};

export function readNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) return { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_NOTIF_PREFS;
}

export function writeNotifPrefs(next: NotifPrefs): void {
  try {
    localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — the in-memory state the
    // caller already holds still works for the rest of the session.
  }
}

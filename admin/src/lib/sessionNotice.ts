/**
 * Why the previous admin session ended, carried across the reload so the
 * login screen can explain itself instead of silently presenting a form.
 *
 * Stored in localStorage rather than sessionStorage on purpose: the whole
 * point is to survive the tab close that ended the session. It holds no
 * identity — just a reason string and a timestamp — so it reveals
 * nothing if read by anything else on the origin.
 */

const KEY = 'safeher_admin_session_end';

/** 'closed' and 'idle' are worth telling the operator about. 'manual' is not — they pressed sign out. */
export type SessionEndReason = 'closed' | 'idle' | 'manual';

interface StoredNotice {
  reason: SessionEndReason;
  at: number;
}

/**
 * Records why the session ended. Safe to call from a `pagehide` handler:
 * localStorage writes are synchronous, so this lands even as the tab is
 * being torn down (which is exactly why the notice cannot live in
 * React state).
 */
export function markSessionEnded(reason: SessionEndReason): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ reason, at: Date.now() } satisfies StoredNotice));
  } catch {
    // Private mode / storage disabled. The notice is a courtesy, never a
    // security control — losing it must not break sign-in.
  }
}

/**
 * Reads and CLEARS the notice, so it shows exactly once.
 *
 * Returns null for a manual sign-out (the operator knows why they are
 * looking at a login form) and for anything older than 12 hours, so a
 * notice left behind by a long-forgotten session cannot resurface days
 * later looking like something just happened.
 */
export function consumeSessionEndNotice(): 'closed' | 'idle' | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);

    const parsed = JSON.parse(raw) as Partial<StoredNotice>;
    if (parsed.reason !== 'closed' && parsed.reason !== 'idle') return null;
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > 12 * 60 * 60 * 1000) return null;

    return parsed.reason;
  } catch {
    return null;
  }
}

export const SESSION_END_MESSAGE: Record<'closed' | 'idle', string> = {
  closed: 'Your session ended when the browser was closed. Please sign in again.',
  idle: 'Your session ended after a period of inactivity. Please sign in again.',
};

import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * The one coordinated auto-refresh mechanism every admin dashboard uses
 * (see DashboardHeaderActions for the matching "Live" indicator) —
 * silently re-runs `onTick` (each page's own existing `load`/`fetchAll`
 * function, called with `isRefresh: true`) every `intervalMs`, so every
 * dashboard's data stays in sync without a page reload, without
 * resetting filters/tabs/scroll (those live in separate state `load`
 * never touches), and without six pages independently inventing their
 * own timer.
 *
 * Pauses while the tab is hidden (and does one immediate catch-up tick
 * on return) — no point re-querying Supabase every 60s for a dashboard
 * nobody is looking at, and it avoids piling up requests across many
 * background browser tabs.
 *
 * Does NOT fire on mount — each page's own initial `useEffect` already
 * does the first load; this only owns the *recurring* part.
 */
export function useAutoRefresh(onTick: () => void, intervalMs: number = DEFAULT_INTERVAL_MS) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => onTickRef.current(), intervalMs);
    };
    const stop = () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        onTickRef.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { bucketOf } from './usePoliceSosAlerts';
import type { SosAlert } from '../types/database.types';

/**
 * Pure derived-state layer on top of usePoliceSosAlerts's own `alerts`
 * array — deliberately holds no Realtime subscription or poll timer of
 * its own. usePoliceSosAlerts already keeps `alerts` current two ways:
 * an immediate `postgres_changes` '*' handler (genuine real-time) and a
 * 60s poll fallback (useAutoRefresh) for whenever Realtime is degraded or
 * unavailable — exactly the "use the existing real-time architecture,
 * implement a suitable fallback" the brief asks for, so this hook reuses
 * both for free by just reacting to `alerts` changing, instead of opening
 * a second parallel subscription that would risk duplicate/out-of-sync
 * detection against the first.
 *
 * "Genuinely new" detection: the FIRST time this hook sees a (possibly
 * empty) alerts list, every id in it is seeded as already-known — nothing
 * present at initial load (or after a hard refresh, which re-seeds the
 * same way) is ever treated as a new arrival, matching the brief's
 * explicit "don't replay history as new" requirement. Only an id that
 * shows up in a LATER `alerts` update, that was never in any earlier one,
 * counts as new — which is also exactly what happens after a missed-
 * Realtime-event reconnect gap, since the next poll tick (or Realtime
 * catching back up) delivers the same `alerts` update this effect is
 * already watching. One unified code path covers live arrival,
 * poll-fallback discovery, and reconnect reconciliation.
 */
export function useSosAlertFeed(alerts: SosAlert[], onNewAlert: (alert: SosAlert) => void) {
  const seededRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const onNewAlertRef = useRef(onNewAlert);
  onNewAlertRef.current = onNewAlert;

  // Ids ever flagged as a genuine new arrival this session — stays a
  // member even after the alert leaves the 'new' bucket (acknowledged/
  // resolved); `activeQueue`/`visiblePopups` below filter it back out by
  // re-checking the alert's OWN live status each time, not by removing
  // the id here, so there's nothing to race against a status update.
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set());
  // Ids the officer dismissed the pop-up CARD for — explicitly NOT the
  // same as acknowledging (brief, Phase 2): the alert stays in
  // `activeQueue` (and keeps getting reminder sounds) even once its card
  // is hidden from `visiblePopups`.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!seededRef.current) {
      for (const a of alerts) knownIdsRef.current.add(a.sos_id);
      seededRef.current = true;
      return;
    }
    const freshlyNew: SosAlert[] = [];
    for (const a of alerts) {
      if (!knownIdsRef.current.has(a.sos_id)) {
        knownIdsRef.current.add(a.sos_id);
        if (bucketOf(a) === 'new') freshlyNew.push(a);
      }
    }
    if (freshlyNew.length === 0) return;
    setAlertedIds((prev) => {
      const next = new Set(prev);
      freshlyNew.forEach((a) => next.add(a.sos_id));
      return next;
    });
    // Oldest-first, so if several arrived in the same tick the chime/
    // pop-up order still matches triggered_at order.
    freshlyNew
      .slice()
      .sort((a, b) => new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime())
      .forEach((a) => onNewAlertRef.current(a));
  }, [alerts]);

  const byId = useMemo(() => new Map(alerts.map((a) => [a.sos_id, a] as const)), [alerts]);

  // Still unacknowledged (bucket === 'new') AND flagged as a genuine
  // arrival — this is the set reminder sounds are based on, independent
  // of whether its pop-up card is currently visible.
  const activeQueue = useMemo(() => {
    const list: SosAlert[] = [];
    alertedIds.forEach((id) => {
      const a = byId.get(id);
      if (a && bucketOf(a) === 'new') list.push(a);
    });
    return list.sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime());
  }, [alertedIds, byId]);

  const visiblePopups = useMemo(() => activeQueue.filter((a) => !dismissedIds.has(a.sos_id)), [activeQueue, dismissedIds]);

  const dismiss = useCallback((sosId: string) => {
    setDismissedIds((prev) => (prev.has(sosId) ? prev : new Set(prev).add(sosId)));
  }, []);

  // Light hygiene so dismissedIds doesn't grow for an entire shift once
  // alerts leave the active queue (e.g. resolved) — harmless either way
  // since activeQueue/visiblePopups re-derive from live status regardless,
  // this just keeps the Set itself from accumulating stale entries.
  useEffect(() => {
    setDismissedIds((prev) => {
      const activeIds = new Set(activeQueue.map((a) => a.sos_id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (activeIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue]);

  return { activeQueue, visiblePopups, dismiss };
}

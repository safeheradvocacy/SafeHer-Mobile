import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../contexts/AuthContext';
import type { SosAlert, SosStatus } from '../types/database.types';

const PAGE_SIZE = 20;

// Real status values only — there is no 'Cancelled' SosStatus (SosStatus
// = 'Triggered' | 'Responding' | 'Resolved', database.types.ts) and
// survivors have no way to cancel an already-triggered alert (confirmed:
// the validate_sos_alert_update() trigger only lets law_enforcement/admin
// roles change `status`), so no such filter is offered. 'Triggered' is
// relabeled "Awaiting Response" for the survivor-facing list — same real
// value, friendlier copy — matching the brief's own instruction to only
// expose filters for statuses that actually exist.
export const SOS_HISTORY_FILTERS: { label: string; value: 'all' | SosStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Awaiting Response', value: 'Triggered' },
  { label: 'Responding', value: 'Responding' },
  { label: 'Resolved', value: 'Resolved' },
];

export type SosHistoryFilterValue = (typeof SOS_HISTORY_FILTERS)[number]['value'];

/**
 * The survivor's own SOS history — same `sos_alerts` table SosScreen
 * already reads, same RLS (a survivor's existing SELECT policy already
 * scopes this to `profile_id = auth.uid()`-derived own profile, with no
 * separate "history" table or relaxed access needed). Paginates via
 * `.range()` rather than fetching every record at once.
 */
export function useSosHistory() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState<SosHistoryFilterValue>('all');
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (opts: { isRefresh?: boolean } = {}) => {
      if (!profile) return;
      const myRequestId = ++requestIdRef.current;
      if (opts.isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      let query = supabase
        .from('sos_alerts')
        .select('*')
        .eq('profile_id', profile.profile_id)
        .order('triggered_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);
      if (filter !== 'all') query = query.eq('status', filter);

      const { data, error: err } = await query;
      // A slower, now-superseded request landing after a newer one (e.g.
      // the filter changed again before this resolved) must not overwrite
      // the newer result.
      if (myRequestId !== requestIdRef.current) return;

      if (err) {
        console.error('[useSosHistory] load:', err.message);
        setError("Couldn't load your SOS history.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setAlerts(data ?? []);
      setHasMore((data?.length ?? 0) === PAGE_SIZE);
      setLoading(false);
      setRefreshing(false);
    },
    [profile, filter]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, filter]);

  const loadMore = useCallback(async () => {
    if (!profile || loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    let query = supabase
      .from('sos_alerts')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .order('triggered_at', { ascending: false })
      .range(alerts.length, alerts.length + PAGE_SIZE - 1);
    if (filter !== 'all') query = query.eq('status', filter);

    const { data, error: err } = await query;
    setLoadingMore(false);
    if (err) {
      console.error('[useSosHistory] loadMore:', err.message);
      return;
    }
    setAlerts((prev) => [...prev, ...(data ?? [])]);
    setHasMore((data?.length ?? 0) === PAGE_SIZE);
  }, [profile, filter, alerts.length, loadingMore, hasMore, loading]);

  return {
    alerts,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    filter,
    setFilter,
    reload: () => load({ isRefresh: true }),
    loadMore,
  };
}

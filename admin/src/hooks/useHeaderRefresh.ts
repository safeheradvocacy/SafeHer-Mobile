import { useEffect, useState } from 'react';

/**
 * The shared refresh-state contract behind every page's
 * DashboardHeaderActions (module26) — mirrors the exact pattern already
 * proven in MunicipalDashboard/ProvincialDashboard/ReportsPage rather
 * than inventing a new one. A page keeps its own `load`/`loading` as
 * it already does; this hook only adds the two pieces the shared
 * header needs (`refreshing` for the spin state, `lastUpdated` for the
 * LiveIndicator) without the header ever reaching into the page's data
 * layer itself — the header still just calls back into this page's own
 * registered reload, never fetches anything on its own.
 *
 * `lastUpdated` is set only once `loading` has actually gone false, so
 * the indicator can never claim "Updated just now" before the first
 * real load completes.
 */
export function useHeaderRefresh(loading: boolean, reload: () => void | Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (!loading) setLastUpdated(Date.now());
  }, [loading]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, lastUpdated, onRefresh };
}

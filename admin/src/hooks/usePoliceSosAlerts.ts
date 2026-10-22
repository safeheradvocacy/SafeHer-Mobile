import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useAutoRefresh } from './useAutoRefresh';
import type { SosAlert, SosStatus } from '../types/database.types';

const TERMINAL: SosStatus[] = ['Resolved'];

/** New = nobody has acknowledged it yet. Active = acknowledged and/or a
 * responder is actively on it. Completed = resolved. Mirrors the shape
 * useLawEnforcementReferrals.bucketOf used to provide for SOS referrals,
 * now derived from sos_alerts' own status + acknowledged_by directly
 * (module19) instead of a referral_status row. */
export function bucketOf(a: SosAlert): 'new' | 'active' | 'completed' {
  if (TERMINAL.includes(a.status)) return 'completed';
  return a.acknowledged_by == null && a.status === 'Triggered' ? 'new' : 'active';
}

/** Minutes since the alert was triggered — real elapsed time, nothing
 * derived/estimated. */
export function sosElapsedMinutes(a: SosAlert): number {
  return Math.floor((Date.now() - new Date(a.triggered_at).getTime()) / 60000);
}

/** sos_alerts has no severity/priority column — there is no real data to
 * back a Critical/High/Normal badge, so none is shown. "Urgency" is
 * entirely two real, existing signals: whether the alert itself is still
 * Triggered (no responder yet) vs Responding/Resolved, and how long it's
 * been waiting. Higher = more urgent. */
export function sosUrgencyScore(a: SosAlert): number {
  const statusWeight = a.status === 'Triggered' ? 100_000 : a.status === 'Responding' ? 50_000 : 0;
  return statusWeight + sosElapsedMinutes(a);
}

/** A real, existing signal (status === 'Triggered', i.e. no responder
 * acting on it yet) — used for the "Critical" flag instead of a
 * fabricated severity field. */
export function isCriticalSos(a: SosAlert): boolean {
  return a.status === 'Triggered';
}

/** A short, human-readable reference derived from the real sos_id — sos_
 * alerts has no separate case-number/reference column, so this is display
 * formatting only, never stored or treated as a second identifier. Moved
 * here (from SosReferralsPage) so the new-alert pop-up can show the exact
 * same reference for the exact same alert without a second, divergent
 * implementation. */
export function sosReference(a: SosAlert): string {
  return `SOS-${a.sos_id.slice(0, 8).toUpperCase()}`;
}

/**
 * Direct, unconditional SOS access for police officers (module19) — no
 * law_enforcement_referrals row required. RLS grants every active
 * law_enforcement account SELECT+UPDATE on every sos_alerts row
 * (province-wide; there is no narrower, non-fabricated jurisdiction
 * concept for this role anywhere in the schema). Queries explicit
 * sos_alerts columns only, no user_profiles embed — defense-in-depth,
 * on top of user_profiles' own RLS already not granting this role any
 * access beyond its own row.
 *
 * Realtime: sos_alerts is already in the supabase_realtime publication
 * (module17). The 60s poll (useAutoRefresh) is a fallback either way.
 */
export function usePoliceSosAlerts() {
  const { profile } = useAuth();
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [officerNames, setOfficerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('sos_alerts')
      .select(
        'sos_id,profile_id,latitude,longitude,location_address,location_accuracy,location_timestamp,location_source,status,triggered_at,resolved_at,acknowledged_by,acknowledged_at'
      )
      .order('triggered_at', { ascending: false });
    if (err) {
      console.error('[usePoliceSosAlerts] load:', err.message);
      setError('Unable to load SOS alerts.');
    }
    setAlerts((data as SosAlert[] | null) ?? []);
    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fallback sync — never the ONLY path to fresh data, see file header.
  useAutoRefresh(() => load(true));

  useEffect(() => {
    const channel = supabase
      .channel('police-sos-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Names for whichever officers have acknowledged an alert — a small,
  // explicit, role-scoped lookup (never a bare embed off sos_alerts; see
  // file header), same pattern SosMonitoringPage already used for its
  // officer picker.
  useEffect(() => {
    const ids = Array.from(new Set(alerts.map((a) => a.acknowledged_by).filter((id): id is string => !!id)));
    if (ids.length === 0) return;
    supabase
      .from('user_profiles')
      .select('profile_id,first_name,last_name')
      .in('profile_id', ids)
      .then(({ data }) => {
        const next: Record<string, string> = {};
        (data ?? []).forEach((o: any) => {
          next[o.profile_id] = `${o.first_name} ${o.last_name}`;
        });
        setOfficerNames((prev) => ({ ...prev, ...next }));
      });
  }, [alerts]);

  // Acknowledge without changing status — "I've seen this", distinct
  // from actually responding. Self-only + role-only, enforced by the
  // validate_sos_alert_update() trigger regardless of what this sends.
  const acknowledge = useCallback(
    async (alert: SosAlert) => {
      if (!profile) return { message: 'Not signed in.' };
      const { error: err } = await supabase
        .from('sos_alerts')
        .update({ acknowledged_by: profile.profile_id, acknowledged_at: new Date().toISOString() })
        .eq('sos_id', alert.sos_id);
      if (!err) load();
      return err;
    },
    [profile, load]
  );

  // Forward-only (Triggered->Responding->Resolved), enforced by the
  // trigger; auto-acknowledges server-side if not already acknowledged.
  const setStatus = useCallback(
    async (alert: SosAlert, status: SosStatus) => {
      const update: Partial<SosAlert> = { status };
      if (status === 'Resolved') update.resolved_at = new Date().toISOString();
      const { error: err } = await supabase.from('sos_alerts').update(update).eq('sos_id', alert.sos_id);
      if (!err) load();
      return err;
    },
    [load]
  );

  return {
    alerts,
    officerNames,
    loading,
    refreshing,
    lastUpdated,
    error,
    reload: (isRefresh = true) => load(isRefresh),
    acknowledge,
    setStatus,
  };
}

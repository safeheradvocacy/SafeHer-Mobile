import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useAutoRefresh } from './useAutoRefresh';
import type { LawEnforcementReferral, ReferralStatus } from '../types/database.types';

// Case-referrals only (module19) — SOS no longer goes through this table
// at all; a police officer has direct, unconditional access to every
// sos_alerts row instead (see usePoliceSosAlerts.ts). This hook kept its
// original name/shape since law_enforcement_referrals itself is
// unchanged for case referrals — only the SOS half of what it used to
// serve moved out.
export type LeReferralRow = LawEnforcementReferral & {
  case_reports?: {
    case_number: string;
    case_type: string;
    description: string;
    incident_location: string;
    status: string;
    priority_level: string;
    municipality_id: string;
    incident_barangay_id: string | null;
  } | null;
};

const TERMINAL: ReferralStatus[] = ['Declined', 'Completed'];

/** Shared bucketing so the overview and Incident Report Referrals pages
 * can never independently disagree on what counts as "New" vs "Active"
 * vs done — reuses the real referral_status enum, never a second status
 * system. */
export function bucketOf(r: LeReferralRow): 'new' | 'active' | 'completed' {
  if (TERMINAL.includes(r.status)) return 'completed';
  return r.status === 'Pending' ? 'new' : 'active';
}

/**
 * The shared fetch/realtime/bucketing layer for the two case-referral-
 * facing surfaces (Police Dashboard's "Recent Case Referrals" section,
 * Incident Report Referrals page) — reuses the exact authorized dataset
 * instead of two independent queries that could drift.
 *
 * Scope is unchanged from the original: assigned_officer_id = the
 * signed-in officer's own profile_id — there is no shared queue for
 * case referrals (see module9_law_enforcement.sql's header for why;
 * this remains true even though SOS access is now direct/unconditional,
 * module19 — the two were always separate access models sharing one
 * table).
 *
 * Realtime: subscribes to postgres_changes scoped to this officer's own
 * assignments (module17 added law_enforcement_referrals to the
 * supabase_realtime publication). The 60s poll (useAutoRefresh) is a
 * fallback either way, so a missed/dropped websocket event is never the
 * only path to fresh data.
 */
export function useLawEnforcementReferrals() {
  const { profile } = useAuth();
  const [caseReferrals, setCaseReferrals] = useState<LeReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!profile) return;
      if (isRefresh) setRefreshing(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('law_enforcement_referrals')
        .select(
          '*, case_reports(case_number,case_type,description,incident_location,status,priority_level,municipality_id,incident_barangay_id)'
        )
        .eq('assigned_officer_id', profile.profile_id)
        .not('case_id', 'is', null)
        .order('created_at', { ascending: false });
      if (err) {
        console.error('[useLawEnforcementReferrals] load:', err.message);
        setError('Unable to load referrals.');
      }
      setCaseReferrals((data as LeReferralRow[] | null) ?? []);
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(Date.now());
    },
    [profile]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Fallback sync — never the ONLY path to fresh data, see file header.
  useAutoRefresh(() => load(true));

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`law-enforcement-case-referrals-${profile.profile_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'law_enforcement_referrals', filter: `assigned_officer_id=eq.${profile.profile_id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, load]);

  // Only ever touches status/action_notes/action_taken_at, the exact
  // columns the validate_law_enforcement_referral_update() trigger
  // permits an assigned officer to change (module9). Reload afterward so
  // the UI reflects the write immediately rather than waiting on the
  // realtime event or the next poll.
  const updateStatus = useCallback(
    async (row: LeReferralRow, status: ReferralStatus, notes?: string) => {
      const { error: err } = await supabase
        .from('law_enforcement_referrals')
        .update({ status, action_notes: notes ?? row.action_notes, action_taken_at: new Date().toISOString() })
        .eq('referral_id', row.referral_id);
      if (!err) load();
      return err;
    },
    [load]
  );

  const saveActionNotes = useCallback(
    async (row: LeReferralRow, notes: string) => {
      const { error: err } = await supabase
        .from('law_enforcement_referrals')
        .update({ action_notes: notes, action_taken_at: new Date().toISOString() })
        .eq('referral_id', row.referral_id);
      if (!err) load();
      return err;
    },
    [load]
  );

  return {
    caseReferrals,
    loading,
    refreshing,
    lastUpdated,
    error,
    reload: (isRefresh = true) => load(isRefresh),
    updateStatus,
    saveActionNotes,
  };
}

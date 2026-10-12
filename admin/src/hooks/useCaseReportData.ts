import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { dateFilterLowerBoundIso, dateFilterUpperBoundIso, type CaseReportFilters } from '../lib/reportFilters';
import type { CaseAssignment, CaseReport, ShelterReferral, SosAlert } from '../types/database.types';

/**
 * The one shared fetch/filter layer behind both the Reports tab and the
 * Analytics tab — both read from this SAME hook with the SAME filters,
 * which is what guarantees the report table's row count, the KPI
 * totals, and every chart can never drift apart (they're all derived
 * from one already-filtered, already-authorized array in memory, never
 * three independent queries that could disagree).
 *
 * Jurisdiction scoping is applied here unconditionally based on
 * roleTier — NOT from `filters` — so a municipal_admin/barangay_admin
 * can never end up querying outside their own scope no matter what
 * `filters` contains (defense-in-depth on top of RLS, which
 * independently guarantees the same thing at the database layer).
 *
 * Every other filter (date range, status, type, priority, geographic
 * drill-down for provincial_staff, referral status, assigned staff) is
 * pushed server-side via .eq()/.gte()/.lte()/.in() rather than
 * fetched-then-filtered client-side.
 */
export function useCaseReportData(filters: CaseReportFilters) {
  const { profile, roleTier } = useAuth();
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [referrals, setReferrals] = useState<ShelterReferral[]>([]);
  const [assignments, setAssignments] = useState<CaseAssignment[]>([]);
  const [sos, setSos] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);

    let caseQuery = supabase.from('case_reports').select('*');

    // Jurisdiction — always applied from the caller's own role, never
    // from `filters`. RLS enforces the same boundary independently;
    // this is what keeps the query's INTENT legible in the code and
    // avoids ever sending a request that RLS would have to silently
    // empty out.
    if (roleTier === 'barangay') {
      caseQuery = caseQuery.eq('owner_level', 'Barangay').eq('owner_barangay_id', profile?.barangay_id ?? '');
    } else if (roleTier === 'municipality') {
      caseQuery = caseQuery.eq('municipality_id', profile?.municipality_id ?? '');
    } else if (filters.municipalityId) {
      // provincial_staff drilling into one municipality
      caseQuery = caseQuery.eq('municipality_id', filters.municipalityId);
    }
    if (roleTier !== 'barangay' && filters.barangayId) {
      caseQuery = caseQuery.eq('owner_barangay_id', filters.barangayId);
    }

    if (filters.status) caseQuery = caseQuery.eq('status', filters.status);
    if (filters.caseType) caseQuery = caseQuery.eq('case_type', filters.caseType);
    if (filters.priority) caseQuery = caseQuery.eq('priority_level', filters.priority);
    if (filters.source) caseQuery = caseQuery.eq('source_channel', filters.source);
    // Manila-midnight-anchored UTC instants (see reportFilters.ts) — a
    // bare 'yyyy-mm-dd' string sent to .gte() would otherwise be cast by
    // Postgres/PostgREST using the DB session's own timezone (UTC by
    // default), not Manila's, silently shifting both boundaries by up
    // to 8 hours.
    if (filters.dateFrom) caseQuery = caseQuery.gte('reported_at', dateFilterLowerBoundIso(filters.dateFrom));
    if (filters.dateTo) caseQuery = caseQuery.lt('reported_at', dateFilterUpperBoundIso(filters.dateTo));

    caseQuery = caseQuery.order('reported_at', { ascending: false });

    const [caseRes, assignRes] = await Promise.all([
      caseQuery,
      // Assignment data is only ever visible to provincial/municipal
      // tiers under RLS (admin_can_access_case_active) — skip the call
      // entirely for barangay_admin rather than fetching a set RLS
      // would filter to empty anyway.
      roleTier === 'province' || roleTier === 'municipality'
        ? supabase.from('case_assignments').select('*').order('assigned_at', { ascending: false })
        : Promise.resolve({ data: [] as CaseAssignment[], error: null }),
    ]);

    if (caseRes.error) {
      console.error('[useCaseReportData] case_reports:', caseRes.error.message);
      setError(true);
      setLoading(false);
      return;
    }

    let caseRows = caseRes.data ?? [];
    const assignmentRows = assignRes.data ?? [];
    const caseIds = caseRows.map((c) => c.case_id);

    const referralRows =
      caseIds.length > 0
        ? (await supabase.from('shelter_referrals').select('*').in('case_id', caseIds).order('referred_at', { ascending: false })).data ?? []
        : [];

    // referralStatus / assignedTo are "intersect with this case set"
    // filters (they live on a different table) — applied as a bounded
    // in-memory post-filter over the already-authorized, already
    // server-narrowed case set, not a full-table client-side scan.
    if (filters.referralStatus) {
      const matching = new Set(referralRows.filter((r) => r.referral_status === filters.referralStatus).map((r) => r.case_id));
      caseRows = caseRows.filter((c) => matching.has(c.case_id));
    }
    if (filters.assignedTo) {
      const matching = new Set(assignmentRows.filter((a) => a.assigned_to === filters.assignedTo).map((a) => a.case_id));
      caseRows = caseRows.filter((c) => matching.has(c.case_id));
    }

    setCases(caseRows);
    setReferrals(referralRows.filter((r) => caseRows.some((c) => c.case_id === r.case_id)));
    setAssignments(assignmentRows.filter((a) => caseRows.some((c) => c.case_id === a.case_id)));

    // SOS/Emergency data — deliberately a SEPARATE query, not joined to
    // cases: sos_alerts has no case_id, only profile_id (the survivor).
    // There is no database relationship making an SOS alert "belong to"
    // a case, so it is never filtered by case status/type/priority —
    // only by the same date range + geographic scope, independently.
    // Explicit FK hint required — sos_alerts now has two FKs into
    // user_profiles (profile_id, and acknowledged_by added by module19),
    // so a bare `user_profiles(...)` embed is ambiguous and PostgREST
    // rejects it (PGRST201).
    const { data: sosData, error: sosErr } = await supabase
      .from('sos_alerts')
      .select('*, user_profiles!sos_alerts_profile_id_fkey(municipality_id)')
      .order('triggered_at', { ascending: false });
    if (!sosErr) {
      let sosRows = (sosData ?? []) as unknown as (SosAlert & { user_profiles: { municipality_id: string | null } | null })[];
      if (roleTier === 'municipality') {
        sosRows = sosRows.filter((s) => s.user_profiles?.municipality_id === profile?.municipality_id);
      } else if (roleTier !== 'barangay' && filters.municipalityId) {
        sosRows = sosRows.filter((s) => s.user_profiles?.municipality_id === filters.municipalityId);
      } else if (roleTier === 'barangay') {
        // No barangay column exists on sos_alerts/user_profiles for a
        // survivor — barangay_admin gets no SOS analytics section
        // rather than an inaccurate municipality-wide approximation
        // (see ReportsPage.tsx AnalyticsTab).
        sosRows = [];
      }
      if (filters.dateFrom) sosRows = sosRows.filter((s) => s.triggered_at >= dateFilterLowerBoundIso(filters.dateFrom));
      if (filters.dateTo) sosRows = sosRows.filter((s) => s.triggered_at < dateFilterUpperBoundIso(filters.dateTo));
      setSos(sosRows);
    }

    setLoading(false);
  }, [filters, roleTier, profile?.municipality_id, profile?.barangay_id]);

  useEffect(() => {
    load();
  }, [load]);

  return { cases, referrals, assignments, sos, loading, error, reload: load };
}

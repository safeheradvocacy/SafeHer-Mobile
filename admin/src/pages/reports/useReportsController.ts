import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { useCaseReportData } from '../../hooks/useCaseReportData';
import { buildReportRows } from '../../lib/reportRows';
import { EMPTY_FILTERS, clampFiltersToScope, computePeriodRange, type CaseReportFilters, type ReportingPeriodPreset } from '../../lib/reportFilters';
import type { DistributionRow } from '../../lib/reportDocument';
import { groupCount } from './reportsUi';
import type { Barangay, CaseStatus, Municipality, UserProfile } from '../../types/database.types';

const ACTIVE_STATUSES: CaseStatus[] = ['Assigned', 'In Progress', 'Under Review'];
const CLOSED_STATUSES: CaseStatus[] = ['Resolved', 'Closed'];
export const DETAIL_PAGE_SIZE = 25;

/**
 * The shared data/aggregation layer behind BOTH the Reports page and
 * the Analytics page (module25 split them into two independently
 * routed pages — see ReportsRouter note in App.tsx). Both pages mount
 * their own instance of this hook (own filters, own fetch) rather than
 * sharing cross-route React state — there was never a requirement that
 * Reports and Analytics show the SAME filter selection simultaneously,
 * only that each is independently reachable and that the SAME
 * aggregation logic backs both (this hook is that one implementation,
 * not two that could drift).
 */
export function useReportsController() {
  const { profile, roleTier } = useAuth();
  const isProvincial = roleTier === 'province';

  const [filters, setFilters] = useState<CaseReportFilters>(() => clampFiltersToScope(EMPTY_FILTERS, roleTier, profile));
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [staffOptions, setStaffOptions] = useState<UserProfile[]>([]);
  const [detailLimit, setDetailLimit] = useState(DETAIL_PAGE_SIZE);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);

  const { cases, referrals, assignments, sos, loading, error, reload } = useCaseReportData(filters);

  useEffect(() => {
    supabase
      .from('municipalities')
      .select('*')
      .eq('is_active', true)
      .order('municipality_name')
      .then(({ data }) => setMunicipalities(data ?? []));
  }, []);

  useEffect(() => {
    const scopeMunicipalityId = roleTier === 'municipality' || roleTier === 'barangay' ? profile?.municipality_id : filters.municipalityId;
    if (!scopeMunicipalityId) {
      setBarangays([]);
      return;
    }
    supabase
      .from('barangays')
      .select('*')
      .eq('municipality_id', scopeMunicipalityId)
      .eq('is_active', true)
      .order('barangay_name')
      .then(({ data }) => setBarangays(data ?? []));
  }, [roleTier, profile?.municipality_id, filters.municipalityId]);

  useEffect(() => {
    if (roleTier !== 'province' && roleTier !== 'municipality') {
      setStaffOptions([]);
      return;
    }
    let query = supabase.from('user_profiles').select('*').in('role', ['municipal_admin', 'barangay_admin']).eq('is_active', true);
    if (roleTier === 'municipality' && profile?.municipality_id) query = query.eq('municipality_id', profile.municipality_id);
    query.order('first_name').then(({ data }) => setStaffOptions(data ?? []));
  }, [roleTier, profile?.municipality_id]);

  useEffect(() => {
    if (!loading) setLastUpdated(Date.now());
  }, [loading]);

  useAutoRefresh(async () => {
    setPolling(true);
    await reload();
    setPolling(false);
  });

  const updateFilter = <K extends keyof CaseReportFilters>(key: K, value: CaseReportFilters[K]) => {
    setDetailLimit(DETAIL_PAGE_SIZE);
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'municipalityId') {
        next.barangayId = '';
        next.assignedTo = '';
      }
      if ((key === 'dateFrom' || key === 'dateTo') && next.periodPreset !== 'Custom') {
        next.periodPreset = 'Custom';
      }
      return clampFiltersToScope(next, roleTier, profile);
    });
  };

  const applyPeriodPreset = (preset: ReportingPeriodPreset) => {
    setDetailLimit(DETAIL_PAGE_SIZE);
    setFilters((prev) => {
      const range = computePeriodRange(preset);
      const next: CaseReportFilters = { ...prev, periodPreset: preset, ...(range ?? {}) };
      return clampFiltersToScope(next, roleTier, profile);
    });
  };

  const resetFilters = () => {
    setDetailLimit(DETAIL_PAGE_SIZE);
    setFilters(clampFiltersToScope(EMPTY_FILTERS, roleTier, profile));
  };

  const total = cases.length;
  const pending = cases.filter((c) => c.status === 'Pending').length;
  const active = cases.filter((c) => ACTIVE_STATUSES.includes(c.status)).length;
  const closed = cases.filter((c) => CLOSED_STATUSES.includes(c.status)).length;
  const referredCount = cases.filter((c) => c.status === 'Referred').length;

  const municipalityName = (id: string | null) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—';
  const barangayName = (id: string | null) => barangays.find((b) => b.barangay_id === id)?.barangay_name ?? '—';

  const byStatus: DistributionRow[] = useMemo(() => groupCount(cases, (c) => c.status), [cases]);
  const byType: DistributionRow[] = useMemo(() => groupCount(cases, (c) => c.case_type), [cases]);
  const byMunicipality: DistributionRow[] = useMemo(
    () => municipalities.map((m) => ({ label: m.municipality_name, count: cases.filter((c) => c.municipality_id === m.municipality_id).length })).filter((r) => r.count > 0),
    [municipalities, cases]
  );
  const byBarangay: DistributionRow[] = useMemo(
    () => barangays.map((b) => ({ label: b.barangay_name, count: cases.filter((c) => c.owner_barangay_id === b.barangay_id).length })).filter((r) => r.count > 0),
    [barangays, cases]
  );
  const bySource: DistributionRow[] = useMemo(() => groupCount(cases, (c) => c.source_channel), [cases]);
  const referralByStatus: DistributionRow[] = useMemo(() => groupCount(referrals, (r) => r.referral_status), [referrals]);
  const sosByStatus: DistributionRow[] = useMemo(() => groupCount(sos, (s) => s.status), [sos]);
  const geographicDistribution = roleTier === 'province' ? byMunicipality : roleTier === 'municipality' ? byBarangay : null;
  const geographicLabel = roleTier === 'province' ? 'by Municipality' : 'by Barangay';

  const reportRows = useMemo(
    () => buildReportRows(cases, referrals, assignments, staffOptions, municipalityName, barangayName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cases, referrals, assignments, staffOptions, municipalities, barangays]
  );

  const scopeLabel =
    roleTier === 'province' ? 'Aurora Province' : roleTier === 'municipality' ? municipalityName(profile?.municipality_id ?? null) || 'Your municipality' : roleTier === 'barangay' ? 'Your barangay' : '—';

  const appliedFilterLines = useMemo(() => {
    const lines: string[] = [];
    if (filters.status) lines.push(`Status: ${filters.status}`);
    if (filters.caseType) lines.push(`Case Type: ${filters.caseType}`);
    if (filters.priority) lines.push(`Priority: ${filters.priority}`);
    if (filters.municipalityId) lines.push(`Municipality: ${municipalityName(filters.municipalityId)}`);
    if (filters.barangayId) lines.push(`Barangay: ${barangayName(filters.barangayId)}`);
    if (filters.assignedTo) {
      const s = staffOptions.find((x) => x.profile_id === filters.assignedTo);
      lines.push(`Assigned Staff: ${s ? `${s.first_name} ${s.last_name}` : filters.assignedTo}`);
    }
    if (filters.referralStatus) lines.push(`Referral Status: ${filters.referralStatus}`);
    if (filters.source) lines.push(`Report Source: ${filters.source}`);
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, municipalities, barangays, staffOptions]);

  return {
    profile,
    roleTier,
    isProvincial,
    filters,
    setFilters,
    updateFilter,
    applyPeriodPreset,
    resetFilters,
    municipalities,
    barangays,
    staffOptions,
    detailLimit,
    setDetailLimit,
    lastUpdated,
    polling,
    cases,
    referrals,
    assignments,
    sos,
    loading,
    error,
    reload,
    total,
    pending,
    active,
    closed,
    referredCount,
    municipalityName,
    barangayName,
    byStatus,
    byType,
    bySource,
    geographicDistribution,
    geographicLabel,
    referralByStatus,
    sosByStatus,
    reportRows,
    scopeLabel,
    appliedFilterLines,
  };
}

export type ReportsController = ReturnType<typeof useReportsController>;

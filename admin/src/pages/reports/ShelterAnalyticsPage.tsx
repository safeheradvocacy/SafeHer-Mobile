import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { Home, Users, Download, ClipboardList, ArrowLeftRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { downloadCsv } from '../../lib/exportCsv';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader, EmptyState } from '../../components/ui';
import { groupCount, KpiCard, KpiSkeletonCard, ChartCard } from './reportsUi';
import type { Shelter, ShelterRequest, ShelterReferral } from '../../types/database.types';

type ReferralRow = ShelterReferral & { case_reports?: { case_number: string } | null };

/**
 * Shelter Admin / Shelter Staff Reports & Analytics (module24). Shared
 * by both roles — RLS grants both shelter-wide SELECT on
 * shelter_requests/shelter_referrals (shelter_id = current_shelter_id()),
 * same scope the dashboard precedent documents (module7); only the
 * optional "Assigned to me" toggle narrows further, it never widens
 * past this shelter.
 *
 * Capacity/occupancy are real, directly-maintained columns on
 * `shelters` (not derived or fabricated) — shown as-is.
 */
export function ShelterAnalyticsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const reducedMotion = usePrefersReducedMotion();

  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [requests, setRequests] = useState<ShelterRequest[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!profile?.shelter_id) {
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    const [shelterRes, reqRes, refRes] = await Promise.all([
      supabase.from('shelters').select('*').eq('shelter_id', profile.shelter_id).single(),
      supabase.from('shelter_requests').select('*').eq('shelter_id', profile.shelter_id).order('created_at', { ascending: false }),
      supabase.from('shelter_referrals').select('*, case_reports(case_number)').eq('shelter_id', profile.shelter_id).order('referred_at', { ascending: false }),
    ]);
    setShelter((shelterRes.data as Shelter | null) ?? null);
    setRequests(reqRes.data ?? []);
    setReferrals((refRes.data as ReferralRow[] | null) ?? []);
    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());
  }, [profile?.shelter_id]);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true));

  const inRange = (iso: string) => {
    if (dateFrom && iso < `${dateFrom}T00:00:00`) return false;
    if (dateTo && iso >= `${dateTo}T23:59:59.999`) return false;
    return true;
  };

  const filteredRequests = useMemo(
    () => requests.filter((r) => inRange(r.created_at) && (!assignedOnly || r.assigned_staff_id === profile?.profile_id)),
    [requests, dateFrom, dateTo, assignedOnly, profile?.profile_id]
  );
  const filteredReferrals = useMemo(
    () => referrals.filter((r) => inRange(r.referred_at) && (!assignedOnly || r.assigned_staff_id === profile?.profile_id)),
    [referrals, dateFrom, dateTo, assignedOnly, profile?.profile_id]
  );

  const REQUEST_TERMINAL = ['Declined', 'Cancelled', 'Placement Confirmed', 'Completed'];
  const requestsByStatus = useMemo(() => groupCount(filteredRequests, (r) => r.status), [filteredRequests]);
  const referralsByStatus = useMemo(() => groupCount(filteredReferrals, (r) => r.referral_status), [filteredReferrals]);
  const openRequests = filteredRequests.filter((r) => !REQUEST_TERMINAL.includes(r.status)).length;
  const openReferrals = filteredReferrals.filter((r) => r.referral_status === 'Pending' || r.referral_status === 'Accepted').length;

  const doughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }),
    [reducedMotion]
  );
  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }),
    [reducedMotion]
  );

  const exportRequests = () => {
    const filename = `shelter-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      filename,
      filteredRequests.map((r) => ({ request_id: r.request_id, status: r.status, urgency: r.urgency, people_count: r.people_count, children_count: r.children_count, created_at: r.created_at })),
      [
        { key: 'request_id', label: 'Request ID' },
        { key: 'status', label: 'Status' },
        { key: 'urgency', label: 'Urgency' },
        { key: 'people_count', label: 'People' },
        { key: 'children_count', label: 'Children' },
        { key: 'created_at', label: 'Requested At' },
      ]
    );
    if (profile) logAudit({ profileId: profile.profile_id, action: 'REPORT_EXPORT_CSV', tableName: 'shelter_requests', recordId: profile.profile_id, newValues: { filename, rowCount: filteredRequests.length } });
    showToast('success', `Exported ${filename}.`);
  };

  const exportReferrals = () => {
    const filename = `shelter-referrals-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      filename,
      filteredReferrals.map((r) => ({ referral_id: r.referral_id, case_number: r.case_reports?.case_number ?? '', status: r.referral_status, referred_at: r.referred_at })),
      [
        { key: 'referral_id', label: 'Referral ID' },
        { key: 'case_number', label: 'Case #' },
        { key: 'status', label: 'Status' },
        { key: 'referred_at', label: 'Referred At' },
      ]
    );
    if (profile) logAudit({ profileId: profile.profile_id, action: 'REPORT_EXPORT_CSV', tableName: 'shelter_referrals', recordId: profile.profile_id, newValues: { filename, rowCount: filteredReferrals.length } });
    showToast('success', `Exported ${filename}.`);
  };

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Shelter Analytics" />
        <EmptyState title="No shelter assignment on file" subtitle="This account has no shelter_id set — contact a provincial administrator." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Shelter Operations Analytics"
        subtitle={shelter ? `${shelter.shelter_name} — interactive metrics for this shelter. For a formatted, exportable document, see Reports.` : 'Loading shelter...'}
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        {loading || !shelter ? (
          Array.from({ length: 3 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={Home} label="Capacity" value={shelter.capacity} context="Maintained on the shelter record" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={Users} label="Current Occupancy" value={shelter.current_occupancy} context="Maintained on the shelter record" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
            <KpiCard
              icon={Home}
              label="Available Beds"
              value={Math.max(shelter.capacity - shelter.current_occupancy, 0)}
              context="Capacity − current occupancy"
              color="var(--color-success)"
              tint="var(--kpi-tint-success)"
              iconBg="var(--kpi-icon-success)"
              loading={loading}
            />
          </>
        )}
      </div>

      <div className="card report-filters-card report-no-print" style={{ marginBottom: 20 }}>
        <div className="report-filter-grid">
          <div className="report-filter-field">
            <label>From date</label>
            <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="report-filter-field">
            <label>To date</label>
            <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="report-filter-field">
            <label>Scope</label>
            <select className="input" value={assignedOnly ? 'mine' : 'all'} onChange={(e) => setAssignedOnly(e.target.value === 'mine')}>
              <option value="all">This shelter (all)</option>
              <option value="mine">Assigned to me only</option>
            </select>
          </div>
        </div>
        {(dateFrom || dateTo || assignedOnly) && (
          <div className="report-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); setAssignedOnly(false); }}>
              Reset
            </button>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Shelter Requests Analytics</h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>Direct survivor requests for this shelter — a request is not a case and not a referral.</p>
      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 16 }}>
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={ClipboardList} label="Total Requests" value={filteredRequests.length} context="Matching selected scope/period" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={ClipboardList} label="Open / In Progress" value={openRequests} context="Not yet declined, cancelled, placed, or completed" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
          </>
        )}
      </div>
      <div className="dash-chart-row dash-chart-row-2" style={{ marginBottom: 20 }}>
        <ChartCard title="Requests by Status" data={requestsByStatus} options={doughnutOptions} loading={loading} emptyText="No shelter requests match the selected scope/period." />
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}>Status Breakdown</h3>
            <button className="btn btn-outline btn-sm report-no-print" onClick={exportRequests} disabled={filteredRequests.length === 0}>
              <Download size={13} /> Export CSV
            </button>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : requestsByStatus.length === 0 ? (
            <div className="dash-chart-empty"><p>No shelter requests match the selected scope/period.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 180 }}>
              <Bar data={{ labels: requestsByStatus.map((s) => s.label), datasets: [{ label: 'Requests', data: requestsByStatus.map((s) => s.count), backgroundColor: '#1456A0', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
            </div>
          )}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '24px 0' }} />

      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Shelter Referrals Analytics</h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>Case-level referrals from municipal/provincial/barangay staff into this shelter.</p>
      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 16 }}>
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={ArrowLeftRight} label="Total Referrals" value={filteredReferrals.length} context="Matching selected scope/period" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={ArrowLeftRight} label="Pending / Accepted" value={openReferrals} context="Not yet declined or completed" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
          </>
        )}
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Referral Detail</h3>
          <button className="btn btn-outline btn-sm report-no-print" onClick={exportReferrals} disabled={filteredReferrals.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : filteredReferrals.length === 0 ? (
          <EmptyState title="No shelter referrals match the selected scope/period." />
        ) : (
          <div className="chart-box" style={{ height: 180 }}>
            <Bar data={{ labels: referralsByStatus.map((s) => s.label), datasets: [{ label: 'Referrals', data: referralsByStatus.map((s) => s.count), backgroundColor: '#4C82B3', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
          </div>
        )}
      </div>
    </div>
  );
}

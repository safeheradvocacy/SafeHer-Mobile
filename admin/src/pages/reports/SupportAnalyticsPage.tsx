import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { MessageCircleHeart, Download, Clock3, CheckCircle2 } from 'lucide-react';
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
import type { ExpertSupportRequest } from '../../types/database.types';

const CLOSED: ExpertSupportRequest['status'][] = ['CLOSED'];

/**
 * Support Expert Reports & Analytics (module24). Scoped to
 * assigned_expert_id = current_profile_id() — the same assignment-only
 * model the Support Expert Dashboard already uses (no shelter-wide-
 * style shared queue exists for this role, by design: see
 * SupportExpertDashboard.tsx's header).
 *
 * Deliberately shows only request/session counts, status, and
 * handling-time — SafeSpace records none of counseling-session
 * content, clinical outcomes, or satisfaction scores, so none of
 * those are shown here (would otherwise be fabricated).
 */
export function SupportAnalyticsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const reducedMotion = usePrefersReducedMotion();

  const [requests, setRequests] = useState<ExpertSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (!profile) return;
    if (isRefresh) setRefreshing(true);
    const { data, error } = await supabase
      .from('expert_support_requests')
      .select('*')
      .eq('assigned_expert_id', profile.profile_id)
      .order('requested_at', { ascending: false });
    if (!error) setRequests(data ?? []);
    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true));

  const inRange = (iso: string) => {
    if (dateFrom && iso < `${dateFrom}T00:00:00`) return false;
    if (dateTo && iso >= `${dateTo}T23:59:59.999`) return false;
    return true;
  };

  const filtered = useMemo(() => requests.filter((r) => inRange(r.requested_at)), [requests, dateFrom, dateTo]);

  const byStatus = useMemo(() => groupCount(filtered, (r) => r.status), [filtered]);
  const byPriority = useMemo(() => groupCount(filtered, (r) => r.priority), [filtered]);
  const closedCount = filtered.filter((r) => CLOSED.includes(r.status)).length;
  const activeCount = filtered.length - closedCount;

  const avgHandlingMinutes = useMemo(() => {
    const done = filtered.filter((r) => r.closed_at && r.accepted_at);
    if (done.length === 0) return null;
    const total = done.reduce((sum, r) => sum + (new Date(r.closed_at as string).getTime() - new Date(r.accepted_at as string).getTime()) / 60000, 0);
    return Math.round(total / done.length);
  }, [filtered]);

  const doughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }),
    [reducedMotion]
  );
  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }),
    [reducedMotion]
  );

  const exportCsv = () => {
    const filename = `support-conversations-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      filename,
      filtered.map((r) => ({
        request_id: r.request_id,
        status: r.status,
        priority: r.priority,
        requested_at: r.requested_at,
        assigned_at: r.assigned_at ?? '',
        accepted_at: r.accepted_at ?? '',
        closed_at: r.closed_at ?? '',
      })),
      [
        { key: 'request_id', label: 'Request ID' },
        { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' },
        { key: 'requested_at', label: 'Requested At' },
        { key: 'assigned_at', label: 'Assigned At' },
        { key: 'accepted_at', label: 'Accepted At' },
        { key: 'closed_at', label: 'Closed At' },
      ]
    );
    if (profile) logAudit({ profileId: profile.profile_id, action: 'REPORT_EXPORT_CSV', tableName: 'expert_support_requests', recordId: profile.profile_id, newValues: { filename, rowCount: filtered.length } });
    showToast('success', `Exported ${filename}.`);
  };

  return (
    <div>
      <PageHeader
        title="My Support Analytics"
        subtitle="Interactive metrics for support conversations assigned to you. No clinical outcomes or satisfaction data exist in SafeSpace today, so none are shown. For a formatted, exportable document, see Reports."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

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
        </div>
        {(dateFrom || dateTo) && (
          <div className="report-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={MessageCircleHeart} label="Total Assigned" value={filtered.length} context="Matching selected period" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={MessageCircleHeart} label="Active" value={activeCount} context="Not yet closed" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
            <KpiCard icon={CheckCircle2} label="Closed" value={closedCount} context="Status = CLOSED" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} />
            <KpiCard
              icon={Clock3}
              label="Avg. Handling Time"
              value={avgHandlingMinutes ?? 0}
              context={avgHandlingMinutes == null ? 'No closed conversations yet' : 'Minutes, accepted → closed'}
              color="var(--color-info)"
              tint="var(--kpi-tint-info)"
              iconBg="var(--kpi-icon-info)"
              loading={loading}
            />
          </>
        )}
      </div>

      <div className="dash-chart-row dash-chart-row-2" style={{ marginBottom: 20 }}>
        <ChartCard title="By Status" data={byStatus} options={doughnutOptions} loading={loading} emptyText="No assigned conversations match the selected period." />
        <ChartCard title="By Priority" data={byPriority} options={doughnutOptions} loading={loading} emptyText="No assigned conversations match the selected period." />
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Request Volume</h3>
          <button className="btn btn-outline btn-sm report-no-print" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : byStatus.length === 0 ? (
          <EmptyState title="No assigned conversations match the selected period." />
        ) : (
          <div className="chart-box" style={{ height: 180 }}>
            <Bar data={{ labels: byStatus.map((s) => s.label), datasets: [{ label: 'Requests', data: byStatus.map((s) => s.count), backgroundColor: '#4C82B3', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
          </div>
        )}
      </div>
    </div>
  );
}

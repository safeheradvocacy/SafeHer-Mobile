import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { MessageCircleHeart, Eye, FileText, Printer, Clock3, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader, EmptyState } from '../../components/ui';
import { groupCount, KpiCard, KpiSkeletonCard, ChartCard } from './reportsUi';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { captureChartImage } from '../../lib/captureChartImage';
import { generateAnalyticsPdf, type AnalyticsChartSection } from '../../lib/analyticsReportDocument';
import { buildAnalyticsReportFilename } from '../../lib/reportFilename';
import { isWithinDateFilter } from '../../lib/reportFilters';
import { usePdfReportActions } from '../../hooks/usePdfReportActions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';
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

  const filtered = useMemo(() => requests.filter((r) => isWithinDateFilter(r.requested_at, dateFrom, dateTo)), [requests, dateFrom, dateTo]);

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

  const statusChartRef = useRef<HTMLDivElement>(null);
  const priorityChartRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const buildPdfDocument = async () => {
    const charts: AnalyticsChartSection[] = [
      { title: 'Support Requests by Status', image: captureChartImage(statusChartRef.current), tableRows: byStatus },
      { title: 'Support Requests by Priority', image: captureChartImage(priorityChartRef.current), tableRows: byPriority },
      { title: 'Request Volume', image: captureChartImage(volumeBarRef.current), tableRows: byStatus },
    ];
    return generateAnalyticsPdf({
      documentKicker: 'SUPPORT ANALYTICS REPORT',
      reportTitle: 'My Support Analytics',
      runningHeaderTitle: 'SAFESPACE — SUPPORT ANALYTICS REPORT',
      footerLabel: 'SafeSpace — Support Analytics Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      // Assignment-only scope (assigned_expert_id = current_profile_id())
      // — never a shared queue, matching this role's real RLS/dashboard
      // precedent (see this file's own header note).
      scopeLabel: 'Conversations assigned to me',
      dateFrom,
      dateTo,
      appliedFilterLines: [dateFrom && `From: ${dateFrom}`, dateTo && `To: ${dateTo}`].filter(Boolean) as string[],
      // No clinical outcome, satisfaction, or counseling-content metric
      // is included — none of that is recorded anywhere in SafeSpace
      // (see this file's own header note); including one here would be
      // exactly the kind of fabrication the brief warns against.
      kpis: [
        { label: 'Total Assigned', count: filtered.length },
        { label: 'Active', count: activeCount },
        { label: 'Closed', count: closedCount },
      ],
      charts,
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildAnalyticsReportFilename('Support', dateFrom, dateTo),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'expert_support_requests', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo } });
    },
  });

  const handleExportPdf = async () => {
    try {
      const filename = await pdfActions.exportPdf();
      if (filename) showToast('success', `Report exported successfully as ${filename}.`);
    } catch {
      showToast('error', 'Unable to generate the PDF report. Please try again.');
    }
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

      <div className="report-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={pdfActions.view} disabled={loading || pdfActions.busy}>
          <Eye size={13} /> {pdfActions.state === 'viewing' ? 'Generating…' : 'View PDF'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleExportPdf} disabled={loading || pdfActions.busy}>
          <FileText size={13} /> {pdfActions.state === 'exporting' ? 'Generating…' : 'Export PDF'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={pdfActions.printPdf} disabled={loading || pdfActions.busy}>
          <Printer size={13} /> {pdfActions.state === 'printing' ? 'Preparing…' : 'Print PDF'}
        </button>
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
        <ChartCard title="By Status" data={byStatus} options={doughnutOptions} loading={loading} emptyText="No assigned conversations match the selected period." chartBoxRef={statusChartRef} />
        <ChartCard title="By Priority" data={byPriority} options={doughnutOptions} loading={loading} emptyText="No assigned conversations match the selected period." chartBoxRef={priorityChartRef} />
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>Request Volume</h3>
        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : byStatus.length === 0 ? (
          <EmptyState title="No assigned conversations match the selected period." />
        ) : (
          <div className="chart-box" style={{ height: 180 }} ref={volumeBarRef}>
            <Bar data={{ labels: byStatus.map((s) => s.label), datasets: [{ label: 'Requests', data: byStatus.map((s) => s.count), backgroundColor: '#4C82B3', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
          </div>
        )}
      </div>

      {pdfActions.viewerOpen && (
        <PdfViewerModal
          title="My Support Analytics"
          pdfUrl={pdfActions.viewerUrl}
          error={pdfActions.viewerError}
          onClose={pdfActions.closeViewer}
          onExport={handleExportPdf}
          onPrint={pdfActions.printViewerDoc}
          printing={pdfActions.printing}
        />
      )}
    </div>
  );
}

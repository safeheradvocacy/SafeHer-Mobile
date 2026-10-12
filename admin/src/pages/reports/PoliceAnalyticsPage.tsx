import React, { useMemo, useRef, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { ClipboardList, Siren, Eye, FileText, Printer, Clock3, Activity, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAudit } from '../../lib/audit';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { usePoliceSosAlerts, sosElapsedMinutes } from '../../hooks/usePoliceSosAlerts';
import { bucketOf as caseBucketOf, useLawEnforcementReferrals } from '../../hooks/useLawEnforcementReferrals';
import { isWithinDateFilter } from '../../lib/reportFilters';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader, StatusBadge } from '../../components/ui';
import { groupCount, KpiCard, KpiSkeletonCard, ChartCard } from './reportsUi';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { captureChartImage } from '../../lib/captureChartImage';
import { generateAnalyticsPdf, type AnalyticsChartSection } from '../../lib/analyticsReportDocument';
import { buildAnalyticsReportFilename } from '../../lib/reportFilename';
import { usePdfReportActions } from '../../hooks/usePdfReportActions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';

/**
 * Police Officer Reports & Analytics (module24).
 *
 * Reuses the exact same RLS-scoped data as the Police Dashboard
 * (usePoliceSosAlerts/useLawEnforcementReferrals) instead of the
 * case_reports-centric useCaseReportData — this role's RLS grants no
 * general case_reports access, so that hook would return nothing
 * useful here. No jurisdiction/geographic filter is offered: there is
 * no precinct/station/unit concept anywhere in this schema for police
 * (confirmed repo-wide), so SOS access is province-wide and referral
 * access is assignment-only — inventing a geographic filter would be
 * fabricating a control over data that doesn't exist.
 *
 * SOS and Incident Referrals are kept in two clearly separate sections
 * with separate exports — an SOS alert is never a case referral, and
 * the two must never be merged into one count or one export row.
 */
export function PoliceAnalyticsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { alerts, loading: sosLoading, refreshing: sosRefreshing, lastUpdated: sosUpdated, reload: reloadSos } = usePoliceSosAlerts();
  const {
    caseReferrals,
    loading: refLoading,
    refreshing: refRefreshing,
    lastUpdated: refUpdated,
    reload: reloadRef,
  } = useLawEnforcementReferrals();

  const loading = sosLoading || refLoading;
  const refreshing = sosRefreshing || refRefreshing;
  const lastUpdated = Math.max(sosUpdated ?? 0, refUpdated ?? 0) || null;
  const onRefresh = () => {
    reloadSos(true);
    reloadRef(true);
  };

  const filteredAlerts = useMemo(() => alerts.filter((a) => isWithinDateFilter(a.triggered_at, dateFrom, dateTo)), [alerts, dateFrom, dateTo]);
  const filteredReferrals = useMemo(() => caseReferrals.filter((r) => isWithinDateFilter(r.created_at, dateFrom, dateTo)), [caseReferrals, dateFrom, dateTo]);

  const sosBuckets = useMemo(() => {
    let active = 0, completed = 0;
    for (const a of filteredAlerts) {
      if (a.status === 'Resolved') completed++;
      else active++;
    }
    return { active, completed, total: filteredAlerts.length };
  }, [filteredAlerts]);

  const avgAckMinutes = useMemo(() => {
    const acked = filteredAlerts.filter((a) => a.acknowledged_at);
    if (acked.length === 0) return null;
    const total = acked.reduce((sum, a) => sum + (new Date(a.acknowledged_at as string).getTime() - new Date(a.triggered_at).getTime()) / 60000, 0);
    return Math.round(total / acked.length);
  }, [filteredAlerts]);

  const sosByStatus = useMemo(() => groupCount(filteredAlerts, (a) => a.status), [filteredAlerts]);

  const referralBuckets = useMemo(() => {
    let active = 0, completed = 0;
    for (const r of filteredReferrals) {
      if (caseBucketOf(r) === 'completed') completed++;
      else active++;
    }
    return { active, completed, total: filteredReferrals.length };
  }, [filteredReferrals]);

  const referralsByStatus = useMemo(() => groupCount(filteredReferrals, (r) => r.status), [filteredReferrals]);

  const doughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }),
    [reducedMotion]
  );

  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }),
    [reducedMotion]
  );

  const sosChartRef = useRef<HTMLDivElement>(null);
  const sosBarRef = useRef<HTMLDivElement>(null);

  const buildPdfDocument = async () => {
    const charts: AnalyticsChartSection[] = [
      { title: 'SOS Alerts by Status', image: captureChartImage(sosChartRef.current), tableRows: sosByStatus },
      { title: 'SOS Alerts — Status Breakdown', image: captureChartImage(sosBarRef.current), tableRows: sosByStatus },
      // No chart exists on screen for referrals (just the Referral
      // Detail table) — image: null correctly falls back to the table
      // alone rather than fabricating a chart that was never rendered.
      { title: 'Incident Referrals by Status', image: null, tableRows: referralsByStatus, valueLabel: 'Referrals' },
    ];
    return generateAnalyticsPdf({
      documentKicker: 'POLICE ANALYTICS REPORT',
      reportTitle: 'Emergency Response & Police Analytics',
      runningHeaderTitle: 'SAFESPACE — POLICE ANALYTICS REPORT',
      footerLabel: 'SafeSpace — Police Analytics Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      // No precinct/station/unit concept exists anywhere in this schema
      // for law_enforcement (module9) — SOS access is province-wide and
      // referral access is assignment-only, exactly as the on-screen
      // page's own header note says; this scope label states that
      // rather than fabricating a jurisdiction this role doesn't have.
      scopeLabel: 'Aurora Province (Emergency SOS) · Assigned Incident Referrals',
      dateFrom,
      dateTo,
      appliedFilterLines: [dateFrom && `From: ${dateFrom}`, dateTo && `To: ${dateTo}`].filter(Boolean) as string[],
      kpis: [
        { label: 'Total SOS Alerts', count: sosBuckets.total },
        { label: 'Active / Unresolved SOS', count: sosBuckets.active },
        { label: 'Resolved SOS', count: sosBuckets.completed },
        { label: 'Total Referrals (Assigned to Me)', count: referralBuckets.total },
        { label: 'Pending / In Progress Referrals', count: referralBuckets.active },
        { label: 'Completed / Declined Referrals', count: referralBuckets.completed },
      ],
      charts,
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildAnalyticsReportFilename('Police', dateFrom, dateTo),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'sos_alerts', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo } });
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
        title="Emergency Response & Police Analytics"
        subtitle="Interactive metrics for province-wide Emergency SOS alerts and your assigned incident referrals. For a formatted, exportable document, see Reports."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
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

      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Emergency SOS Analytics</h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Every active SOS alert is visible to every police officer (module19) — this is independent of, and never automatically converted into, a case referral.
      </p>
      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={Siren} label="Total SOS Alerts" value={sosBuckets.total} context="Matching selected period" color="var(--color-danger)" tint="var(--kpi-tint-danger)" iconBg="var(--kpi-icon-danger)" loading={loading} />
            <KpiCard icon={Activity} label="Active / Unresolved" value={sosBuckets.active} context="Triggered or Responding" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
            <KpiCard icon={CheckCircle2} label="Resolved" value={sosBuckets.completed} context="Status = Resolved" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} />
            <KpiCard
              icon={Clock3}
              label="Avg. Time to Acknowledge"
              value={avgAckMinutes ?? 0}
              context={avgAckMinutes == null ? 'No acknowledged alerts yet' : 'Minutes, acknowledged alerts only'}
              color="var(--color-info)"
              tint="var(--kpi-tint-info)"
              iconBg="var(--kpi-icon-info)"
              loading={loading}
            />
          </>
        )}
      </div>
      <div className="dash-chart-row dash-chart-row-2" style={{ marginBottom: 12 }}>
        <ChartCard title="SOS Alerts by Status" data={sosByStatus} options={doughnutOptions} loading={loading} emptyText="No SOS alerts match the selected period." chartBoxRef={sosChartRef} />
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 16 }}>Status Breakdown</h3>
          {loading ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : sosByStatus.length === 0 ? (
            <div className="dash-chart-empty"><p>No SOS alerts match the selected period.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 180 }} ref={sosBarRef}>
              <Bar data={{ labels: sosByStatus.map((s) => s.label), datasets: [{ label: 'SOS Alerts', data: sosByStatus.map((s) => s.count), backgroundColor: '#D94B63', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
            </div>
          )}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '24px 0' }} />

      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Incident Referral Analytics</h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Case-level referrals assigned to you specifically — there is no shared referral queue for this role. Separate concept from Emergency SOS above; one referral is never one SOS alert and vice versa.
      </p>
      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={ClipboardList} label="Total Referrals (Assigned to Me)" value={referralBuckets.total} context="Matching selected period" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={Activity} label="Pending / In Progress" value={referralBuckets.active} context="Not yet completed or declined" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
            <KpiCard icon={CheckCircle2} label="Completed / Declined" value={referralBuckets.completed} context="Final status reached" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} />
          </>
        )}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>Referral Detail</h3>
        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : filteredReferrals.length === 0 ? (
          <div className="dash-chart-empty"><p>No incident referrals match the selected period.</p></div>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Referred</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredReferrals.slice(0, 50).map((r) => (
                  <tr key={r.referral_id}>
                    <td>{r.case_reports?.case_number ?? '—'}</td>
                    <td>{new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td><StatusBadge label={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pdfActions.viewerOpen && (
        <PdfViewerModal
          title="Emergency Response & Police Analytics"
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

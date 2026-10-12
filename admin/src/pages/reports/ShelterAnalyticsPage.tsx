import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { Home, Users, Eye, FileText, Printer, ClipboardList, ArrowLeftRight } from 'lucide-react';
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

  const filteredRequests = useMemo(
    () => requests.filter((r) => isWithinDateFilter(r.created_at, dateFrom, dateTo) && (!assignedOnly || r.assigned_staff_id === profile?.profile_id)),
    [requests, dateFrom, dateTo, assignedOnly, profile?.profile_id]
  );
  const filteredReferrals = useMemo(
    () => referrals.filter((r) => isWithinDateFilter(r.referred_at, dateFrom, dateTo) && (!assignedOnly || r.assigned_staff_id === profile?.profile_id)),
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

  const requestsChartRef = useRef<HTMLDivElement>(null);
  const requestsBarRef = useRef<HTMLDivElement>(null);
  const referralsBarRef = useRef<HTMLDivElement>(null);

  const buildPdfDocument = async () => {
    const charts: AnalyticsChartSection[] = [
      { title: 'Shelter Requests by Status', image: captureChartImage(requestsChartRef.current), tableRows: requestsByStatus },
      { title: 'Shelter Requests — Status Breakdown', image: captureChartImage(requestsBarRef.current), tableRows: requestsByStatus },
      { title: 'Shelter Referrals by Status', image: captureChartImage(referralsBarRef.current), tableRows: referralsByStatus, valueLabel: 'Referrals' },
    ];
    return generateAnalyticsPdf({
      documentKicker: 'SHELTER ANALYTICS REPORT',
      reportTitle: 'Shelter Operations Analytics',
      runningHeaderTitle: 'SAFESPACE — SHELTER ANALYTICS REPORT',
      footerLabel: 'SafeSpace — Shelter Analytics Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      // Explicitly the ONE assigned shelter, never every shelter in the
      // province — same scoping the on-screen page and its RLS already
      // enforce (shelter_id = current_shelter_id()).
      scopeLabel: shelter ? shelter.shelter_name : 'Assigned shelter',
      dateFrom,
      dateTo,
      appliedFilterLines: [
        dateFrom && `From: ${dateFrom}`,
        dateTo && `To: ${dateTo}`,
        assignedOnly && 'Scope: Assigned to me only',
      ].filter(Boolean) as string[],
      kpis: [
        { label: 'Capacity', count: shelter?.capacity ?? 0 },
        { label: 'Current Occupancy', count: shelter?.current_occupancy ?? 0 },
        { label: 'Available Beds', count: shelter ? Math.max(shelter.capacity - shelter.current_occupancy, 0) : 0 },
        { label: 'Total Requests', count: filteredRequests.length },
        { label: 'Open / In Progress Requests', count: openRequests },
        { label: 'Total Referrals', count: filteredReferrals.length },
        { label: 'Pending / Accepted Referrals', count: openReferrals },
      ],
      charts,
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildAnalyticsReportFilename('Shelter', dateFrom, dateTo),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'shelter_requests', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo } });
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
        <ChartCard title="Requests by Status" data={requestsByStatus} options={doughnutOptions} loading={loading} emptyText="No shelter requests match the selected scope/period." chartBoxRef={requestsChartRef} />
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 16 }}>Status Breakdown</h3>
          {loading ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : requestsByStatus.length === 0 ? (
            <div className="dash-chart-empty"><p>No shelter requests match the selected scope/period.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 180 }} ref={requestsBarRef}>
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
        <h3 style={{ fontSize: 15, marginBottom: 16 }}>Referral Detail</h3>
        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : filteredReferrals.length === 0 ? (
          <EmptyState title="No shelter referrals match the selected scope/period." />
        ) : (
          <div className="chart-box" style={{ height: 180 }} ref={referralsBarRef}>
            <Bar data={{ labels: referralsByStatus.map((s) => s.label), datasets: [{ label: 'Referrals', data: referralsByStatus.map((s) => s.count), backgroundColor: '#4C82B3', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
          </div>
        )}
      </div>

      {pdfActions.viewerOpen && (
        <PdfViewerModal
          title="Shelter Operations Analytics"
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

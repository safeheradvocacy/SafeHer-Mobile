import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAudit } from '../../lib/audit';
import { buildReportFilename } from '../../lib/reportFilename';
import { generateRoleReportPdf, reportingPeriodLabel } from '../../lib/reportDocument';
import { usePdfReportActions } from '../../hooks/usePdfReportActions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';
import { usePoliceSosAlerts } from '../../hooks/usePoliceSosAlerts';
import { bucketOf as caseBucketOf, useLawEnforcementReferrals } from '../../hooks/useLawEnforcementReferrals';
import { isWithinDateFilter } from '../../lib/reportFilters';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader } from '../../components/ui';
import { groupCount } from './reportsUi';
import { ROLE_LABEL } from '../../lib/roleLabels';
import type { SosAlert } from '../../types/database.types';

/**
 * Police Officer Reports (module25) — the document-oriented sibling of
 * PoliceAnalyticsPage.tsx, independently routed at /admin/reports
 * (PoliceAnalyticsPage stays at /admin/analytics). Same two RLS-scoped
 * data sources, but packaged as a real, paginated PDF via the shared
 * generateRoleReportPdf renderer (reportDocument.ts) — not a screenshot,
 * not a duplicate of the Analytics charts.
 */
export function PoliceReportsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportTitle, setReportTitle] = useState('Police Activity Report');

  // Certification signatories — same pattern as ReportsPage.tsx's WEDC
  // export (typed in by the preparer, never auto-filled beyond the
  // signed-in officer's own verified name). "Prepared by" defaults to
  // the generating officer since that's genuinely verified data; the
  // other two have no equivalent source anywhere in this schema (no
  // PNP rank/station/supervisor concept exists — see module9's own
  // header notes) and stay blank until a preparer fills them in.
  const [preparedBy, setPreparedBy] = useState('');
  const [certifiedBy, setCertifiedBy] = useState('');
  const [notedBy, setNotedBy] = useState('');

  // Pre-fill once, from the signed-in officer's own verified name — never
  // overwrites a value the preparer has since typed/edited.
  useEffect(() => {
    if (profile && !preparedBy) setPreparedBy(`${profile.first_name} ${profile.last_name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const { alerts, loading: sosLoading, refreshing: sosRefreshing, lastUpdated: sosUpdated, reload: reloadSos } = usePoliceSosAlerts();
  const { caseReferrals, loading: refLoading, refreshing: refRefreshing, lastUpdated: refUpdated, reload: reloadRef } = useLawEnforcementReferrals();

  const loading = sosLoading || refLoading;
  const refreshing = sosRefreshing || refRefreshing;
  const lastUpdated = Math.max(sosUpdated ?? 0, refUpdated ?? 0) || null;
  const onRefresh = () => {
    reloadSos(true);
    reloadRef(true);
  };

  const filteredAlerts = useMemo(() => alerts.filter((a) => isWithinDateFilter(a.triggered_at, dateFrom, dateTo)), [alerts, dateFrom, dateTo]);
  const filteredReferrals = useMemo(() => caseReferrals.filter((r) => isWithinDateFilter(r.created_at, dateFrom, dateTo)), [caseReferrals, dateFrom, dateTo]);

  const sosByStatus = useMemo(() => groupCount(filteredAlerts, (a) => a.status), [filteredAlerts]);
  const referralsByStatus = useMemo(() => groupCount(filteredReferrals, (r) => r.status), [filteredReferrals]);
  const activeSos = filteredAlerts.filter((a) => a.status !== 'Resolved').length;
  const resolvedSos = filteredAlerts.length - activeSos;
  const activeReferrals = filteredReferrals.filter((r) => caseBucketOf(r) !== 'completed').length;

  const periodLabel = reportingPeriodLabel(dateFrom, dateTo);
  const appliedFilterLines = useMemo(() => {
    const lines: string[] = [];
    if (dateFrom) lines.push(`From: ${dateFrom}`);
    if (dateTo) lines.push(`To: ${dateTo}`);
    return lines;
  }, [dateFrom, dateTo]);

  const buildPdfDocument = async () => {
    return generateRoleReportPdf({
      // Landscape — the SOS Alert Detail table (5 columns, 3 of them
      // full timestamps) was cramped/wrapping in portrait's narrower
      // content width; every shared drawing primitive in reportDocument.ts
      // reads real page geometry off the jsPDF instance itself, so this
      // is the only place that needs to say so.
      orientation: 'landscape',
      documentKicker: 'POLICE ACTIVITY REPORT',
      reportTitle,
      runningHeaderTitle: 'SAFESPACE — POLICE ACTIVITY REPORT',
      footerLabel: 'SafeSpace — Police Activity Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      scopeLabel: 'Aurora Province (Emergency SOS) · Assigned Incident Referrals',
      dateFrom,
      dateTo,
      appliedFilterLines,
      summary: [
        { label: 'Total SOS Alerts', count: filteredAlerts.length },
        { label: 'Active / Unresolved SOS', count: activeSos },
        { label: 'Resolved SOS', count: resolvedSos },
        { label: 'Incident Referrals (Assigned to Me)', count: filteredReferrals.length },
        { label: 'Active Referrals', count: activeReferrals },
      ],
      sections: [
        { title: 'SOS ALERTS BY STATUS', data: sosByStatus, valueLabel: 'Alerts' },
        { title: 'INCIDENT REFERRALS BY STATUS', data: referralsByStatus, valueLabel: 'Referrals' },
      ],
      detailTables: [
        {
          title: `SOS ALERT DETAIL (${filteredAlerts.length})`,
          columns: ['SOS ID', 'Status', 'Triggered', 'Acknowledged', 'Resolved'],
          rows: filteredAlerts.map((a: SosAlert) => [
            a.sos_id.slice(0, 8),
            a.status,
            new Date(a.triggered_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
            a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—',
            a.resolved_at ? new Date(a.resolved_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—',
          ]),
          emptyMessage: 'No SOS alerts match the selected period.',
        },
        {
          title: `INCIDENT REFERRAL DETAIL (${filteredReferrals.length})`,
          columns: ['Case #', 'Status', 'Referred', 'Action Taken'],
          rows: filteredReferrals.map((r) => [
            r.case_reports?.case_number ?? '—',
            r.status,
            new Date(r.created_at).toLocaleDateString(undefined, { dateStyle: 'short' } as Intl.DateTimeFormatOptions),
            r.action_taken_at ? new Date(r.action_taken_at).toLocaleDateString(undefined, { dateStyle: 'short' } as Intl.DateTimeFormatOptions) : '—',
          ]),
          emptyMessage: 'No incident referrals match the selected period.',
        },
      ],
      // No PNP rank/station/supervisor concept exists anywhere in this
      // schema (module9) to source "Certified Correct"/"Noted by" from,
      // so those designations are deliberately generic rather than a
      // specific invented title — confirm actual PNP/SafeSpace
      // organizational titles before treating these as final.
      signatories: [
        { label: 'Prepared by:', name: preparedBy, roleLabel: 'Reporting Police Officer' },
        { label: 'Certified Correct:', name: certifiedBy, roleLabel: 'Reviewing / Approving Officer' },
        { label: 'Noted by:', name: notedBy, roleLabel: 'Authorized Reviewing Official' },
      ],
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildReportFilename(reportTitle, 'pdf'),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'sos_alerts', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo, sosCount: filteredAlerts.length, referralCount: filteredReferrals.length } });
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

  const busy = pdfActions.busy;
  const hasData = filteredAlerts.length > 0 || filteredReferrals.length > 0;

  return (
    <div>
      <PageHeader
        title="Police Activity Report"
        subtitle="A formatted, exportable report combining Emergency SOS and assigned incident-referral activity. Interactive charts live on the Analytics page."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
      />

      <div className="card report-filters-card report-no-print" style={{ marginBottom: 20 }}>
        <div className="report-filter-grid">
          <div className="report-filter-field" style={{ maxWidth: 420 }}>
            <label>Report title</label>
            <input className="input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder="Police Activity Report" maxLength={150} />
          </div>
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

      <div className="card report-no-print" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Certification signatories</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Printed on the generated PDF's signature block. Generating or exporting a report never implies these people
          have already signed it — an actual signature is still required.
        </p>
        <div className="report-filter-grid">
          <div className="report-filter-field">
            <label>Prepared by</label>
            <input className="input" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Reporting officer name" maxLength={150} />
          </div>
          <div className="report-filter-field">
            <label>Certified correct by</label>
            <input className="input" value={certifiedBy} onChange={(e) => setCertifiedBy(e.target.value)} placeholder="Reviewing / approving officer name" maxLength={150} />
          </div>
          <div className="report-filter-field">
            <label>Noted by</label>
            <input className="input" value={notedBy} onChange={(e) => setNotedBy(e.target.value)} placeholder="Authorized reviewing official name" maxLength={150} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Report Summary</h3>
        <div className="report-filter-grid" style={{ marginBottom: 0 }}>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Period</span><div style={{ fontWeight: 600 }}>{periodLabel}</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Scope</span><div style={{ fontWeight: 600 }}>Emergency SOS (province-wide) · My assigned referrals</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>SOS alerts in scope</span><div style={{ fontWeight: 600 }}>{loading ? '…' : filteredAlerts.length}</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Referrals in scope</span><div style={{ fontWeight: 600 }}>{loading ? '…' : filteredReferrals.length}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="report-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15.5 }}>Generate Report</h3>
          <div className="report-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={pdfActions.view} disabled={loading || busy}>
              <Eye size={13} /> {pdfActions.state === 'viewing' ? 'Generating…' : 'View PDF'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleExportPdf} disabled={loading || busy}>
              <FileText size={13} /> {pdfActions.state === 'exporting' ? 'Generating…' : 'Export PDF'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={pdfActions.printPdf} disabled={loading || busy}>
              <Printer size={13} /> {pdfActions.state === 'printing' ? 'Preparing…' : 'Print PDF'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          {loading
            ? 'Loading your authorized SOS and referral records…'
            : hasData
              ? 'Click View PDF to preview the formatted report before exporting or printing, or export/print directly.'
              : 'No SOS alerts or incident referrals match the selected period — the report will still generate, with empty sections clearly marked.'}
        </p>
      </div>

      {pdfActions.viewerOpen && (
        <PdfViewerModal
          title={reportTitle}
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

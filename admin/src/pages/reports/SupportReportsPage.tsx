import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { buildReportFilename } from '../../lib/reportFilename';
import { generateRoleReportPdf, reportingPeriodLabel } from '../../lib/reportDocument';
import { usePdfReportActions } from '../../hooks/usePdfReportActions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader } from '../../components/ui';
import { groupCount } from './reportsUi';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { isWithinDateFilter } from '../../lib/reportFilters';
import type { ExpertSupportRequest } from '../../types/database.types';

const CLOSED: ExpertSupportRequest['status'][] = ['CLOSED'];

/**
 * Support Expert Reports (module25) — document-oriented sibling of
 * SupportAnalyticsPage.tsx. Same assignment-only RLS scope
 * (assigned_expert_id = current_profile_id()); packaged as a real PDF.
 * Still shows ONLY request/session counts, status, and handling-time —
 * never clinical outcomes, session content, or satisfaction scores,
 * none of which exist in the schema.
 */
export function SupportReportsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [requests, setRequests] = useState<ExpertSupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportTitle, setReportTitle] = useState('Support Activity Report');

  const load = useCallback(async (isRefresh = false) => {
    if (!profile) return;
    if (isRefresh) setRefreshing(true);
    const { data, error } = await supabase.from('expert_support_requests').select('*').eq('assigned_expert_id', profile.profile_id).order('requested_at', { ascending: false });
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

  const periodLabel = reportingPeriodLabel(dateFrom, dateTo);
  const appliedFilterLines = useMemo(() => {
    const lines: string[] = [];
    if (dateFrom) lines.push(`From: ${dateFrom}`);
    if (dateTo) lines.push(`To: ${dateTo}`);
    return lines;
  }, [dateFrom, dateTo]);

  const buildPdfDocument = async () => {
    return generateRoleReportPdf({
      documentKicker: 'SUPPORT ACTIVITY REPORT',
      reportTitle,
      runningHeaderTitle: 'SAFESPACE — SUPPORT ACTIVITY REPORT',
      footerLabel: 'SafeSpace — Support Activity Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      scopeLabel: 'Conversations assigned to you',
      dateFrom,
      dateTo,
      appliedFilterLines,
      confidentialityNote:
        'CONFIDENTIAL — For authorized use only. This report contains support-request status and timing only; no clinical outcomes, session content, or satisfaction data exist in SafeSpace, so none are shown.',
      summary: [
        { label: 'Total Assigned', count: filtered.length },
        { label: 'Active', count: activeCount },
        { label: 'Closed', count: closedCount },
        { label: 'Avg. Handling Time (minutes)', count: avgHandlingMinutes ?? 0 },
      ],
      sections: [
        { title: 'REQUESTS BY STATUS', data: byStatus, valueLabel: 'Requests' },
        { title: 'REQUESTS BY PRIORITY', data: byPriority, valueLabel: 'Requests' },
      ],
      detailTables: [
        {
          title: `REQUEST DETAIL (${filtered.length})`,
          columns: ['Request ID', 'Status', 'Priority', 'Requested', 'Closed'],
          rows: filtered.map((r) => [r.request_id.slice(0, 8), r.status, r.priority, new Date(r.requested_at).toLocaleDateString(), r.closed_at ? new Date(r.closed_at).toLocaleDateString() : '—']),
          emptyMessage: 'No assigned conversations match the selected period.',
        },
      ],
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildReportFilename(reportTitle, 'pdf'),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'expert_support_requests', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo, rowCount: filtered.length } });
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

  return (
    <div>
      <PageHeader
        title="Support Activity Report"
        subtitle="A formatted, exportable report covering support conversations assigned to you. Interactive charts live on the Analytics page."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div className="card report-filters-card report-no-print" style={{ marginBottom: 20 }}>
        <div className="report-filter-grid">
          <div className="report-filter-field" style={{ maxWidth: 420 }}>
            <label>Report title</label>
            <input className="input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder="Support Activity Report" maxLength={150} />
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

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Report Summary</h3>
        <div className="report-filter-grid" style={{ marginBottom: 0 }}>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Period</span><div style={{ fontWeight: 600 }}>{periodLabel}</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Scope</span><div style={{ fontWeight: 600 }}>Assigned to you</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Requests in scope</span><div style={{ fontWeight: 600 }}>{loading ? '…' : filtered.length}</div></div>
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
          {loading ? 'Loading your assigned conversations…' : 'Click View PDF to preview the formatted report before exporting or printing, or export/print directly.'}
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

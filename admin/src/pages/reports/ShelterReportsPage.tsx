import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { downloadCsv } from '../../lib/exportCsv';
import { buildReportFilename } from '../../lib/reportFilename';
import { generateRoleReportPdf, loadSafeherLogoDataUrl, reportingPeriodLabel } from '../../lib/reportDocument';
import { usePdfReportActions } from '../../hooks/usePdfReportActions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { EmptyState, PageHeader } from '../../components/ui';
import { groupCount } from './reportsUi';
import { ROLE_LABEL } from '../../lib/roleLabels';
import type { Shelter, ShelterRequest, ShelterReferral } from '../../types/database.types';

type ReferralRow = ShelterReferral & { case_reports?: { case_number: string } | null };

/**
 * Shelter Admin / Shelter Staff Reports (module25) — document-oriented
 * sibling of ShelterAnalyticsPage.tsx. Same shelter-wide RLS scope
 * (shelter_id = current_shelter_id()); packaged as a real PDF via the
 * shared generateRoleReportPdf renderer.
 */
export function ShelterReportsPage() {
  const { profile, municipality } = useAuth();
  const { showToast } = useToast();

  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [requests, setRequests] = useState<ShelterRequest[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportTitle, setReportTitle] = useState('Shelter Operations Report');

  // Certification signatories — same pattern as PoliceReportsPage.tsx's
  // export: typed in by the preparer, never auto-filled beyond the
  // signed-in administrator's own verified name. No distinct shelter
  // supervisory hierarchy exists anywhere in this schema (same gap noted
  // for Police), so "Certified Correct"/"Noted by" stay blank with
  // generic designations rather than an invented specific title.
  const [preparedBy, setPreparedBy] = useState('');
  const [certifiedBy, setCertifiedBy] = useState('');
  const [notedBy, setNotedBy] = useState('');

  useEffect(() => {
    if (profile && !preparedBy) setPreparedBy(`${profile.first_name} ${profile.last_name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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

  const filteredRequests = useMemo(() => requests.filter((r) => inRange(r.created_at)), [requests, dateFrom, dateTo]);
  const filteredReferrals = useMemo(() => referrals.filter((r) => inRange(r.referred_at)), [referrals, dateFrom, dateTo]);

  const requestsByStatus = useMemo(() => groupCount(filteredRequests, (r) => r.status), [filteredRequests]);
  const referralsByStatus = useMemo(() => groupCount(filteredReferrals, (r) => r.referral_status), [filteredReferrals]);

  const periodLabel = reportingPeriodLabel(dateFrom, dateTo);
  const appliedFilterLines = useMemo(() => {
    const lines: string[] = [];
    if (dateFrom) lines.push(`From: ${dateFrom}`);
    if (dateTo) lines.push(`To: ${dateTo}`);
    return lines;
  }, [dateFrom, dateTo]);

  const buildPdfDocument = async () => {
    const logoDataUrl = await loadSafeherLogoDataUrl();
    const capacityLine = shelter ? [{ label: 'Capacity', count: shelter.capacity }, { label: 'Current Occupancy', count: shelter.current_occupancy }, { label: 'Available Beds', count: Math.max(shelter.capacity - shelter.current_occupancy, 0) }] : [];
    const services = (shelter?.services_available ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return generateRoleReportPdf({
      // Landscape — same reasoning as the Police Activity Report redesign:
      // the request/referral detail tables are multi-column and were
      // cramped in portrait's narrower content width; every shared
      // drawing primitive in reportDocument.ts reads real page geometry
      // off the jsPDF instance itself, so this is the only place that
      // needs to say so.
      orientation: 'landscape',
      documentKicker: 'SHELTER OPERATIONS REPORT',
      reportTitle,
      runningHeaderTitle: 'SAFESPACE — SHELTER OPERATIONS REPORT',
      footerLabel: 'SafeSpace — Shelter Operations Report · Confidential — For Authorized Use Only',
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      scopeLabel: shelter ? `${shelter.shelter_name}${municipality ? `, ${municipality.municipality_name}` : ''}` : 'Your shelter',
      dateFrom,
      dateTo,
      appliedFilterLines,
      summary: [
        ...capacityLine,
        { label: 'Total Requests', count: filteredRequests.length },
        { label: 'Total Referrals', count: filteredReferrals.length },
      ],
      sections: [
        { title: 'SHELTER REQUESTS BY STATUS', data: requestsByStatus, valueLabel: 'Requests' },
        { title: 'SHELTER REFERRALS BY STATUS', data: referralsByStatus, valueLabel: 'Referrals' },
      ],
      detailTables: [
        // Shelter Profile — one row, reusing the existing generic
        // detailTable primitive rather than extending generateRoleReportPdf
        // with a new drawing routine just for this.
        {
          title: 'SHELTER PROFILE',
          columns: ['Shelter', 'Municipality', 'Address', 'Status', 'Contact', 'Email', 'Capacity', 'Occupancy', 'Available'],
          rows: shelter
            ? [[
                shelter.shelter_name,
                municipality?.municipality_name ?? '—',
                shelter.address ?? '—',
                shelter.is_active ? 'Active' : 'Inactive',
                shelter.contact_number ?? '—',
                shelter.email ?? '—',
                shelter.capacity,
                shelter.current_occupancy,
                Math.max(shelter.capacity - shelter.current_occupancy, 0),
              ]]
            : [],
          emptyMessage: 'Shelter profile unavailable.',
        },
        {
          title: `SHELTER REQUEST DETAIL (${filteredRequests.length})`,
          columns: ['Request ID', 'Status', 'Urgency', 'People', 'Children', 'Requested'],
          rows: filteredRequests.map((r) => [r.request_id.slice(0, 8), r.status, r.urgency, r.people_count, r.children_count, new Date(r.created_at).toLocaleDateString()]),
          emptyMessage: 'No shelter requests match the selected period.',
        },
        {
          title: `SHELTER REFERRAL DETAIL (${filteredReferrals.length})`,
          columns: ['Case #', 'Status', 'Referred'],
          rows: filteredReferrals.map((r) => [r.case_reports?.case_number ?? '—', r.referral_status, new Date(r.referred_at).toLocaleDateString()]),
          emptyMessage: 'No shelter referrals match the selected period.',
        },
        // Services Offered — not "delivered", just what this shelter
        // offers (shelters.services_available); never implies any
        // individual resident actually received these.
        {
          title: 'SERVICES OFFERED',
          columns: ['Service'],
          rows: services.map((s) => [s]),
          emptyMessage: 'No services configured for this shelter.',
        },
      ],
      signatories: [
        { label: 'Prepared by:', name: preparedBy, roleLabel: 'Shelter Administrator' },
        { label: 'Certified Correct:', name: certifiedBy, roleLabel: 'Reviewing / Approving Official' },
        { label: 'Noted by:', name: notedBy, roleLabel: 'Authorized Reviewing Official' },
      ],
      logoDataUrl,
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildReportFilename(reportTitle, 'pdf'),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'shelter_requests', recordId: profile.profile_id, newValues: { filename, dateFrom, dateTo, requestCount: filteredRequests.length, referralCount: filteredReferrals.length } });
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

  const exportCsv = () => {
    const filename = buildReportFilename(`${reportTitle} - Requests`, 'csv');
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

  const busy = pdfActions.busy;

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Shelter Operations Report" />
        <EmptyState title="No shelter assignment on file" subtitle="This account has no shelter_id set — contact a provincial administrator." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Shelter Operations Report"
        subtitle="A formatted, exportable report covering shelter requests and referrals. Interactive charts live on the Analytics page."
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div className="card report-filters-card report-no-print" style={{ marginBottom: 20 }}>
        <div className="report-filter-grid">
          <div className="report-filter-field" style={{ maxWidth: 420 }}>
            <label>Report title</label>
            <input className="input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder="Shelter Operations Report" maxLength={150} />
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
            <input className="input" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Shelter administrator name" maxLength={150} />
          </div>
          <div className="report-filter-field">
            <label>Certified correct by</label>
            <input className="input" value={certifiedBy} onChange={(e) => setCertifiedBy(e.target.value)} placeholder="Reviewing / approving official name" maxLength={150} />
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
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Scope</span><div style={{ fontWeight: 600 }}>{shelter?.shelter_name ?? '—'}</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Requests in scope</span><div style={{ fontWeight: 600 }}>{loading ? '…' : filteredRequests.length}</div></div>
          <div><span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Referrals in scope</span><div style={{ fontWeight: 600 }}>{loading ? '…' : filteredReferrals.length}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="report-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15.5 }}>Generate Report</h3>
          <div className="report-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={loading || busy || filteredRequests.length === 0}>
              <Download size={13} /> Export CSV
            </button>
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
          {loading ? 'Loading your shelter’s records…' : 'Click View PDF to preview the formatted report before exporting or printing, or export/print directly.'}
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

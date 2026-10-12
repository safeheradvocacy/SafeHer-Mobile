import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Clock,
  Activity,
  CheckCircle2,
  ArrowLeftRight,
  Printer,
  Save,
  Trash2,
  Copy,
  Pencil,
  FolderOpen,
  FileText,
  Eye,
  Landmark,
} from 'lucide-react';
import '../../lib/chartSetup';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { buildReportFilename } from '../../lib/reportFilename';
import { type ReportRow } from '../../lib/reportRows';
import { generateReportPdf, reportingPeriodLabel } from '../../lib/reportDocument';
import { buildGovernmentReportFilename } from '../../lib/reportFilename';
import { EMPTY_FILTERS, clampFiltersToScope, hasActiveFilters, type CaseReportFilters, type GovernmentReportType, type ReportingPeriodPreset } from '../../lib/reportFilters';
import { useGovernmentReportRows, type GovernmentReportRow } from '../../lib/governmentReportRows';
import { generateWedcReportPdf, generateCnspReportPdf, generateCiclReportPdf, type Signatories } from '../../lib/governmentReportDocument';
import { SOURCE_OF_DATA_NOTE, SERVICES_PROVIDED_NOTE, CICL_NOT_AVAILABLE_NOTE } from '../../lib/governmentReportMapping';
import { usePdfReportActions, type PdfActionState } from '../../hooks/usePdfReportActions';
import { hasPermission } from '../../lib/permissions';
import { PdfViewerModal } from '../../components/reports/PdfViewerModal';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { KpiCard, KpiSkeletonCard, FilterBar, STATUSES, TYPES, PRIORITIES, REFERRAL_STATUSES } from './reportsUi';
import { useReportsController, DETAIL_PAGE_SIZE } from './useReportsController';
import type { CaseReport, SavedReport, UserProfile } from '../../types/database.types';

type TabKey = 'reports' | 'saved';

export function ReportsPage() {
  const {
    profile,
    roleTier,
    isProvincial,
    filters,
    setFilters,
    updateFilter: controllerUpdateFilter,
    applyPeriodPreset: controllerApplyPeriodPreset,
    resetFilters: controllerResetFilters,
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
  } = useReportsController();

  const { showToast } = useToast();

  const [tab, setTab] = useState<TabKey>('reports');

  // Report identity — a real, editable title (not a fixed label) so an
  // ad-hoc report's PDF/filename can reflect something meaningful, not
  // just a saved report's. activeSavedReportId is only ever set when
  // the CURRENT filters came from actually opening a saved report (see
  // SavedReportsTab's openReport), and is cleared the moment the user
  // hand-edits a filter — a stale saved-report identity must never
  // silently stick to a report the user has since changed.
  const [reportTitle, setReportTitle] = useState('Case Management Report');
  const [activeSavedReportId, setActiveSavedReportId] = useState<string | null>(null);

  const updateFilter = <K extends keyof CaseReportFilters>(key: K, value: CaseReportFilters[K]) => {
    setActiveSavedReportId(null);
    controllerUpdateFilter(key, value);
  };
  const applyPeriodPreset = (preset: ReportingPeriodPreset) => {
    setActiveSavedReportId(null);
    controllerApplyPeriodPreset(preset);
  };
  const resetFilters = () => {
    setActiveSavedReportId(null);
    controllerResetFilters();
  };

  const buildPdfDocument = async () => {
    return generateReportPdf({
      reportTitle,
      reportId: activeSavedReportId,
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
      scopeLabel,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      appliedFilterLines,
      summary: [
        { label: 'Total Cases', count: total },
        { label: 'Pending', count: pending },
        { label: 'Active', count: active },
        { label: 'Resolved / Closed', count: closed },
        { label: 'Referred', count: referredCount },
      ],
      statusDistribution: byStatus,
      classificationDistribution: byType,
      sourceDistribution: bySource,
      geographicDistribution,
      geographicLabel,
      referralDistribution: referralByStatus,
      sosSummary: roleTier === 'barangay' ? null : { total: sos.length, byStatus: sosByStatus },
      rows: reportRows,
    });
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdfDocument,
    filename: () => buildReportFilename(reportTitle, 'pdf'),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'case_reports', recordId: activeSavedReportId ?? profile.profile_id, newValues: { filename, filters, rowCount: reportRows.length } });
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
        title={isProvincial ? 'Provincial Case Management Reports' : 'Case Management Reports'}
        subtitle={`Scope: ${roleTier === 'province' ? 'Aurora Province' : roleTier === 'municipality' ? municipalityName(profile?.municipality_id ?? null) || 'Your municipality' : roleTier === 'barangay' ? 'Your barangay' : '—'}`}
        actions={<DashboardHeaderActions showSearch={hasPermission(profile?.role, 'cases.view')} lastUpdated={lastUpdated} refreshing={polling} onRefresh={() => reload()} />}
      />

      <div className="report-tab-row report-no-print" role="tablist">
        {(
          [
            ['reports', 'Generate Report'],
            ['saved', 'Saved Reports'],
          ] as [TabKey, string][]
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`report-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <FilterBar
        filters={filters}
        onChange={updateFilter}
        onPeriodPresetChange={applyPeriodPreset}
        onReset={resetFilters}
        roleTier={roleTier}
        municipalities={municipalities}
        barangays={barangays}
        staffOptions={staffOptions}
      />

      {error ? (
        <div className="card dash-error-state">
          <p style={{ marginBottom: 12 }}>Unable to load report data. Please try again.</p>
          <button className="btn btn-primary" onClick={() => reload()}>
            Try Again
          </button>
        </div>
      ) : tab === 'reports' ? (
        filters.reportType === 'General' ? (
          <>
            <ReportsTab
              cases={cases}
              loading={loading}
              detailLimit={detailLimit}
              setDetailLimit={setDetailLimit}
              isProvincial={isProvincial}
              total={total}
              pending={pending}
              active={active}
              closed={closed}
              referredCount={referredCount}
              reportRows={reportRows}
              reportTitle={reportTitle}
              setReportTitle={(v) => { setReportTitle(v); setActiveSavedReportId(null); }}
              pdfState={pdfActions.state}
              onViewPdf={pdfActions.view}
              onExportPdf={handleExportPdf}
              onPrintPdf={pdfActions.printPdf}
            />
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
          </>
        ) : (
          <GovernmentReportSection
            reportType={filters.reportType}
            cases={cases}
            loading={loading}
            roleTier={roleTier}
            profile={profile}
            scopeLabel={scopeLabel}
            filters={filters}
            updateFilter={updateFilter}
            activeSavedReportId={activeSavedReportId}
          />
        )
      ) : (
        <SavedReportsTab
          filters={filters}
          setFilters={setFilters}
          setTab={setTab}
          roleTier={roleTier}
          profile={profile}
          reportTitle={reportTitle}
          setReportTitle={setReportTitle}
          setActiveSavedReportId={setActiveSavedReportId}
        />
      )}
    </div>
  );
}

// =====================================================================
// Reports tab — summary KPIs + detailed, non-sensitive case table.
// Deliberately excludes survivor name/contact/narrative (data
// minimization) — only case-level operational fields.
// =====================================================================
function ReportsTab({
  cases,
  loading,
  detailLimit,
  setDetailLimit,
  isProvincial,
  total,
  pending,
  active,
  closed,
  referredCount,
  reportRows,
  reportTitle,
  setReportTitle,
  pdfState,
  onViewPdf,
  onExportPdf,
  onPrintPdf,
}: {
  cases: CaseReport[];
  loading: boolean;
  detailLimit: number;
  setDetailLimit: (n: number) => void;
  isProvincial: boolean;
  total: number;
  pending: number;
  active: number;
  closed: number;
  referredCount: number;
  reportRows: ReportRow[];
  reportTitle: string;
  setReportTitle: (v: string) => void;
  pdfState: PdfActionState;
  onViewPdf: () => void;
  onExportPdf: () => void;
  onPrintPdf: () => void;
}) {
  const visible = reportRows.slice(0, detailLimit);
  const busy = pdfState !== 'idle';

  return (
    <div>
      <div className="card report-no-print" style={{ marginBottom: 20 }}>
        <div className="report-filter-field" style={{ maxWidth: 420 }}>
          <label>Report title</label>
          <input
            className="input"
            value={reportTitle}
            onChange={(e) => setReportTitle(e.target.value)}
            placeholder="Case Management Report"
            maxLength={150}
          />
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Used as the document title and export filename for the PDF below.
        </p>
      </div>

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={ClipboardList} label="Total Cases" value={total} context="Matching current filters" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
            <KpiCard icon={Clock} label="Pending" value={pending} context="Awaiting review" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} />
            <KpiCard icon={Activity} label="Active" value={active} context="Currently in progress" color="var(--color-info)" tint="var(--kpi-tint-info)" iconBg="var(--kpi-icon-info)" loading={loading} />
            <KpiCard icon={CheckCircle2} label="Resolved / Closed" value={closed} context="Completed cases" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} />
            <KpiCard icon={ArrowLeftRight} label="Referred" value={referredCount} context="Currently referred" color="var(--color-primary-dark)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} />
          </>
        )}
      </div>

      <div className="card">
        <div className="report-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15.5 }}>Case Detail</h3>
          <div className="report-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* View/Export/Print PDF are available even at zero cases —
                the document itself already renders a clear "No case
                records match the selected filters." section rather than
                an empty table, so generating it is both safe and useful
                (confirms the filtered scope is genuinely empty, not
                broken). Matches the same choice made for every
                role-specific Reports page. */}
            <button className="btn btn-outline btn-sm" onClick={onViewPdf} disabled={busy}>
              <Eye size={13} /> {pdfState === 'viewing' ? 'Generating…' : 'View PDF'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={onExportPdf} disabled={busy}>
              <FileText size={13} /> {pdfState === 'exporting' ? 'Generating…' : 'Export PDF'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={onPrintPdf} disabled={busy}>
              <Printer size={13} /> {pdfState === 'printing' ? 'Preparing…' : 'Print PDF'}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 32 }} />)}
          </div>
        ) : cases.length === 0 ? (
          <EmptyState title="No case records match the selected filters." subtitle="Try widening your date range or clearing a filter." />
        ) : (
          <>
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Reported</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Priority</th>
                    {isProvincial && <th>Municipality</th>}
                    <th>Barangay</th>
                    <th>Assigned Staff</th>
                    <th>Referral</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.caseNumber}>
                      <td>{r.caseNumber}</td>
                      <td>{r.dateReportedDisplay}</td>
                      <td>{r.caseType}</td>
                      <td><StatusBadge label={r.status} /></td>
                      <td><StatusBadge label={r.priority} /></td>
                      {isProvincial && <td>{r.municipality}</td>}
                      <td>{r.barangay}</td>
                      <td>{r.assignedStaff}</td>
                      <td>{r.referralStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reportRows.length > visible.length && (
              <button type="button" className="btn btn-outline btn-sm report-no-print" style={{ marginTop: 12 }} onClick={() => setDetailLimit(detailLimit + DETAIL_PAGE_SIZE)}>
                Load More ({reportRows.length - visible.length} more)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Government Report section — WEDC/VAW, CNSP, and CICL/CAR consolidated
// case reports, matching the official template structures. Separate
// from ReportsTab (the existing PII-free General report) because this
// surface genuinely carries case-level PII the General report
// deliberately never shows. Only mounted for roleTier 'province' /
// 'municipality' — see FilterBar's canUseGovernmentReports comment for
// why barangay_admin is excluded (it is a real RLS/data-availability
// fact, not an arbitrary restriction), re-checked defensively here too.
// =====================================================================
function GovernmentReportSection({
  reportType,
  cases,
  loading,
  roleTier,
  profile,
  scopeLabel,
  filters,
  updateFilter,
  activeSavedReportId,
}: {
  reportType: 'WEDC' | 'CNSP' | 'CICL';
  cases: CaseReport[];
  loading: boolean;
  roleTier: 'province' | 'municipality' | 'barangay' | null;
  profile: UserProfile | null;
  scopeLabel: string;
  filters: CaseReportFilters;
  updateFilter: <K extends keyof CaseReportFilters>(key: K, value: CaseReportFilters[K]) => void;
  activeSavedReportId: string | null;
}) {
  const { showToast } = useToast();

  const { rows: allRows, loading: rowsLoading, canAccessSurvivorPii: hasPiiAccess } = useGovernmentReportRows(cases, roleTier);

  // CICL has no real derivation path at all (see CICL_NOT_AVAILABLE_NOTE)
  // — always zero rows, regardless of role or filters, never a guess.
  const templateRows: GovernmentReportRow[] = useMemo(
    () => (reportType === 'CICL' ? [] : allRows.filter((r) => r.classification === reportType)),
    [allRows, reportType]
  );

  const unclassifiedCount = useMemo(() => allRows.filter((r) => r.classification === 'Unclassified').length, [allRows]);

  const periodLabel = reportingPeriodLabel(filters.dateFrom, filters.dateTo);
  const templateTitle = reportType === 'WEDC' ? 'WEDC / VAW — Consolidated Cases' : reportType === 'CNSP' ? 'CNSP — Consolidated Cases' : 'CICL / CAR — Consolidated Cases';

  const buildPdf = async () => {
    const signatories: Signatories = { preparedBy: filters.preparedBy, certifiedCorrectBy: filters.certifiedCorrectBy, notedBy: filters.notedBy };
    const params = {
      jurisdictionLabel: scopeLabel.toUpperCase(),
      periodLabel,
      rows: templateRows,
      signatories,
      generatedByName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
      generatedByRole: profile ? ROLE_LABEL[profile.role] : '',
    };
    if (reportType === 'WEDC') return generateWedcReportPdf(params);
    if (reportType === 'CNSP') return generateCnspReportPdf(params);
    return generateCiclReportPdf(params);
  };

  const pdfActions = usePdfReportActions({
    buildDoc: buildPdf,
    filename: () => buildGovernmentReportFilename(reportType, filters.dateFrom, filters.dateTo, 'pdf'),
    onAudit: (action, filename) => {
      if (!profile) return;
      logAudit({ profileId: profile.profile_id, action, tableName: 'case_reports', recordId: activeSavedReportId ?? profile.profile_id, newValues: { filename, reportType, filters, rowCount: templateRows.length } });
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
  const anyLoading = loading || rowsLoading;

  if (!hasPiiAccess) {
    // Defensive fallback only — FilterBar already keeps this role from
    // ever selecting a government report type, so this should be
    // unreachable in normal use (e.g. a stale saved report opened after
    // a role change).
    return (
      <div className="card">
        <EmptyState title="Not authorized for this report" subtitle="WEDC/CNSP/CICL government reports require municipal or provincial access to case-level records." />
      </div>
    );
  }

  return (
    <div>
      <div className="card report-no-print" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>{templateTitle}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Period: {periodLabel} · Jurisdiction: {scopeLabel}
        </p>
      </div>

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {anyLoading ? (
          <>
            <KpiSkeletonCard />
            <KpiSkeletonCard />
          </>
        ) : (
          <>
            <KpiCard icon={Landmark} label={`${reportType} Cases`} value={templateRows.length} context="Matching current filters" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={anyLoading} />
            <KpiCard icon={ClipboardList} label="Age Unknown (Unclassified)" value={unclassifiedCount} context="No birthdate on file — not counted in any report" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={anyLoading} />
          </>
        )}
      </div>

      {reportType === 'CICL' && (
        <div className="card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{CICL_NOT_AVAILABLE_NOTE}</p>
        </div>
      )}

      <div className="card report-no-print" style={{ marginTop: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Certification signatories</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Printed on the generated PDF's signature block. Generating or exporting a report never implies these people have already signed it — an actual signature is still required.
        </p>
        <div className="report-filter-grid">
          <div className="report-filter-field">
            <label>Prepared by</label>
            <input className="input" value={filters.preparedBy} onChange={(e) => updateFilter('preparedBy', e.target.value)} placeholder="Secretariat / Social Worker name" maxLength={150} />
          </div>
          <div className="report-filter-field">
            <label>Certified correct by</label>
            <input className="input" value={filters.certifiedCorrectBy} onChange={(e) => updateFilter('certifiedCorrectBy', e.target.value)} placeholder="MSWDO name" maxLength={150} />
          </div>
          <div className="report-filter-field">
            <label>Noted by</label>
            <input className="input" value={filters.notedBy} onChange={(e) => updateFilter('notedBy', e.target.value)} placeholder="PNP-WCPD / Chairperson name" maxLength={150} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="report-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15.5 }}>Case Detail ({templateRows.length})</h3>
          <div className="report-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={pdfActions.view} disabled={busy}>
              <Eye size={13} /> {pdfActions.state === 'viewing' ? 'Generating…' : 'View PDF'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleExportPdf} disabled={busy}>
              <FileText size={13} /> {pdfActions.state === 'exporting' ? 'Generating…' : 'Export PDF'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={pdfActions.printPdf} disabled={busy}>
              <Printer size={13} /> {pdfActions.state === 'printing' ? 'Preparing…' : 'Print PDF'}
            </button>
          </div>
        </div>

        {anyLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 32 }} />)}
          </div>
        ) : templateRows.length === 0 ? (
          <EmptyState
            title={`No ${reportType} cases match the selected filters.`}
            subtitle={reportType === 'CICL' ? 'Expected — see the data-limitation note above.' : 'Try widening your date range or clearing a filter.'}
          />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Date Reported</th>
                  <th>Name/Alias</th>
                  <th>Address</th>
                  <th>Birthdate</th>
                  <th>Age</th>
                  <th>Sex</th>
                  <th>Educational Attainment</th>
                  <th>Type</th>
                  <th>Status/Remarks</th>
                </tr>
              </thead>
              <tbody>
                {templateRows.map((r) => (
                  <tr key={r.caseId}>
                    <td>{r.caseNumber}</td>
                    <td>{new Date(r.dateReportedIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td>{r.nameOrAlias}</td>
                    <td>{r.address}</td>
                    <td>{r.birthdateDisplay}</td>
                    <td>{r.age ?? '—'}</td>
                    <td>{r.sex}</td>
                    <td>{r.educationalAttainment}</td>
                    <td>{r.templateColumn}{r.sexualAbuseSubtype ? ` (${r.sexualAbuseSubtype})` : ''}</td>
                    <td><StatusBadge label={r.statusRemarks} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 6 }}>{SOURCE_OF_DATA_NOTE}</p>
        <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{SERVICES_PROVIDED_NOTE}</p>
      </div>

      {pdfActions.viewerOpen && (
        <PdfViewerModal
          title={templateTitle}
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

// =====================================================================
// Saved Reports tab
// =====================================================================
function SavedReportsTab({
  filters,
  setFilters,
  setTab,
  roleTier,
  profile,
  reportTitle,
  setReportTitle,
  setActiveSavedReportId,
}: {
  filters: CaseReportFilters;
  setFilters: (f: CaseReportFilters) => void;
  setTab: (t: TabKey) => void;
  roleTier: 'province' | 'municipality' | 'barangay' | null;
  profile: UserProfile | null;
  reportTitle: string;
  setReportTitle: (v: string) => void;
  setActiveSavedReportId: (id: string | null) => void;
}) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedReport | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SavedReport | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    // RLS scopes this to the caller's own rows (created_by =
    // current_profile_id()) — no client-side ownership filter needed
    // or meaningful to add on top of it.
    const { data } = await supabase.from('saved_reports').select('*').order('updated_at', { ascending: false });
    setReports(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const saveCurrentAsNew = async () => {
    if (!profile || !nameInput.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('saved_reports')
      .insert({ created_by: profile.profile_id, report_name: nameInput.trim(), filters })
      .select()
      .single();
    setSaving(false);
    if (!error && data) {
      await logAudit({ profileId: profile.profile_id, action: 'INSERT', tableName: 'saved_reports', recordId: data.report_id, newValues: data });
      setSaveModalOpen(false);
      setReportTitle(data.report_name);
      setActiveSavedReportId(data.report_id);
      setNameInput('');
      load();
    }
  };

  const openReport = (r: SavedReport) => {
    // Never trust the stored filter values blindly — re-clamp to the
    // CURRENT user's authorized scope before regenerating (see
    // reportFilters.ts's header comment for why).
    const stored = r.filters as Partial<CaseReportFilters>;
    const merged = clampFiltersToScope({ ...EMPTY_FILTERS, ...stored }, roleTier, profile);
    setFilters(merged);
    setReportTitle(r.report_name);
    setActiveSavedReportId(r.report_id);
    setTab('reports');
  };

  const submitRename = async () => {
    if (!renameTarget || !nameInput.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('saved_reports').update({ report_name: nameInput.trim() }).eq('report_id', renameTarget.report_id);
    setSaving(false);
    if (!error && profile) {
      await logAudit({ profileId: profile.profile_id, action: 'UPDATE', tableName: 'saved_reports', recordId: renameTarget.report_id, oldValues: { report_name: renameTarget.report_name }, newValues: { report_name: nameInput.trim() } });
      setRenameTarget(null);
      setNameInput('');
      load();
    }
  };

  const duplicateReport = async (r: SavedReport) => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('saved_reports')
      .insert({ created_by: profile.profile_id, report_name: `${r.report_name} (Copy)`, filters: r.filters })
      .select()
      .single();
    if (!error && data) {
      await logAudit({ profileId: profile.profile_id, action: 'INSERT', tableName: 'saved_reports', recordId: data.report_id, newValues: data });
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !profile) return;
    setSaving(true);
    const { error } = await supabase.from('saved_reports').delete().eq('report_id', deleteTarget.report_id);
    setSaving(false);
    if (!error) {
      await logAudit({ profileId: profile.profile_id, action: 'DELETE', tableName: 'saved_reports', recordId: deleteTarget.report_id, oldValues: { ...deleteTarget } });
      setDeleteTarget(null);
      load();
    }
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15.5 }}>Saved Reports</h3>
          <button className="btn btn-primary btn-sm" onClick={() => { setNameInput(reportTitle); setSaveModalOpen(true); }}>
            <Save size={13} /> Save Current Filters
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 40 }} />)}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState title="No saved reports yet" subtitle="Save your current filters to quickly reopen this report later." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last Updated</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.report_id}>
                    <td>{r.report_name}</td>
                    <td>{new Date(r.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="table-actions-cell">
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openReport(r)} title="Open">
                          <FolderOpen size={13} />
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => { setRenameTarget(r); setNameInput(r.report_name); }} title="Rename">
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => duplicateReport(r)} title="Duplicate">
                          <Copy size={13} />
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(r)} title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {saveModalOpen && (
        <Modal
          title="Save current filters as a report"
          onClose={() => { setSaveModalOpen(false); setNameInput(''); }}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setSaveModalOpen(false); setNameInput(''); }} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCurrentAsNew} disabled={saving || !nameInput.trim()}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          }
        >
          <div className="field">
            <label className="label">Report name</label>
            <input className="input" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="e.g. Pending cases — Baler, this quarter" autoFocus />
          </div>
        </Modal>
      )}

      {renameTarget && (
        <Modal
          title="Rename saved report"
          onClose={() => { setRenameTarget(null); setNameInput(''); }}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setRenameTarget(null); setNameInput(''); }} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={submitRename} disabled={saving || !nameInput.trim()}>{saving ? 'Saving...' : 'Rename'}</button>
            </>
          }
        >
          <div className="field">
            <label className="label">Report name</label>
            <input className="input" value={nameInput} onChange={(e) => setNameInput(e.target.value)} autoFocus />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="Delete this saved report?"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={saving}>{saving ? 'Deleting...' : 'Delete'}</button>
            </>
          }
        >
          <p style={{ color: 'var(--color-text-muted)' }}>
            "{deleteTarget.report_name}" will be permanently deleted. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

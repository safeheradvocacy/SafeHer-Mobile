import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Doughnut } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { RotateCcw } from 'lucide-react';
import '../../lib/chartSetup';
import { CHART_COLORS, chartBaseOptions } from '../../lib/chartSetup';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { hasActiveFilters, type CaseReportFilters, type GovernmentReportType, type ReportingPeriodPreset } from '../../lib/reportFilters';
import type { Barangay, CaseSource, CaseStatus, CaseType, Municipality, PriorityLevel, ReferralStatus, UserProfile } from '../../types/database.types';

/**
 * Shared presentational pieces for every Reports & Analytics surface —
 * originally private to ReportsPage.tsx, extracted here (module24) so
 * the new role-specific report pages (Police/Shelter/Support) can reuse
 * the exact same KPI card / chart card look instead of each inventing
 * their own, matching the "one consistent design system" requirement
 * without duplicating the whole Reports system per role.
 */

export function groupCount<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
  loading,
  formatter,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  context: string;
  color: string;
  tint: string;
  iconBg: string;
  loading: boolean;
  formatter?: (n: number) => string;
  to?: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`dash-kpi-card${to ? ' dash-kpi-card--clickable' : ''}`}
      style={{ ['--kpi-tint' as string]: tint, ['--kpi-accent' as string]: color }}
      role={to ? 'button' : undefined}
      tabIndex={to ? 0 : undefined}
      onClick={to ? () => navigate(to) : undefined}
      onKeyDown={
        to
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(to);
              }
            }
          : undefined
      }
    >
      <div className="dash-kpi-icon" style={{ background: iconBg, color }}>
        <Icon size={17} strokeWidth={2} />
      </div>
      <span className="dash-kpi-label">{label}</span>
      {loading ? (
        <div className="skeleton skeleton-text" style={{ width: 48, height: 24 }} />
      ) : (
        <span className="dash-kpi-value" style={{ color }}>
          <AnimatedNumber value={value} formatter={formatter} />
        </span>
      )}
      <span className="dash-kpi-context">{context}</span>
    </div>
  );
}

export function KpiSkeletonCard() {
  return (
    <div className="dash-kpi-card">
      <div className="skeleton skeleton-circle" style={{ width: 32, height: 32 }} />
      <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      <div className="skeleton skeleton-text" style={{ width: 48, height: 24 }} />
      <div className="skeleton skeleton-text" style={{ width: '80%' }} />
    </div>
  );
}

export function ChartCard({
  title,
  data,
  options,
  loading,
  emptyText = 'No data available for the selected filters.',
  height = 220,
  chartBoxRef,
}: {
  title: string;
  data: { label: string; count: number }[];
  options: ChartOptions<'doughnut'>;
  loading: boolean;
  emptyText?: string;
  height?: number;
  /** Optional — lets a caller (the Analytics PDF export) read the real
   * rendered <canvas> back out of this card via captureChartImage().
   * Purely additive: omitting it changes nothing about how this card
   * renders or behaves. */
  chartBoxRef?: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: 16, fontSize: 15 }}>{title}</h3>
      {loading ? (
        <div className="skeleton" style={{ height }} />
      ) : data.length === 0 ? (
        <div className="dash-chart-empty">
          <p>{emptyText}</p>
        </div>
      ) : (
        <div className="chart-box" style={{ height }} ref={chartBoxRef}>
          <Doughnut
            data={{ labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.count), backgroundColor: CHART_COLORS }] }}
            options={chartBaseOptions(options)}
          />
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Shared case-report filter vocabulary + the Filter Bar itself — moved
// here (module25) from ReportsPage.tsx so BOTH the Reports page and the
// now-separate Analytics page (see Phase 2: Reports and Analytics are
// independently routed pages, not two tabs on one page) can mount the
// exact same filter control instead of each keeping its own copy.
// =====================================================================
export const STATUSES: CaseStatus[] = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Referred', 'Resolved', 'Closed'];
export const TYPES: CaseType[] = ['Physical Abuse', 'Psychological Abuse', 'Sexual Abuse', 'Economic Abuse', 'Stalking', 'Neglect', 'Others'];
export const PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Critical'];
export const REFERRAL_STATUSES: ReferralStatus[] = ['Pending', 'Accepted', 'Declined', 'Completed'];

// Every option below is sourced from a real enum or a real table query;
// nothing here is a fabricated value. Geographic pickers are only ever
// rendered for a role authorized to use them — municipal_admin/
// barangay_admin never see a control that could ask for another
// jurisdiction's data (see reportFilters.ts's clamping, which is the
// actual belt-and-suspenders backstop alongside RLS).
export function FilterBar({
  filters,
  onChange,
  onPeriodPresetChange,
  onReset,
  roleTier,
  municipalities,
  barangays,
  staffOptions,
}: {
  filters: CaseReportFilters;
  onChange: <K extends keyof CaseReportFilters>(key: K, value: CaseReportFilters[K]) => void;
  onPeriodPresetChange: (preset: ReportingPeriodPreset) => void;
  onReset: () => void;
  roleTier: 'province' | 'municipality' | 'barangay' | null;
  municipalities: Municipality[];
  barangays: Barangay[];
  staffOptions: UserProfile[];
}) {
  // The three official government templates require survivor PII
  // (Name/Address/Birthdate/Sex) that barangay_admin has no RLS access
  // to at all (verified against the live survivors policy) — offering
  // the Report Type switch to a role that structurally cannot produce
  // a correct WEDC/CNSP/CICL classification (it needs date_of_birth,
  // which lives on a table this role can't query) would mean either
  // faking the split or silently dumping everything into "Unclassified",
  // neither of which is honest. barangay_admin keeps the General report
  // it already has — genuinely narrower, role-appropriate access, not
  // identical to municipality/province.
  const canUseGovernmentReports = roleTier === 'province' || roleTier === 'municipality';

  return (
    <div className="card report-filters-card report-no-print">
      <div className="report-filter-grid">
        {canUseGovernmentReports && (
          <div className="report-filter-field">
            <label>Report type</label>
            <select className="input" value={filters.reportType} onChange={(e) => onChange('reportType', e.target.value as GovernmentReportType)}>
              <option value="General">General (Case Management Report)</option>
              <option value="WEDC">WEDC / VAW — Consolidated Cases</option>
              <option value="CNSP">CNSP — Consolidated Cases</option>
              <option value="CICL">CICL / CAR — Consolidated Cases</option>
            </select>
          </div>
        )}
        <div className="report-filter-field">
          <label>Reporting period</label>
          <select className="input" value={filters.periodPreset} onChange={(e) => onPeriodPresetChange(e.target.value as ReportingPeriodPreset)}>
            <option value="Custom">Custom range</option>
            <option value="Monthly">Monthly (this month)</option>
            <option value="Quarterly">Quarterly (this quarter)</option>
            <option value="Semi-Annual">Semi-annual (this half-year)</option>
            <option value="Annual">Annual (this year)</option>
          </select>
        </div>
        <div className="report-filter-field">
          <label>From date</label>
          <input type="date" className="input" value={filters.dateFrom} onChange={(e) => onChange('dateFrom', e.target.value)} />
        </div>
        <div className="report-filter-field">
          <label>To date</label>
          <input type="date" className="input" value={filters.dateTo} onChange={(e) => onChange('dateTo', e.target.value)} />
        </div>
        <div className="report-filter-field">
          <label>Status</label>
          <select className="input" value={filters.status} onChange={(e) => onChange('status', e.target.value as CaseStatus | '')}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="report-filter-field">
          <label>Case type</label>
          <select className="input" value={filters.caseType} onChange={(e) => onChange('caseType', e.target.value as CaseType | '')}>
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="report-filter-field">
          <label>Priority</label>
          <select className="input" value={filters.priority} onChange={(e) => onChange('priority', e.target.value as PriorityLevel | '')}>
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="report-filter-field">
          <label>Report source</label>
          <select className="input" value={filters.source} onChange={(e) => onChange('source', e.target.value as CaseSource | '')}>
            <option value="">All</option>
            <option value="Mobile">Mobile</option>
            <option value="Walk-In">Walk-In</option>
          </select>
        </div>
        {roleTier === 'province' && (
          <div className="report-filter-field">
            <label>Municipality</label>
            <select className="input" value={filters.municipalityId} onChange={(e) => onChange('municipalityId', e.target.value)}>
              <option value="">All (province-wide)</option>
              {municipalities.map((m) => (
                <option key={m.municipality_id} value={m.municipality_id}>{m.municipality_name}</option>
              ))}
            </select>
          </div>
        )}
        {roleTier !== 'barangay' && (
          <div className="report-filter-field">
            <label>Barangay</label>
            <select
              className="input"
              value={filters.barangayId}
              onChange={(e) => onChange('barangayId', e.target.value)}
              disabled={roleTier === 'province' && !filters.municipalityId}
            >
              <option value="">All</option>
              {barangays.map((b) => (
                <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>
              ))}
            </select>
          </div>
        )}
        {staffOptions.length > 0 && (
          <div className="report-filter-field">
            <label>Assigned staff</label>
            <select className="input" value={filters.assignedTo} onChange={(e) => onChange('assignedTo', e.target.value)}>
              <option value="">All</option>
              {staffOptions.map((s) => (
                <option key={s.profile_id} value={s.profile_id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="report-filter-field">
          <label>Referral status</label>
          <select className="input" value={filters.referralStatus} onChange={(e) => onChange('referralStatus', e.target.value as ReferralStatus | '')}>
            <option value="">All</option>
            {REFERRAL_STATUSES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="report-filter-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
          <RotateCcw size={13} /> Reset Filters
        </button>
      </div>
      {hasActiveFilters(filters) && (
        <p className="report-applied-summary">
          Filters applied — showing a filtered subset of your authorized cases.
        </p>
      )}
    </div>
  );
}

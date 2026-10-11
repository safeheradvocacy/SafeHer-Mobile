import React, { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { ClipboardList, Clock, Activity, CheckCircle2, ArrowLeftRight } from 'lucide-react';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader } from '../../components/ui';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { KpiCard, KpiSkeletonCard, ChartCard, FilterBar } from './reportsUi';
import { useReportsController } from './useReportsController';
import { hasPermission } from '../../lib/permissions';
import type { SosAlert } from '../../types/database.types';

/**
 * Analytics — the interactive-exploration half of Reports & Analytics
 * (module25, Phase 2). Independently routed at /admin/analytics,
 * separate from /admin/reports — not a tab buried inside the Reports
 * page. Deliberately carries NO PDF/CSV export controls of its own
 * (those belong to Reports, which produces an actual document); this
 * page is charts/KPIs only, driven by the exact same aggregation layer
 * (useReportsController) the Reports page's PDF pulls from, so the two
 * can never silently disagree on the same filtered dataset.
 */
export function AnalyticsPage() {
  const {
    profile,
    roleTier,
    filters,
    updateFilter,
    applyPeriodPreset,
    resetFilters,
    municipalities,
    barangays,
    staffOptions,
    lastUpdated,
    polling,
    cases,
    sos,
    loading,
    error,
    reload,
    total,
    pending,
    active,
    closed,
    referredCount,
    byStatus,
    byType,
    bySource,
    geographicDistribution,
    geographicLabel,
    referralByStatus,
    sosByStatus,
    scopeLabel,
  } = useReportsController();

  const reducedMotion = usePrefersReducedMotion();

  const doughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({
      animation: reducedMotion ? false : { duration: 700, easing: 'easeOutQuart' },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
    }),
    [reducedMotion]
  );
  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({
      animation: reducedMotion ? false : { duration: 700, easing: 'easeOutQuart', delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 70 : 0) },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxRotation: 45,
            minRotation: 0,
            // Shared by Geographic Distribution (municipality/barangay
            // names — can run long) as well as the Referral/SOS status
            // charts (short labels, unaffected by the cap). Full name
            // still shows in the tooltip, read straight from the data.
            callback(value) {
              const label = this.getLabelForValue(value as number);
              return label.length > 14 ? `${label.slice(0, 13)}…` : label;
            },
          },
        },
      },
    }),
    [reducedMotion]
  );
  const lineOptions: ChartOptions<'line'> = useMemo(
    () => ({
      animation: reducedMotion ? false : { duration: 700, easing: 'easeOutQuart' },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    }),
    [reducedMotion]
  );

  // Trend bucketing: day-of-week-month granularity chosen by the span
  // actually present in the filtered data — never claims a trend with
  // fewer than 2 distinct buckets of data.
  const trend = useMemo(() => {
    if (cases.length === 0) return { labels: [] as string[], values: [] as number[] };
    const dates = cases.map((c) => new Date(c.reported_at).getTime());
    const spanDays = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
    const bucketKey = (iso: string) => {
      const d = new Date(iso);
      if (spanDays <= 45) return d.toISOString().slice(0, 10); // daily
      if (spanDays <= 210) {
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      }
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); // monthly
    };
    const map = new Map<string, number>();
    cases.forEach((c) => {
      const k = bucketKey(c.reported_at);
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    const entries = Array.from(map.entries());
    return { labels: entries.map(([l]) => l), values: entries.map(([, v]) => v) };
  }, [cases]);

  const sosList = sos as SosAlert[];

  return (
    <div>
      <PageHeader
        title="Case Analytics"
        subtitle={`Scope: ${scopeLabel}`}
        actions={<DashboardHeaderActions showSearch={hasPermission(profile?.role, 'cases.view')} lastUpdated={lastUpdated} refreshing={polling} onRefresh={() => reload()} />}
      />

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
      ) : (
        <div>
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

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Case Trend</h3>
            {loading ? (
              <div className="skeleton" style={{ height: 220 }} />
            ) : trend.labels.length < 2 ? (
              <div className="dash-chart-empty">
                <p>Insufficient data for trend analysis.</p>
              </div>
            ) : (
              <div className="chart-box" style={{ height: 240 }}>
                <Line data={{ labels: trend.labels, datasets: [{ label: 'Cases', data: trend.values, borderColor: '#1456A0', backgroundColor: 'rgba(20,86,160,0.12)', fill: true, tension: 0.3 }] }} options={chartBaseOptions(lineOptions)} />
              </div>
            )}
          </div>

          <div className="dash-chart-row dash-chart-row-3" style={{ marginBottom: 20 }}>
            <ChartCard title="Case Status" data={byStatus} options={doughnutOptions} loading={loading} />
            <ChartCard title="Case Classification" data={byType} options={doughnutOptions} loading={loading} />
            <ChartCard title="Report Source" data={bySource} options={doughnutOptions} loading={loading} />
          </div>

          {geographicDistribution && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Geographic Distribution — {geographicLabel}</h3>
              {loading ? (
                <div className="skeleton" style={{ height: 220 }} />
              ) : geographicDistribution.length === 0 ? (
                <div className="dash-chart-empty"><p>No cases match the selected filters.</p></div>
              ) : (
                <div className="table-responsive">
                  <div className="chart-box" style={{ height: 220, minWidth: Math.max(480, geographicDistribution.length * 90) }}>
                    <Bar
                      data={{ labels: geographicDistribution.map((m) => m.label), datasets: [{ label: 'Cases', data: geographicDistribution.map((m) => m.count), backgroundColor: '#1456A0', borderRadius: 6, maxBarThickness: 40 }] }}
                      options={chartBaseOptions(barOptions)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Referral Analytics</h3>
            {loading ? (
              <div className="skeleton" style={{ height: 200 }} />
            ) : referralByStatus.length === 0 ? (
              <div className="dash-chart-empty"><p>No shelter referrals match the selected filters.</p></div>
            ) : (
              <div className="chart-box" style={{ height: 200 }}>
                <Bar data={{ labels: referralByStatus.map((r) => r.label), datasets: [{ label: 'Referrals', data: referralByStatus.map((r) => r.count), backgroundColor: '#4C82B3', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
              </div>
            )}
          </div>

          {roleTier !== 'barangay' && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 4, fontSize: 15.5 }}>SOS / Emergency Analytics</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                SOS alerts are a survivor-level record, not linked to a specific case — shown here as an independent scope, matching the same date/geographic filters.
              </p>
              {loading ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : sosList.length === 0 ? (
                <div className="dash-chart-empty"><p>No SOS alerts match the selected filters.</p></div>
              ) : (
                <div className="dash-chart-row dash-chart-row-metric">
                  <div className="dash-sos-metric">
                    <div className="dash-kpi-value">
                      <AnimatedNumber value={sosList.length} />
                    </div>
                    <div className="dash-kpi-label">Total SOS alerts</div>
                  </div>
                  <div className="chart-box" style={{ height: 180 }}>
                    <Bar data={{ labels: sosByStatus.map((s) => s.label), datasets: [{ label: 'SOS Alerts', data: sosByStatus.map((s) => s.count), backgroundColor: '#D94B63', borderRadius: 6, maxBarThickness: 56 }] }} options={chartBaseOptions(barOptions)} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { ClipboardList, Clock, Activity, CheckCircle2, Siren } from 'lucide-react';
import '../../lib/chartSetup';
import { CHART_COLORS, chartBaseOptions } from '../../lib/chartSetup';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader, StatusBadge } from '../../components/ui';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import type { CaseReport } from '../../types/database.types';

// Same dash-kpi-card system as ProvincialDashboard — one shared visual
// language for "the headline numbers of a dashboard" across every
// admin tier, not a lookalike reimplementation. Kept local (rather
// than extracted) since its `to` targets and available metrics differ
// per dashboard, same reasoning ProvincialDashboard's own copy started
// from before that one grew its own click-through behavior.
function KpiCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
  loading,
  to,
  emphasize,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  context: string;
  color: string;
  tint: string;
  iconBg: string;
  loading: boolean;
  to?: string;
  emphasize?: boolean;
}) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <div
      className={`dash-kpi-card${clickable ? ' dash-kpi-card--clickable' : ''}${emphasize ? ' dash-kpi-card--emphasis' : ''}`}
      style={{ ['--kpi-tint' as string]: tint, ['--kpi-accent' as string]: color }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `View ${label} — ${context}` : undefined}
      onClick={clickable ? () => navigate(to) : undefined}
      onKeyDown={
        clickable
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
          <AnimatedNumber value={value} />
        </span>
      )}
      <span className="dash-kpi-context">{context}</span>
    </div>
  );
}

function KpiSkeletonCard() {
  return (
    <div className="dash-kpi-card">
      <div className="skeleton skeleton-circle" style={{ width: 32, height: 32 }} />
      <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      <div className="skeleton skeleton-text" style={{ width: 48, height: 24 }} />
      <div className="skeleton skeleton-text" style={{ width: '80%' }} />
    </div>
  );
}

// Reused, scoped down, for barangay_admin (see DashboardRouter) — the
// polished, purpose-built Barangay Dashboard from the full hierarchy
// design is a later phase; this gives barangay admins something real to
// land on now without new dashboard UI. When `scope === 'barangay'`,
// cases are filtered to CURRENT barangay ownership instead of
// municipality, and the SOS stat is hidden entirely rather than shown at
// municipality-wide scope — sos_alerts has no barangay-level column in
// Phase 1's schema, and showing municipality-wide SOS data to a barangay
// admin would leak visibility beyond what RLS otherwise scopes them to.
export function MunicipalDashboard({ scope = 'municipality' }: { scope?: 'municipality' | 'barangay' }) {
  const { profile, municipality, barangay } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      if (scope === 'barangay') {
        if (!profile?.barangay_id) {
          setLoading(false);
          setRefreshing(false);
          return;
        }
        const { data: caseRows } = await supabase
          .from('case_reports')
          .select('*')
          .eq('owner_level', 'Barangay')
          .eq('owner_barangay_id', profile.barangay_id)
          .order('reported_at', { ascending: false });
        setCases(caseRows ?? []);
        setLoading(false);
        setRefreshing(false);
        setLastUpdated(Date.now());
        return;
      }

      if (!profile?.municipality_id) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const { data: caseRows } = await supabase
        .from('case_reports')
        .select('*')
        .eq('municipality_id', profile.municipality_id)
        .order('reported_at', { ascending: false });
      setCases(caseRows ?? []);

      const { count } = await supabase
        .from('sos_alerts')
        .select('*, user_profiles!inner(municipality_id)', { count: 'exact', head: true })
        .eq('user_profiles.municipality_id', profile.municipality_id)
        .in('status', ['Triggered', 'Responding']);
      setActiveSosCount(count ?? 0);
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(Date.now());
    },
    [scope, profile?.municipality_id, profile?.barangay_id]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, profile?.municipality_id, profile?.barangay_id]);

  // No realtime subscription exists for this dashboard's aggregate case
  // stats, so this 60s poll is the primary sync mechanism here.
  useAutoRefresh(() => load(true));

  const total = cases.length;
  const pending = cases.filter((c) => c.status === 'Pending').length;
  const active = cases.filter((c) => ['Assigned', 'In Progress', 'Referred', 'Under Review'].includes(c.status)).length;
  const resolved = cases.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length;

  const byType = groupCount(cases, (c) => c.case_type);
  const byMonth = trendByMonth(cases);

  const title = scope === 'barangay' ? 'Barangay Dashboard' : 'Municipal Dashboard';
  const subtitle =
    scope === 'barangay'
      ? barangay
        ? `Barangay ${barangay.barangay_name}, ${municipality?.municipality_name ?? ''}`
        : undefined
      : municipality?.municipality_name ?? undefined;

  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({
      animation: reducedMotion
        ? false
        : { duration: 700, easing: 'easeOutQuart', delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 80 : 0) },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    }),
    [reducedMotion]
  );
  const doughnutOptions: ChartOptions<'doughnut'> = useMemo(
    () => ({
      animation: reducedMotion ? false : { duration: 700, easing: 'easeOutQuart' as const },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
    }),
    [reducedMotion]
  );

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => load(true)} />}
      />

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: scope === 'barangay' ? 'repeat(4, 1fr)' : 'repeat(5, 1fr)' }}>
        {loading ? (
          Array.from({ length: scope === 'barangay' ? 4 : 5 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={ClipboardList} label="Total Cases" value={total} context="All reported cases" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} to="/admin/cases" />
            <KpiCard icon={Clock} label="Pending" value={pending} context="Awaiting review" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} to="/admin/cases?status=Pending" />
            <KpiCard icon={Activity} label="Active" value={active} context="Currently in progress" color="var(--color-info)" tint="var(--kpi-tint-info)" iconBg="var(--kpi-icon-info)" loading={loading} to="/admin/cases" />
            <KpiCard icon={CheckCircle2} label="Resolved" value={resolved} context="Closed or resolved" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} to="/admin/cases?status=Resolved" />
            {scope !== 'barangay' && (
              <KpiCard icon={Siren} label="Active SOS" value={activeSosCount} context="Needs immediate attention" color="var(--color-danger)" tint="var(--kpi-tint-danger)" iconBg="var(--kpi-icon-danger)" loading={loading} to="/admin/sos" emphasize />
            )}
          </>
        )}
      </div>

      <div className="dash-chart-row dash-chart-row-2-wide" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Case trend (last 6 months)</h3>
          {byMonth.length === 0 ? (
            <div className="dash-chart-empty"><p>No cases yet.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 240 }}>
              <Bar
                data={{
                  labels: byMonth.map((m) => m.label),
                  datasets: [{ label: 'Reports', data: byMonth.map((m) => m.count), backgroundColor: '#1456A0', hoverBackgroundColor: '#0B3A82', borderRadius: 6, maxBarThickness: 56 }],
                }}
                options={chartBaseOptions(barOptions)}
              />
            </div>
          )}
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Cases by type</h3>
          {byType.length === 0 ? (
            <div className="dash-chart-empty"><p>No cases yet.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 220 }}>
              <Doughnut
                data={{
                  labels: byType.map((t) => t.label),
                  datasets: [{ data: byType.map((t) => t.count), backgroundColor: CHART_COLORS }],
                }}
                options={chartBaseOptions(doughnutOptions)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16, fontSize: 15.5 }}>Recent cases</h3>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 20 }} />)}
          </div>
        ) : cases.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No cases reported yet.</p>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Reported</th>
                </tr>
              </thead>
              <tbody>
                {cases.slice(0, 8).map((c) => (
                  <tr key={c.case_id}>
                    <td>
                      <Link to={`/admin/cases/${c.case_id}`}>{c.case_number}</Link>
                    </td>
                    <td>{c.case_type}</td>
                    <td>
                      <StatusBadge label={c.priority_level} />
                    </td>
                    <td>
                      <StatusBadge label={c.status} />
                    </td>
                    <td>{new Date(c.reported_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function groupCount<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
}

function trendByMonth(cases: CaseReport[]) {
  const now = new Date();
  const months: { label: string; key: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString(undefined, { month: 'short' }), key: `${d.getFullYear()}-${d.getMonth()}`, count: 0 });
  }
  for (const c of cases) {
    const d = new Date(c.reported_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.count += 1;
  }
  return months;
}

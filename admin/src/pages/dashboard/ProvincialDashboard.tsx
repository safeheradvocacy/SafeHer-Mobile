import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  ClipboardList,
  Clock,
  Activity,
  CheckCircle2,
  Siren,
  Home,
  ChevronRight,
  BarChart3,
  AlertTriangle,
  MapPin,
  Building2,
} from 'lucide-react';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader, StatusBadge } from '../../components/ui';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import type { CaseReport, Municipality, Shelter, SosAlert } from '../../types/database.types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------
// KPI card — icon, label, animated count-up value, short contextual line.
// A skeleton stands in for the value while the initial fetch is pending.
// ---------------------------------------------------------------------
function DashboardStatCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
  loading,
  formatter,
  emphasize,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  context: string;
  /** Drives the accent bar, icon glyph, and the KPI number itself — one
      semantic color for the whole card, so they always read as a set. */
  color: string;
  /** Very light (~8-13%) card wash — see --kpi-tint-* in theme.css. */
  tint: string;
  /** One layer stronger than `tint`, so the icon chip still reads as
      distinct from the card behind it. */
  iconBg: string;
  loading: boolean;
  formatter?: (n: number) => string;
  /** Active SOS only — a touch more presence via a tinted border, not
      motion, since it's the one emergency metric in the row. */
  emphasize?: boolean;
  /** Route this card navigates to on click/Enter/Space — the whole card
      acts as a button, not just a "view" link tucked in a corner. */
  to: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`dash-kpi-card dash-kpi-card--clickable${emphasize ? ' dash-kpi-card--emphasis' : ''}`}
      style={{ ['--kpi-tint' as string]: tint, ['--kpi-accent' as string]: color }}
      role="button"
      tabIndex={0}
      aria-label={`View ${label} — ${context}`}
      onClick={() => navigate(to)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(to);
        }
      }}
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

// A compact "Section title | View all →" navigational link, shared by
// all three operational-monitoring cards and Municipality Overview —
// text-and-arrow, not a filled pill button, to stay visually quiet next
// to the actual content it's attached to.
function ViewAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="dash-view-all">
      {label} <ChevronRight size={13} />
    </Link>
  );
}

type ChartRange = 'today' | 'week' | 'month' | 'year' | 'all';
const CHART_RANGE_LABEL: Record<ChartRange, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
};

function rangeCutoff(range: ChartRange): Date | null {
  const now = new Date();
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (range === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  if (range === 'year') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null;
}

export function ProvincialDashboard() {
  const { profile } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [recentSos, setRecentSos] = useState<SosAlert[]>([]);
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [activeSosByMuni, setActiveSosByMuni] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>('all');
  const [newSosIds, setNewSosIds] = useState<Set<string>>(new Set());
  const prevSosIdsRef = useRef<Set<string> | null>(null);

  const fetchAll = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);

      const [caseRes, muniRes, shelterRes, sosActiveRes, sosRecentRes] = await Promise.all([
        supabase.from('case_reports').select('*'),
        supabase.from('municipalities').select('*').eq('is_active', true).order('municipality_name'),
        supabase.from('shelters').select('*').eq('is_active', true),
        // Explicit FK hint required — sos_alerts now has two FKs into
        // user_profiles (profile_id, and acknowledged_by added by
        // module19), so a bare `user_profiles(...)` embed is ambiguous
        // and PostgREST rejects it (PGRST201).
        supabase
          .from('sos_alerts')
          .select('sos_id, status, user_profiles!sos_alerts_profile_id_fkey(municipality_id)')
          .in('status', ['Triggered', 'Responding']),
        // Secondary sort by sos_id is deliberate, not cosmetic: without
        // a tiebreaker, Postgres can return a different subset/order on
        // ties at the LIMIT boundary across separate calls, which would
        // make identical data look "new" on every refresh (false
        // animation replays) instead of only genuinely new rows.
        supabase.from('sos_alerts').select('*').order('triggered_at', { ascending: false }).order('sos_id', { ascending: false }).limit(5),
      ]);

      if (caseRes.error || muniRes.error || shelterRes.error || sosActiveRes.error || sosRecentRes.error) {
        console.error('[ProvincialDashboard] fetchAll:', {
          cases: caseRes.error,
          municipalities: muniRes.error,
          shelters: shelterRes.error,
          sosActive: sosActiveRes.error,
          sosRecent: sosRecentRes.error,
        });
        setError(true);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const activeRows = (sosActiveRes.data ?? []) as unknown as { sos_id: string; user_profiles: { municipality_id: string | null } | null }[];
      const byMuni: Record<string, number> = {};
      activeRows.forEach((row) => {
        const muniId = row.user_profiles?.municipality_id;
        if (muniId) byMuni[muniId] = (byMuni[muniId] ?? 0) + 1;
      });

      setCases(caseRes.data ?? []);
      setMunicipalities(muniRes.data ?? []);
      setShelters(shelterRes.data ?? []);
      setActiveSosCount(activeRows.length);
      setActiveSosByMuni(byMuni);
      setRecentSos(sosRecentRes.data ?? []);
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(Date.now());
    },
    [profile]
  );

  useEffect(() => {
    fetchAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one coordinated 60s sync for this dashboard — no realtime
  // subscription exists for province-wide aggregate stats (unlike the
  // shelter/support/law-enforcement dashboards' own work queues), so
  // this poll is the primary refresh mechanism here, not a fallback.
  useAutoRefresh(() => fetchAll(true));

  // Marks genuinely NEW rows in Recent SOS Alerts (arrived since the
  // last fetch) for a brief one-shot entrance highlight — never on the
  // very first load, so opening the dashboard doesn't highlight every
  // pre-existing alert as "new". Gated on `!loading` deliberately: this
  // effect also fires on the very first render, while `recentSos` is
  // still its empty initial-state value (before fetchAll has resolved)
  // — without the loading guard, that empty array would seed
  // prevSosIdsRef with an empty-but-non-null (i.e. truthy) Set, and the
  // real data arriving right after would then compare against that
  // bogus empty baseline and flag every real row as "new".
  useEffect(() => {
    if (loading) return;
    const currentIds = new Set(recentSos.map((s) => s.sos_id));
    if (prevSosIdsRef.current) {
      const fresh = new Set<string>();
      currentIds.forEach((id) => {
        if (!prevSosIdsRef.current!.has(id)) fresh.add(id);
      });
      if (fresh.size > 0) {
        setNewSosIds(fresh);
        const t = setTimeout(() => setNewSosIds(new Set()), 1600);
        prevSosIdsRef.current = currentIds;
        return () => clearTimeout(t);
      }
    }
    prevSosIdsRef.current = currentIds;
  }, [recentSos, loading]);

  const total = cases.length;
  const pending = cases.filter((c) => c.status === 'Pending').length;
  const active = cases.filter((c) => ['Assigned', 'In Progress', 'Referred', 'Under Review'].includes(c.status)).length;
  const resolved = cases.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length;

  const cutoff = useMemo(() => rangeCutoff(chartRange), [chartRange]);
  const casesInRange = useMemo(
    () => (cutoff ? cases.filter((c) => new Date(c.reported_at) >= cutoff) : cases),
    [cases, cutoff]
  );
  const casesByMuni = municipalities.map((m) => ({
    id: m.municipality_id,
    name: m.municipality_name,
    count: casesInRange.filter((c) => c.municipality_id === m.municipality_id).length,
  }));
  const chartHasData = casesByMuni.some((m) => m.count > 0);

  const totalCapacity = shelters.reduce((sum, s) => sum + s.capacity, 0);
  const totalOccupancy = shelters.reduce((sum, s) => sum + s.current_occupancy, 0);
  const hasCapacityData = shelters.some((s) => s.capacity > 0);
  const utilization = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;

  const municipalityName = (id: string) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? 'Unknown';

  const recentCases = [...cases]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 5);

  // Ranked by case volume, not alphabetically — the busiest municipalities
  // are what a provincial overview should surface first. Full list lives
  // on the dedicated Municipality Management page.
  const municipalityOverviewRows = [...municipalities]
    .map((m) => ({
      municipality: m,
      cases: cases.filter((c) => c.municipality_id === m.municipality_id).length,
      activeSos: activeSosByMuni[m.municipality_id] ?? 0,
      shelters: shelters.filter((s) => s.municipality_id === m.municipality_id).length,
    }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 5);

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion
      ? false
      : {
          duration: 800,
          easing: 'easeOutQuart',
          delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 60 : 0),
        },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#172033',
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: 'Inter', weight: 'bold' },
        bodyFont: { family: 'Inter' },
        callbacks: { label: (ctx) => `${ctx.parsed.y} case${ctx.parsed.y === 1 ? '' : 's'}` },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: 'rgba(229,226,236,0.7)' } },
      x: {
        grid: { display: false },
        ticks: {
          autoSkip: true,
          maxRotation: 45,
          minRotation: 0,
          // Municipality names vary a lot in length; a hard cap keeps one
          // long name from widening its tick beyond its neighbors. The
          // full name still shows in the tooltip (Chart.js reads that
          // straight from the data, not through this tick callback).
          callback(value) {
            const label = this.getLabelForValue(value as number);
            return label.length > 14 ? `${label.slice(0, 13)}…` : label;
          },
        },
      },
    },
  };

  if (error) {
    return (
      <div>
        <PageHeader title="Provincial Dashboard" subtitle="Province-wide oversight across all municipalities" />
        <div className="card dash-error-state">
          <div className="dash-error-icon">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>
          <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Unable to load dashboard data</h4>
          <p style={{ fontSize: 13, marginBottom: 18, maxWidth: 340 }}>
            Something went wrong while loading the latest figures. Your data is safe — please try again.
          </p>
          <button className="btn btn-primary" onClick={() => fetchAll(false)}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Provincial Dashboard"
        subtitle="Province-wide oversight across all municipalities"
        actions={
          <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => fetchAll(true)} />
        }
      />

      <div className="dash-kpi-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <DashboardStatCard icon={ClipboardList} label="Total Cases" value={total} context="All reported cases" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" loading={loading} to="/admin/cases" />
            <DashboardStatCard icon={Clock} label="Pending" value={pending} context="Awaiting review" color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" loading={loading} to="/admin/cases?status=Pending" />
            <DashboardStatCard icon={Activity} label="Active" value={active} context="Currently in progress" color="var(--color-info)" tint="var(--kpi-tint-info)" iconBg="var(--kpi-icon-info)" loading={loading} to="/admin/cases" />
            <DashboardStatCard icon={CheckCircle2} label="Resolved" value={resolved} context="Closed or resolved" color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" loading={loading} to="/admin/cases?status=Resolved" />
            <DashboardStatCard icon={Siren} label="Active SOS" value={activeSosCount} context="Needs immediate attention" color="var(--color-danger)" tint="var(--kpi-tint-danger)" iconBg="var(--kpi-icon-danger)" loading={loading} emphasize to="/admin/sos" />
            <DashboardStatCard
              icon={Home}
              label="Shelter Occupancy"
              value={utilization}
              context={hasCapacityData ? `${totalOccupancy} of ${totalCapacity} beds in use` : 'No capacity data configured'}
              color="var(--color-primary-dark)"
              tint="var(--kpi-tint-primary)"
              iconBg="var(--kpi-icon-primary)"
              loading={loading}
              formatter={(n) => (hasCapacityData ? `${n}%` : '—')}
              to="/admin/shelter-management"
            />
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15.5 }}>Cases by Municipality</h3>
          <select
            className="input dash-chart-filter"
            value={chartRange}
            onChange={(e) => setChartRange(e.target.value as ChartRange)}
            aria-label="Filter cases by time range"
          >
            {(Object.keys(CHART_RANGE_LABEL) as ChartRange[]).map((r) => (
              <option key={r} value={r}>{CHART_RANGE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : !chartHasData ? (
          <div className="dash-chart-empty">
            <div className="dash-chart-empty-icon">
              <BarChart3 size={22} strokeWidth={2} />
            </div>
            <h4>No cases reported</h4>
            <p>No cases have been reported for this period.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <div className="chart-box" style={{ minWidth: Math.max(480, casesByMuni.length * 90), height: 240 }}>
              <Bar
                data={{
                  labels: casesByMuni.map((m) => m.name),
                  datasets: [
                    {
                      label: 'Cases',
                      data: casesByMuni.map((m) => m.count),
                      backgroundColor: '#1456A0',
                      hoverBackgroundColor: '#0B3A82',
                      borderRadius: 6,
                      maxBarThickness: 40,
                    },
                  ],
                }}
                options={chartBaseOptions(chartOptions)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="dash-widget-grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent SOS Alerts</h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 34 }} />)}
            </div>
          ) : recentSos.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              There are currently no SOS alerts requiring immediate attention.
            </p>
          ) : (
            <>
              {recentSos.map((s) => (
                <div key={s.sos_id} className={`dash-widget-row${newSosIds.has(s.sos_id) ? ' dash-widget-row--new' : ''}`}>
                  <div className="dash-widget-row-main">
                    <span className="dash-widget-row-title" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {s.status === 'Triggered' && <span className="dash-sos-pulse" aria-hidden="true" />}
                      <MapPin size={12} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
                      {s.location_address ?? 'Location unavailable'}
                    </span>
                    <span className="dash-widget-row-sub">{formatDate(s.triggered_at)}</span>
                  </div>
                  <StatusBadge label={s.status} />
                </div>
              ))}
              <ViewAllLink to="/admin/sos" label="View SOS monitoring" />
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent Cases</h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 34 }} />)}
            </div>
          ) : recentCases.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No newly reported cases at this time.</p>
          ) : (
            <>
              {recentCases.map((c) => (
                <div key={c.case_id} className="dash-widget-row">
                  <div className="dash-widget-row-main">
                    <span className="dash-widget-row-title">{c.case_number}</span>
                    <span className="dash-widget-row-sub">{municipalityName(c.municipality_id)} Â· {formatDate(c.reported_at)}</span>
                  </div>
                  <StatusBadge label={c.status} />
                </div>
              ))}
              <ViewAllLink to="/admin/cases" label="View all cases" />
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Shelter Overview</h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 34 }} />)}
            </div>
          ) : shelters.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No active shelters recorded yet.</p>
          ) : (
            <>
              <div className="dash-widget-row">
                <div className="dash-widget-row-main">
                  <span className="dash-widget-row-title">Available shelters</span>
                </div>
                <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{shelters.length}</span>
              </div>
              <div className="dash-widget-row">
                <div className="dash-widget-row-main">
                  <span className="dash-widget-row-title">Occupancy</span>
                </div>
                <span style={{ fontWeight: 700, color: hasCapacityData ? 'var(--color-primary-dark)' : 'var(--color-text-subtle)' }}>
                  {hasCapacityData ? `${utilization}%` : 'No data'}
                </span>
              </div>
              <div className="dash-widget-row">
                <div className="dash-widget-row-main">
                  <span className="dash-widget-row-title">Available capacity</span>
                </div>
                <span style={{ fontWeight: 700, color: hasCapacityData ? 'var(--color-success)' : 'var(--color-text-subtle)' }}>
                  {hasCapacityData ? `${Math.max(0, totalCapacity - totalOccupancy)} beds` : 'Not configured'}
                </span>
              </div>
              <ViewAllLink to="/admin/shelter-management" label="Manage shelters" />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15.5 }}>Municipality Overview</h3>
        </div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 20 }} />)}
          </div>
        ) : municipalities.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No municipalities recorded yet.</p>
        ) : (
          <>
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Municipality</th>
                    <th>Cases</th>
                    <th>Active SOS</th>
                    <th>Shelters</th>
                    <th>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={12} /> Status
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {municipalityOverviewRows.map((row) => (
                    <tr key={row.municipality.municipality_id}>
                      <td>{row.municipality.municipality_name}</td>
                      <td>{row.cases}</td>
                      <td style={row.activeSos > 0 ? { color: 'var(--color-danger)', fontWeight: 700 } : undefined}>{row.activeSos}</td>
                      <td>{row.shelters}</td>
                      <td>
                        <StatusBadge label={row.municipality.is_active ? 'Active' : 'Inactive'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ViewAllLink to="/admin/municipalities" label="View all municipalities" />
          </>
        )}
      </div>
    </div>
  );
}

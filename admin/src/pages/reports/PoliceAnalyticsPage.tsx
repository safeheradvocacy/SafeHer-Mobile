import React, { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/chartSetup';
import { chartBaseOptions } from '../../lib/chartSetup';
import { ClipboardList, Siren, Download, Clock3, Activity, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAudit } from '../../lib/audit';
import { downloadCsv } from '../../lib/exportCsv';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { usePoliceSosAlerts, sosElapsedMinutes } from '../../hooks/usePoliceSosAlerts';
import { bucketOf as caseBucketOf, useLawEnforcementReferrals } from '../../hooks/useLawEnforcementReferrals';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PageHeader, StatusBadge } from '../../components/ui';
import { groupCount, KpiCard, KpiSkeletonCard, ChartCard } from './reportsUi';
import type { SosAlert } from '../../types/database.types';

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

  const inRange = (iso: string) => {
    if (dateFrom && iso < `${dateFrom}T00:00:00`) return false;
    if (dateTo && iso >= `${dateTo}T23:59:59.999`) return false;
    return true;
  };

  const filteredAlerts = useMemo(() => alerts.filter((a) => inRange(a.triggered_at)), [alerts, dateFrom, dateTo]);
  const filteredReferrals = useMemo(() => caseReferrals.filter((r) => inRange(r.created_at)), [caseReferrals, dateFrom, dateTo]);

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

  const exportSos = () => {
    const filename = `police-sos-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      filename,
      filteredAlerts.map((a: SosAlert) => ({
        sos_id: a.sos_id,
        status: a.status,
        triggered_at: a.triggered_at,
        acknowledged_at: a.acknowledged_at ?? '',
        resolved_at: a.resolved_at ?? '',
        location_address: a.location_address ?? '',
      })),
      [
        { key: 'sos_id', label: 'SOS ID' },
        { key: 'status', label: 'Status' },
        { key: 'triggered_at', label: 'Triggered At' },
        { key: 'acknowledged_at', label: 'Acknowledged At' },
        { key: 'resolved_at', label: 'Resolved At' },
        { key: 'location_address', label: 'Location' },
      ]
    );
    if (profile) {
      logAudit({ profileId: profile.profile_id, action: 'REPORT_EXPORT_CSV', tableName: 'sos_alerts', recordId: profile.profile_id, newValues: { filename, rowCount: filteredAlerts.length } });
    }
    showToast('success', `Exported ${filename}.`);
  };

  const exportReferrals = () => {
    const filename = `police-incident-referrals-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      filename,
      filteredReferrals.map((r) => ({
        referral_id: r.referral_id,
        case_number: r.case_reports?.case_number ?? '',
        status: r.status,
        created_at: r.created_at,
        action_taken_at: r.action_taken_at ?? '',
      })),
      [
        { key: 'referral_id', label: 'Referral ID' },
        { key: 'case_number', label: 'Case #' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Referred At' },
        { key: 'action_taken_at', label: 'Action Taken At' },
      ]
    );
    if (profile) {
      logAudit({ profileId: profile.profile_id, action: 'REPORT_EXPORT_CSV', tableName: 'law_enforcement_referrals', recordId: profile.profile_id, newValues: { filename, rowCount: filteredReferrals.length } });
    }
    showToast('success', `Exported ${filename}.`);
  };

  const barOptions: ChartOptions<'bar'> = useMemo(
    () => ({ animation: reducedMotion ? false : { duration: 700 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }),
    [reducedMotion]
  );

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
        <ChartCard title="SOS Alerts by Status" data={sosByStatus} options={doughnutOptions} loading={loading} emptyText="No SOS alerts match the selected period." />
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}>Status Breakdown</h3>
            <button className="btn btn-outline btn-sm report-no-print" onClick={exportSos} disabled={filteredAlerts.length === 0}>
              <Download size={13} /> Export CSV
            </button>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : sosByStatus.length === 0 ? (
            <div className="dash-chart-empty"><p>No SOS alerts match the selected period.</p></div>
          ) : (
            <div className="chart-box" style={{ height: 180 }}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Referral Detail</h3>
          <button className="btn btn-outline btn-sm report-no-print" onClick={exportReferrals} disabled={filteredReferrals.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
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
    </div>
  );
}

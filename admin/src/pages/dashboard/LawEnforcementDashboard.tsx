import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { SosSoundToggle } from '../../components/sos/SosSoundToggle';
import { useLawEnforcementReferrals, bucketOf as caseBucketOf, type LeReferralRow } from '../../hooks/useLawEnforcementReferrals';
import { useSosAlertContext, bucketOf as sosBucketOf, isCriticalSos, sosElapsedMinutes, sosUrgencyScore } from '../../contexts/SosAlertContext';
import type { SosAlert } from '../../types/database.types';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function elapsedLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// Two distinctly-shaped recent-activity entries (an SOS alert has no
// referral_id/updated_at — it was never a referral row, module19) —
// tagged with `kind` rather than assumed to share one shape, and each
// given its own normalized "last activity" timestamp: resolved/
// acknowledged/triggered for SOS, the referral's own updated_at for a
// case referral.
type ActivityEntry =
  | { kind: 'sos'; at: string; alert: SosAlert }
  | { kind: 'case'; at: string; referral: LeReferralRow };

// Police Officer overview (module19: "Police Dashboard" in the UI — the
// law_enforcement role string is unchanged). SOS alerts are now direct,
// unconditional, province-wide access (usePoliceSosAlerts) — no referral
// involved. Case referrals remain assignment-scoped exactly as before
// (useLawEnforcementReferrals, trimmed to case_id-only). The two are
// never combined into one metric; every card/section below is explicitly
// scoped to one or the other. "Critical SOS" and urgency ordering use
// only real, existing data (sos_alerts.status/triggered_at) — sos_alerts
// has no severity column, so none is fabricated.
export function LawEnforcementDashboard() {
  const sos = useSosAlertContext();
  const caseReferrals = useLawEnforcementReferrals();

  const loading = sos.loading || caseReferrals.loading;
  const refreshing = sos.refreshing || caseReferrals.refreshing;
  const error = sos.error || caseReferrals.error;
  const lastUpdated = Math.max(sos.lastUpdated ?? 0, caseReferrals.lastUpdated ?? 0) || null;
  const reload = (isRefresh = true) => {
    sos.reload(isRefresh);
    caseReferrals.reload(isRefresh);
  };

  const sosStats = useMemo(() => {
    const active = sos.alerts.filter((a) => sosBucketOf(a) !== 'completed');
    return {
      critical: active.filter(isCriticalSos).length,
      new: sos.alerts.filter((a) => sosBucketOf(a) === 'new').length,
      active: sos.alerts.filter((a) => sosBucketOf(a) === 'active').length,
    };
  }, [sos.alerts]);

  const activeCaseCount = useMemo(
    () => caseReferrals.caseReferrals.filter((r) => caseBucketOf(r) === 'active').length,
    [caseReferrals.caseReferrals]
  );

  const urgentSos = useMemo(
    () =>
      sos.alerts
        .filter((a) => sosBucketOf(a) !== 'completed')
        .slice()
        .sort((a, b) => sosUrgencyScore(b) - sosUrgencyScore(a))
        .slice(0, 5),
    [sos.alerts]
  );

  const recentCases = useMemo(() => caseReferrals.caseReferrals.slice(0, 5), [caseReferrals.caseReferrals]);

  const recentActivity = useMemo<ActivityEntry[]>(() => {
    const sosEntries: ActivityEntry[] = sos.alerts.map((alert) => ({
      kind: 'sos',
      at: alert.resolved_at ?? alert.acknowledged_at ?? alert.triggered_at,
      alert,
    }));
    const caseEntries: ActivityEntry[] = caseReferrals.caseReferrals.map((referral) => ({
      kind: 'case',
      at: referral.updated_at,
      referral,
    }));
    return [...sosEntries, ...caseEntries]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);
  }, [sos.alerts, caseReferrals.caseReferrals]);

  return (
    <div>
      <PageHeader
        title="Police Dashboard"
        subtitle="Direct access to emergency SOS alerts and case referrals assigned to you"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SosSoundToggle />
            <DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => reload(true)} />
          </div>
        }
      />

      {error && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</p>
          <button className="btn btn-outline btn-sm" onClick={() => reload(false)}>
            Retry
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Critical SOS" value={loading ? '–' : sosStats.critical} accent="var(--color-danger)" />
        <StatCard label="New SOS" value={loading ? '–' : sosStats.new} />
        <StatCard label="Active SOS" value={loading ? '–' : sosStats.active} />
        <StatCard label="Active Case Referrals" value={loading ? '–' : activeCaseCount} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3>Urgent SOS Alerts</h3>
          <Link to="/admin/law-enforcement/sos-referrals" className="btn btn-outline btn-sm">
            View all SOS alerts
          </Link>
        </div>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : urgentSos.length === 0 ? (
          <EmptyState title="No open SOS alerts" subtitle="New emergency alerts appear here immediately, most urgent first." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {urgentSos.map((a) => (
              <div
                key={a.sos_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {isCriticalSos(a) && <StatusBadge label="Critical" />}
                    <StatusBadge label={a.status} />
                    {!a.acknowledged_by && <StatusBadge label="Unacknowledged" />}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Waiting {elapsedLabel(sosElapsedMinutes(a))} · Triggered {timeAgo(a.triggered_at)}
                  </span>
                </div>
                <Link to="/admin/law-enforcement/sos-referrals" className="btn btn-primary btn-sm">
                  Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3>Recent Case Referrals</h3>
          <Link to="/admin/law-enforcement/case-referrals" className="btn btn-outline btn-sm">
            View all case referrals
          </Link>
        </div>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : recentCases.length === 0 ? (
          <EmptyState title="No case referrals yet" subtitle="Cases referred to you for authorized review will appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentCases.map((r) => (
              <div
                key={r.referral_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 14 }}>{r.case_reports?.case_number ?? 'Referred case'}</strong>
                    <StatusBadge label={r.status} />
                    {r.case_reports?.priority_level && <StatusBadge label={r.case_reports.priority_level} />}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {r.case_reports?.case_type ?? 'Case'} · Referred {timeAgo(r.created_at)}
                  </span>
                </div>
                <Link to="/admin/law-enforcement/case-referrals" className="btn btn-primary btn-sm">
                  Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Recent Activity</h3>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : recentActivity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentActivity.map((entry) => (
              <div
                key={entry.kind === 'sos' ? entry.alert.sos_id : entry.referral.referral_id}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}
              >
                <span>
                  {entry.kind === 'sos' ? (
                    <>SOS alert — <StatusBadge label={entry.alert.status} /></>
                  ) : (
                    <>Case {entry.referral.case_reports?.case_number ?? 'referral'} — <StatusBadge label={entry.referral.status} /></>
                  )}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>{timeAgo(entry.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

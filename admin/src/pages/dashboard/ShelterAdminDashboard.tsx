import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, ArrowLeftRight, Activity, Home, Percent, ChevronRight } from 'lucide-react';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useShelterAdminData, HIGH_PRIORITY_URGENCY } from '../../hooks/useShelterAdminData';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A concise operational overview (master prompt: "Separate SafeSpace
// Shelter Administrator Functions into Dedicated Navigation Pages") —
// everything this used to own directly (the full searchable Requests &
// Referrals table, the Shelter Information edit form, the detailed
// capacity editor, the map) now lives on its own dedicated page under
// SHELTER MANAGEMENT / REQUESTS & REFERRALS; this page only summarizes
// and links out, via useShelterAdminData() — the same shared fetch/
// derive layer those pages use, so the numbers here can never silently
// drift from what the dedicated pages show.
export function ShelterAdminDashboard() {
  const { profile, shelter, loading, refreshing, lastUpdated, loadError, reload, stats, pipelineStages, needsAttention } = useShelterAdminData();

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Shelter Dashboard" actions={<DashboardHeaderActions refreshing={false} onRefresh={() => {}} />} />
        <EmptyState title="No shelter assigned" subtitle="Contact your provincial administrator to have a shelter assigned to your account." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Shelter Dashboard"
        subtitle={shelter?.shelter_name}
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => reload(true)} />}
      />

      {/* ---------- Shelter header ---------- */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 22 }}>{shelter?.shelter_name ?? 'Shelter Dashboard'}</h2>
              <StatusBadge label={shelter?.is_active ? 'Active' : 'Inactive'} />
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>Shelter Administrator · {shelter?.address ?? '—'}</p>
            <p style={{ fontSize: 13, marginTop: 10 }}>
              <strong>{shelter?.current_occupancy ?? 0} / {shelter?.capacity ?? '—'}</strong> occupied
              <span style={{ color: 'var(--color-text-muted)' }}> · {stats.availableCapacity} available</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-outline btn-sm" to="/admin/shelter/information">
              Shelter Information
            </Link>
            <Link className="btn btn-outline btn-sm" to="/admin/shelter/occupancy">
              Occupancy &amp; Placement
            </Link>
            <Link className="btn btn-outline btn-sm" to="/admin/shelter/services">
              Services
            </Link>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{loadError}</p>
          <button className="btn btn-outline btn-sm" onClick={() => reload()}>
            Retry
          </button>
        </div>
      )}

      {/* ---------- Operational summary ---------- */}
      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={Clock} label="Pending Requests" value={stats.pendingRequests} context={stats.pendingRequests > 0 ? `${stats.pendingRequests} require action` : 'All caught up'} color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" to="/admin/shelter/requests" />
            <KpiCard icon={ArrowLeftRight} label="Pending Referrals" value={stats.pendingReferrals} context={stats.pendingReferrals > 0 ? 'Awaiting your review' : 'None waiting'} color="var(--color-warning)" tint="var(--kpi-tint-warning)" iconBg="var(--kpi-icon-warning)" to="/admin/shelter/requests" />
            <KpiCard icon={Activity} label="Awaiting Review" value={stats.awaitingReview} context="In progress" color="var(--color-info)" tint="var(--kpi-tint-info)" iconBg="var(--kpi-icon-info)" to="/admin/shelter/requests" />
            <KpiCard icon={Home} label="Active Placements" value={stats.activePlacements} context="Currently housed" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" to="/admin/shelter/occupancy" />
            <KpiCard icon={Home} label="Available Capacity" value={stats.availableCapacity} context={`of ${shelter?.capacity ?? '—'} total`} color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" to="/admin/shelter/occupancy" />
            <KpiCard icon={Percent} label="Occupancy Rate" value={stats.occupancyRate} context="Of total capacity" color="var(--color-primary-dark)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" formatter={(n) => `${n}%`} to="/admin/shelter/occupancy" />
          </>
        )}
      </div>

      {/* ---------- Needs attention ---------- */}
      {!loading && needsAttention.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Needs Attention</h3>
            <Link to="/admin/shelter/requests" className="dash-view-all">
              View all <ChevronRight size={13} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {needsAttention.map((i) => (
              <div
                key={i.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <strong style={{ fontSize: 13 }}>{i.displayId}</strong>
                    <StatusBadge label={i.priority} />
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{i.source === 'request' ? 'Direct Survivor' : 'Agency Referral'}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Received {timeAgo(i.receivedAt)}</span>
                </div>
                <Link className="btn btn-primary btn-sm" to="/admin/shelter/requests">
                  Review
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Request pipeline summary ---------- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Request Pipeline</h3>
          <Link to="/admin/shelter/requests" className="dash-view-all">
            Requests &amp; Referrals <ChevronRight size={13} />
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {pipelineStages.map((stage, idx) => (
            <React.Fragment key={stage.label}>
              <div style={{ textAlign: 'center', minWidth: 84 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{loading ? '–' : stage.count}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{stage.label}</div>
              </div>
              {idx < pipelineStages.length - 1 && <span style={{ color: 'var(--color-border)', fontSize: 18, padding: '0 4px' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// Same dash-kpi-card system (and the exact clickable-card pattern) as
// ProvincialDashboard's DashboardStatCard — `to` makes the whole card a
// keyboard-operable button to the dedicated page that owns this metric's
// detail, not just a static number.
function KpiCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
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
  formatter?: (n: number) => string;
  to: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="dash-kpi-card dash-kpi-card--clickable"
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
      <span className="dash-kpi-value" style={{ color }}>
        <AnimatedNumber value={value} formatter={formatter} />
      </span>
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

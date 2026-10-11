import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Users, ShieldCheck, History, KeyRound, AlertTriangle, ShieldAlert, ChevronRight, Database, DatabaseBackup, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/ui';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { ROLE_LABEL } from '../../lib/roleLabels';
import type { AuditLog, SystemBackup, UserProfile, UserRole } from '../../types/database.types';

const ADMIN_TIER_ROLES: UserRole[] = [
  'municipal_admin', 'provincial_admin', 'super_admin', 'barangay_admin',
  'shelter_admin', 'shelter_staff', 'support_expert', 'law_enforcement', 'provincial_staff',
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function describeAuditAction(log: AuditLog): string {
  const MAP: Record<string, string> = {
    PROFILE_UPDATE: 'Profile updated',
    PASSWORD_CHANGE: 'Password changed',
    SESSION_REVOKE_OTHERS: 'Other sessions signed out',
    SESSION_TIMEOUT_UPDATE: 'Session timeout setting changed',
  };
  if (MAP[log.action]) return MAP[log.action];
  if (log.action === 'INSERT' && log.table_name === 'user_profiles') return 'Administrator account created';
  if (log.action === 'UPDATE' && log.table_name === 'user_profiles') return 'Administrator account updated';
  return `${log.action.replace(/_/g, ' ').toLowerCase()} · ${log.table_name}`;
}

function TechKpiCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
  loading,
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
  to?: string;
}) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <div
      className={`dash-kpi-card${clickable ? ' dash-kpi-card--clickable' : ''}`}
      style={{ ['--kpi-tint' as string]: tint, ['--kpi-accent' as string]: color }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `View ${label} — ${context}` : undefined}
      onClick={clickable ? () => navigate(to!) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(to!);
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

// Every status shown here must correspond to a real check made this
// render — `ok={null}`/`neutral` means "no honest signal available",
// rendered as a neutral "Not monitored" state rather than a fabricated
// green checkmark (task's own explicit requirement: "Not monitored" is
// more professional than fake health data).
function HealthItem({
  icon: Icon,
  label,
  ok,
  okText,
  badText,
  neutral,
}: {
  icon: React.ElementType;
  label: string;
  ok: boolean | null;
  okText?: string;
  badText: string;
  neutral?: boolean;
}) {
  const color = neutral ? 'var(--color-text-muted)' : ok ? 'var(--color-success)' : 'var(--color-danger)';
  const StatusIcon = neutral ? Icon : ok ? CheckCircle2 : XCircle;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ color, marginTop: 1 }}>
        <StatusIcon size={16} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon size={12} /> {label}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color }}>{ok || neutral ? okText ?? badText : badText}</div>
      </div>
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

export function TechnicalAdminDashboard() {
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [pendingVerifications, setPendingVerifications] = useState(0);
  const [municipalityCount, setMunicipalityCount] = useState(0);
  const [barangayCount, setBarangayCount] = useState(0);
  const [shelterCount, setShelterCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState<AuditLog[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // System Health — every value here is real, sourced from an actual
  // check made this render, never a decorative percentage. authHealthy
  // starts true and only flips if the session check below genuinely
  // fails; lastBackup/scheduleEnabled are read directly from
  // system_backups/backup_schedule (module16) — "Not monitored" is used
  // in the render below for anything with no honest signal available
  // (Storage, Edge Functions), rather than a fabricated status.
  const [authHealthy, setAuthHealthy] = useState(true);
  const [lastBackup, setLastBackup] = useState<SystemBackup | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean | null>(null);

  const fetchAll = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(false);

    const [adminsRes, pendingRes, muniRes, brgyRes, shelterRes, activityRes, sessionRes, backupRes, scheduleRes] = await Promise.all([
      supabase.from('user_profiles').select('*').in('role', ADMIN_TIER_ROLES),
      supabase.from('user_verifications').select('verification_id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('municipalities').select('municipality_id', { count: 'exact', head: true }),
      supabase.from('barangays').select('barangay_id', { count: 'exact', head: true }),
      supabase.from('shelters').select('shelter_id', { count: 'exact', head: true }),
      // Province-wide (not self-filtered, unlike Settings' "Administrator
      // Activity" tab) — real access only exists because of the new
      // audit_logs SELECT policy added in module11, scoped to this role.
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(8),
      supabase.auth.getSession(),
      supabase.from('system_backups').select('*').eq('status', 'completed').order('completed_at', { ascending: false }).limit(1),
      supabase.from('backup_schedule').select('enabled').eq('schedule_id', '00000000-0000-0000-0000-000000000001').single(),
    ]);

    if (adminsRes.error || pendingRes.error || muniRes.error || brgyRes.error || shelterRes.error || activityRes.error) {
      console.error('[TechnicalAdminDashboard] fetchAll:', {
        admins: adminsRes.error,
        pending: pendingRes.error,
        muni: muniRes.error,
        brgy: brgyRes.error,
        shelter: shelterRes.error,
        activity: activityRes.error,
      });
      setError(true);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setAdmins(adminsRes.data ?? []);
    setPendingVerifications(pendingRes.count ?? 0);
    setMunicipalityCount(muniRes.count ?? 0);
    setBarangayCount(brgyRes.count ?? 0);
    setShelterCount(shelterRes.count ?? 0);
    setRecentActivity(activityRes.data ?? []);
    setAuthHealthy(!sessionRes.error && !!sessionRes.data.session);
    setLastBackup(backupRes.data?.[0] ?? null);
    setScheduleEnabled(scheduleRes.data?.enabled ?? null);

    const actorIds = Array.from(new Set((activityRes.data ?? []).map((l) => l.profile_id).filter(Boolean)));
    if (actorIds.length > 0) {
      const { data: actors } = await supabase.from('user_profiles').select('profile_id, first_name, last_name').in('profile_id', actorIds);
      const names: Record<string, string> = {};
      (actors ?? []).forEach((a) => {
        names[a.profile_id] = `${a.first_name} ${a.last_name}`;
      });
      setActorNames(names);
    } else {
      setActorNames({});
    }

    setLoading(false);
    setRefreshing(false);
    setLastUpdated(Date.now());
  }, []);

  useEffect(() => {
    fetchAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAutoRefresh(() => fetchAll(true));

  const totalAdmins = admins.length;
  const activeAdmins = admins.filter((a) => a.is_active).length;
  const technicalAdmins = admins.filter((a) => a.role === 'provincial_admin' || a.role === 'super_admin').length;
  const operationalStaff = totalAdmins - technicalAdmins;

  if (error) {
    return (
      <div>
        <PageHeader title="System Overview" subtitle="Technical &amp; system administration" />
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
        title="System Overview"
        subtitle="Technical &amp; system administration — Aurora Province"
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => fetchAll(true)} />}
      />

      <div className="dash-kpi-grid">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <TechKpiCard
              icon={Users}
              label="Administrator Accounts"
              value={totalAdmins}
              context={`${activeAdmins} active · ${totalAdmins - activeAdmins} inactive`}
              color="var(--color-primary)"
              tint="var(--kpi-tint-primary)"
              iconBg="var(--kpi-icon-primary)"
              loading={loading}
              to="/admin/users"
            />
            <TechKpiCard
              icon={ShieldCheck}
              label="Technical Admins"
              value={technicalAdmins}
              context={`${operationalStaff} operational staff accounts`}
              color="var(--color-info)"
              tint="var(--kpi-tint-info)"
              iconBg="var(--kpi-icon-info)"
              loading={loading}
              to="/admin/users"
            />
            <TechKpiCard
              icon={AlertTriangle}
              label="Pending Verifications"
              value={pendingVerifications}
              context="Awaiting identity review (Provincial Staff queue)"
              color="var(--color-warning)"
              tint="var(--kpi-tint-warning)"
              iconBg="var(--kpi-icon-warning)"
              loading={loading}
            />
            <TechKpiCard
              icon={History}
              label="Audit Records"
              value={recentActivity.length}
              context="Most recent administrator actions"
              color="var(--color-success)"
              tint="var(--kpi-tint-success)"
              iconBg="var(--kpi-icon-success)"
              loading={loading}
              to="/admin/audit-log"
            />
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 12 }}>System Health</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <HealthItem
            icon={Database}
            label="Database"
            ok={!error}
            okText="Connected"
            badText="Issue"
          />
          <HealthItem icon={ShieldCheck} label="Authentication" ok={authHealthy} okText="Session active" badText="Issue" />
          <HealthItem
            icon={DatabaseBackup}
            label="Backup"
            ok={!!lastBackup}
            okText={lastBackup ? `Last: ${new Date(lastBackup.completed_at ?? lastBackup.started_at).toLocaleDateString()}` : undefined}
            badText="No backups yet"
            neutral={!lastBackup}
          />
          <HealthItem
            icon={Clock}
            label="Scheduled Jobs"
            ok={scheduleEnabled === true}
            okText="Enabled"
            badText={scheduleEnabled === false ? 'Disabled' : 'Unknown'}
            neutral={scheduleEnabled === null}
          />
          <HealthItem icon={History} label="Storage / Edge Functions" ok={null} okText="Not monitored" badText="Not monitored" neutral />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 24 }} className="dash-widget-grid">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 15.5 }}>Recent Administrator Activity</h3>
          </div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-text" style={{ height: 40 }} />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No administrator activity recorded yet.</p>
          ) : (
            <>
              {recentActivity.map((log) => (
                <div key={log.log_id} className="activity-row">
                  <span className="activity-row-icon" style={{ background: 'var(--color-primary-tint)', color: 'var(--color-primary)' }}>
                    <History size={14} />
                  </span>
                  <div className="activity-row-main">
                    <div className="activity-row-title">{describeAuditAction(log)}</div>
                    <div className="activity-row-sub">
                      {actorNames[log.profile_id] ?? 'System'} · {formatDateTime(log.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              <Link to="/admin/audit-log" className="dash-view-all">
                View full audit log <ChevronRight size={13} />
              </Link>
            </>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>Quick Links</h3>
          <Link to="/admin/users" className="dash-widget-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="dash-widget-row-main">
              <span className="dash-widget-row-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> Administrator Management
              </span>
              <span className="dash-widget-row-sub">Create, edit, and manage administrator accounts</span>
            </div>
            <ChevronRight size={14} />
          </Link>
          <Link to="/admin/audit-log" className="dash-widget-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="dash-widget-row-main">
              <span className="dash-widget-row-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={14} /> Audit Log
              </span>
              <span className="dash-widget-row-sub">Province-wide administrator action history</span>
            </div>
            <ChevronRight size={14} />
          </Link>
          <Link to="/admin/roles-permissions" className="dash-widget-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="dash-widget-row-main">
              <span className="dash-widget-row-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={14} /> Roles &amp; Permissions
              </span>
              <span className="dash-widget-row-sub">View the current permission model</span>
            </div>
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15.5, marginBottom: 12 }}>Province Coverage</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <span className="label" style={{ marginBottom: 2 }}>Municipalities</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{loading ? '—' : municipalityCount}</div>
          </div>
          <div>
            <span className="label" style={{ marginBottom: 2 }}>Barangays</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{loading ? '—' : barangayCount}</div>
          </div>
          <div>
            <span className="label" style={{ marginBottom: 2 }}>Shelters</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{loading ? '—' : shelterCount}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 16 }}>
          <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          Day-to-day case, SOS, and shelter operations are handled by Provincial Staff and municipal/barangay
          administrators. This dashboard covers system administration only — account management, audit history, and
          the permission model.
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  ShieldCheck,
  Palette,
  Bell,
  Lock,
  Monitor,
  History,
  KeyRound,
  SlidersHorizontal,
  AlertTriangle,
  Eye,
  EyeOff,
  Check,
  X,
  RefreshCw,
  LogOut,
  Laptop,
  Clock,
  ChevronRight,
  Sun,
  Moon,
  MonitorSmartphone,
  Loader2,
  ShieldAlert,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme, type ThemePreference } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { readSessionTimeoutMinutes, SESSION_TIMEOUT_STORAGE_KEY, DEFAULT_SESSION_TIMEOUT_MINUTES } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { currentDeviceLabel } from '../../lib/deviceInfo';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { permissionsFor, PERMISSION_LABEL, hasPermission } from '../../lib/permissions';
import { PageHeader } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PasswordStrengthMeter, allRequirementsMet } from '../../components/PasswordStrengthMeter';
import type { AuditLog } from '../../types/database.types';

// ---------------------------------------------------------------------
// Section registry
// ---------------------------------------------------------------------
const SECTIONS = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'security', label: 'Account Security', icon: ShieldCheck },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'privacy', label: 'Privacy & Data', icon: Lock },
  { key: 'sessions', label: 'Sessions & Devices', icon: Monitor },
  { key: 'activity', label: 'Administrator Activity', icon: History },
  { key: 'access', label: 'Access & Permissions', icon: KeyRound },
  { key: 'system', label: 'System Preferences', icon: SlidersHorizontal },
  { key: 'actions', label: 'Account Actions', icon: AlertTriangle },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const NOTIF_PREFS_KEY = 'safeher_admin_notif_prefs';
const DENSITY_KEY = 'safeher_admin_density_compact';

interface NotifPrefs {
  caseReports: boolean;
  sosAlerts: boolean;
  caseUpdates: boolean;
  referralUpdates: boolean;
  systemNotifications: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  caseReports: true,
  sosAlerts: true,
  caseUpdates: true,
  referralUpdates: true,
  systemNotifications: true,
};

function readNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) return { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_NOTIF_PREFS;
}

function readDensityCompact(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) === '1';
  } catch {
    return false;
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Not available';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------
function ToggleSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="settings-section-header">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
export function SettingsPage() {
  const { profile, municipality, barangay, roleTier, session, signOut, updatePassword, refreshProfile } = useAuth();
  const { preference, resolvedTheme, setPreference } = useTheme();
  const { showToast } = useToast();
  const navigate = () => {};
  void navigate;

  const [activeSection, setActiveSection] = useState<SectionKey>('profile');
  const security2faRef = useRef<HTMLDivElement>(null);

  const isProvincial = roleTier === 'province';
  // Reads the real, role-keyed label/permission model (RBAC split,
  // module11) rather than a roleTier-based ternary — this is what
  // actually distinguishes provincial_admin (technical) from
  // provincial_staff (operational) despite both sharing roleTier ===
  // 'province', and what correctly covers shelter_admin/shelter_staff/
  // support_expert/law_enforcement (all roleTier === null, which used to
  // silently fall through to the municipal-tier label/list here).
  const roleLabel = profile ? ROLE_LABEL[profile.role] : '';
  const jurisdictionLabel =
    roleTier === 'province'
      ? 'Aurora Province'
      : roleTier === 'barangay'
        ? `Barangay ${barangay?.barangay_name ?? '—'}, ${municipality?.municipality_name ?? '—'}`
        : roleTier === 'municipality'
          ? (municipality?.municipality_name ?? '—')
          : 'Not geography-scoped';
  const rolePermissions = profile ? permissionsFor(profile.role).map((k) => PERMISSION_LABEL[k]) : [];

  // ---- Profile ----
  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const profileDirty = firstName !== (profile?.first_name ?? '') || lastName !== (profile?.last_name ?? '') || phoneNumber !== (profile?.phone_number ?? '');

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    const oldValues = { first_name: profile.first_name, last_name: profile.last_name, phone_number: profile.phone_number };
    const { error } = await supabase
      .from('user_profiles')
      .update({ first_name: firstName, last_name: lastName, phone_number: phoneNumber })
      .eq('profile_id', profile.profile_id);
    if (!error) {
      await logAudit({
        profileId: profile.profile_id,
        action: 'PROFILE_UPDATE',
        tableName: 'user_profiles',
        recordId: profile.profile_id,
        oldValues,
        newValues: { first_name: firstName, last_name: lastName, phone_number: phoneNumber },
      });
      await refreshProfile();
      showToast('success', 'Profile updated successfully.');
    } else {
      showToast('error', 'Unable to save changes. Please try again.');
    }
    setSavingProfile(false);
  };

  // ---- Account Security: change password ----
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmingPwChange, setConfirmingPwChange] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const newPasswordValid = allRequirementsMet(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmitPasswordChange = currentPassword.length > 0 && newPasswordValid && passwordsMatch;

  const requestPasswordChange = () => {
    setPwError(null);
    if (!canSubmitPasswordChange) return;
    setConfirmingPwChange(true);
  };

  const confirmPasswordChange = async () => {
    if (!session?.user.email) return;
    setChangingPassword(true);
    setPwError(null);

    // Supabase's updateUser() doesn't itself verify the *current*
    // password — it just applies a new one to the active session. To
    // genuinely require the current password (not just ask for it
    // decoratively), re-authenticate with it first via a real sign-in
    // call before applying the change.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setChangingPassword(false);
      setConfirmingPwChange(false);
      setPwError('Current password is incorrect.');
      return;
    }

    const { error } = await updatePassword(newPassword);
    if (error) {
      setChangingPassword(false);
      setConfirmingPwChange(false);
      setPwError(error);
      return;
    }

    // Consider other sessions untrusted the moment a password changes.
    await supabase.auth.signOut({ scope: 'others' });
    if (profile) {
      await logAudit({ profileId: profile.profile_id, action: 'PASSWORD_CHANGE', tableName: 'auth', recordId: profile.profile_id });
    }

    setChangingPassword(false);
    setConfirmingPwChange(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    showToast('success', 'Password updated successfully.');
  };

  // ---- Login security (real, client-observable data only) ----
  const failedAttemptsThisSession = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('safeher_admin_login_attempts');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { count?: number };
      return parsed.count ?? 0;
    } catch {
      return 0;
    }
  }, []);

  // ---- Appearance ----
  const THEME_OPTIONS: { key: ThemePreference; label: string; icon: React.ElementType }[] = [
    { key: 'light', label: 'Light', icon: Sun },
    { key: 'dark', label: 'Dark', icon: Moon },
    { key: 'system', label: 'System', icon: MonitorSmartphone },
  ];

  // ---- Notifications ----
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(readNotifPrefs);
  const [confirmingDisable, setConfirmingDisable] = useState<{ key: keyof NotifPrefs; label: string } | null>(null);

  const persistNotifPrefs = (next: NotifPrefs) => {
    setNotifPrefs(next);
    try {
      localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(next));
    } catch {
      // best-effort only
    }
  };

  const toggleNotifPref = (key: keyof NotifPrefs, label: string, turningOff: boolean, critical: boolean) => {
    if (turningOff && critical) {
      setConfirmingDisable({ key, label });
      return;
    }
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    persistNotifPrefs(next);
  };

  const confirmDisableNotif = () => {
    if (!confirmingDisable) return;
    const next = { ...notifPrefs, [confirmingDisable.key]: false };
    persistNotifPrefs(next);
    setConfirmingDisable(null);
    showToast('info', `${confirmingDisable.label} notifications turned off.`);
  };

  // ---- Sessions & devices ----
  const [confirmingSignOutOthers, setConfirmingSignOutOthers] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState(readSessionTimeoutMinutes);
  const [confirmingTimeout, setConfirmingTimeout] = useState(false);
  const timeoutDirty = timeoutMinutes !== readSessionTimeoutMinutes();

  const confirmSignOutOthers = async () => {
    setSigningOutOthers(true);
    await supabase.auth.signOut({ scope: 'others' });
    if (profile) {
      await logAudit({ profileId: profile.profile_id, action: 'SESSION_REVOKE_OTHERS', tableName: 'auth', recordId: profile.profile_id });
    }
    setSigningOutOthers(false);
    setConfirmingSignOutOthers(false);
    showToast('success', 'All other sessions have been signed out.');
  };

  const applyTimeout = () => {
    try {
      localStorage.setItem(SESSION_TIMEOUT_STORAGE_KEY, String(timeoutMinutes));
    } catch {
      // best-effort
    }
    window.dispatchEvent(new Event('safeher:session-timeout-changed'));
    if (profile) {
      logAudit({ profileId: profile.profile_id, action: 'SESSION_TIMEOUT_UPDATE', tableName: 'auth', recordId: profile.profile_id, newValues: { minutes: timeoutMinutes } });
    }
    setConfirmingTimeout(false);
    showToast('success', 'Session timeout updated.');
  };

  // ---- Administrator activity ----
  const [activityLogs, setActivityLogs] = useState<AuditLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);
  const [activityLimit, setActivityLimit] = useState(10);
  const [activityFilter, setActivityFilter] = useState<'all' | 'security' | 'account' | 'cases' | 'system'>('all');

  const [activityLastUpdated, setActivityLastUpdated] = useState<number | null>(null);

  const loadActivity = async (limit: number) => {
    if (!profile) return;
    setActivityLoading(true);
    setActivityError(false);
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('profile_id', profile.profile_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      setActivityError(true);
    } else {
      setActivityLogs(data ?? []);
      setActivityLastUpdated(Date.now());
    }
    setActivityLoading(false);
  };

  useEffect(() => {
    if (activeSection === 'activity') loadActivity(activityLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const SECURITY_ACTIONS = new Set(['PASSWORD_CHANGE', 'SESSION_REVOKE_OTHERS', 'SESSION_TIMEOUT_UPDATE']);
  const categorize = (log: AuditLog): 'security' | 'account' | 'cases' | 'system' => {
    if (SECURITY_ACTIONS.has(log.action)) return 'security';
    if (log.table_name === 'user_profiles') return 'account';
    if (['case_reports', 'case_assignments', 'case_status_history', 'shelter_referrals'].includes(log.table_name)) return 'cases';
    return 'system';
  };
  const describeAction = (log: AuditLog): string => {
    const MAP: Record<string, string> = {
      PROFILE_UPDATE: 'Profile updated',
      PASSWORD_CHANGE: 'Password changed',
      SESSION_REVOKE_OTHERS: 'Other sessions signed out',
      SESSION_TIMEOUT_UPDATE: 'Session timeout setting changed',
      NOTIFICATION_PREFS_UPDATE: 'Notification preferences updated',
    };
    return MAP[log.action] ?? `${log.action.replace(/_/g, ' ').toLowerCase()} · ${log.table_name}`;
  };
  const filteredLogs = activityFilter === 'all' ? activityLogs : activityLogs.filter((l) => categorize(l) === activityFilter);

  // ---- System preferences ----
  const [densityCompact, setDensityCompactState] = useState(readDensityCompact);
  const setDensityCompact = (v: boolean) => {
    setDensityCompactState(v);
    try {
      localStorage.setItem(DENSITY_KEY, v ? '1' : '0');
    } catch {
      // best-effort
    }
    document.documentElement.classList.toggle('density-compact', v);
  };

  // ---- Account actions / logout ----
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const confirmLogout = async () => {
    setLoggingOut(true);
    await signOut();
    setLoggingOut(false);
    window.location.href = '/admin/login';
  };

  // ---- Security status computation ----
  const emailVerified = !!session?.user.email_confirmed_at;
  const securityChecks = [
    { key: 'email', label: 'Email verified', ok: emailVerified },
    { key: 'session', label: 'Session protection enabled', ok: true },
    { key: 'role', label: 'Role-based access enabled', ok: true },
    { key: '2fa', label: 'Two-factor authentication not enabled', ok: false },
  ];
  const securityGood = securityChecks.every((c) => c.ok);

  const jumpToImproveSecurity = () => {
    setActiveSection('security');
    requestAnimationFrame(() => security2faRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  // Refresh here is deliberately scoped to the Activity section's own
  // data only — Profile/Security/etc. hold in-progress, unsaved form
  // state (firstName/newPassword/...), and a global refetch there would
  // silently discard whatever the admin is mid-typing. Outside Activity,
  // the button is a safe no-op rather than a decorative one: there is
  // no live data on those sections to misrepresent as refreshed.
  const [settingsRefreshing, setSettingsRefreshing] = useState(false);
  const onSettingsRefresh = async () => {
    if (activeSection !== 'activity') return;
    setSettingsRefreshing(true);
    await loadActivity(activityLimit);
    setSettingsRefreshing(false);
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Administration · Security · Privacy · Control"
        actions={
          <DashboardHeaderActions
            showSearch={hasPermission(profile?.role, 'cases.view')}
            lastUpdated={activeSection === 'activity' ? activityLastUpdated : null}
            refreshing={settingsRefreshing}
            onRefresh={onSettingsRefresh}
          />
        }
      />

      {/* ---- Security Status (always visible, top of page) ---- */}
      <div className="security-status-card">
        <div className="security-status-head">
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 2 }}>Security Status</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Your administrator account is protected.</p>
          </div>
          <span className={`security-status-badge ${securityGood ? 'good' : 'attention'}`}>
            {securityGood ? <Check size={13} /> : <ShieldAlert size={13} />}
            {securityGood ? 'Good' : 'Needs Attention'}
          </span>
        </div>
        <div className="security-check-list">
          {securityChecks.map((c) => (
            <div key={c.key} className={`security-check-row ${c.ok ? 'ok' : 'warn'}`}>
              <span className="check-icon">{c.ok ? <Check size={13} /> : <AlertTriangle size={12} />}</span>
              {c.label}
            </div>
          ))}
        </div>
        {!securityGood && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: var_space(4) }} onClick={jumpToImproveSecurity}>
            Improve Security <ChevronRight size={14} />
          </button>
        )}
      </div>

      <div className="settings-layout">
        {/* Desktop nav */}
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`sidebar-nav-item${activeSection === s.key ? ' active' : ''}`}
              onClick={() => setActiveSection(s.key)}
            >
              <s.icon size={16} strokeWidth={1.75} />
              {s.label}
            </button>
          ))}
        </nav>

        <div>
          {/* Mobile nav */}
          <div className="settings-mobile-nav">
            {SECTIONS.map((s) => (
              <button key={s.key} type="button" className={activeSection === s.key ? 'active' : ''} onClick={() => setActiveSection(s.key)}>
                <s.icon size={14} />
                {s.label}
              </button>
            ))}
          </div>

          {/* ================= PROFILE ================= */}
          {activeSection === 'profile' && (
            <div className="settings-section">
              <SectionHeader title="Profile" description="Your administrator identity across the SafeSpace portal." />
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                  <span
                    style={{
                      width: 56, height: 56, borderRadius: '50%', background: 'var(--color-primary-light)',
                      color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20, fontWeight: 700, flexShrink: 0,
                    }}
                  >
                    {profile?.first_name?.[0]?.toUpperCase()}
                    {profile?.last_name?.[0]?.toUpperCase()}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {roleLabel}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {jurisdictionLabel}
                    </div>
                    <span className={`badge`} style={{ marginTop: 4, color: profile?.is_active ? 'var(--color-success)' : 'var(--color-text-muted)', borderColor: 'transparent', background: profile?.is_active ? 'var(--color-success-tint)' : 'var(--color-surface-muted)' }}>
                      {profile?.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="field">
                    <label className="label">First name</label>
                    <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  </div>
                  <div className="field">
                    <label className="label">Last name</label>
                    <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  </div>
                </div>
                <div className="field">
                  <label className="label">Email</label>
                  <input className="input" value={session?.user.email ?? ''} readOnly disabled autoComplete="email" />
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                    Contact a system administrator to change the email address on this account.
                  </p>
                </div>
                <div className="field">
                  <label className="label">Phone number</label>
                  <input className="input" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} autoComplete="tel" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, fontSize: 13 }}>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Role</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{roleLabel}</div>
                  </div>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Last profile update</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{profile ? formatDateTime(profile.updated_at) : '—'}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="btn btn-primary" onClick={saveProfile} disabled={!profileDirty || savingProfile}>
                    {savingProfile && <Loader2 size={15} className="icon-spin" />}
                    {savingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                  {profileDirty && !savingProfile && <span className="unsaved-badge">Unsaved changes</span>}
                </div>
              </div>
            </div>
          )}

          {/* ================= ACCOUNT SECURITY ================= */}
          {activeSection === 'security' && (
            <div className="settings-section">
              <SectionHeader title="Account Security" description="Password, two-factor authentication, and login security." />

              <div className="card" style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 14.5, marginBottom: 4 }}>Change Password</h4>
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                  Choose a strong password you don't use anywhere else.
                </p>

                <div className="field">
                  <label className="label" htmlFor="current-pw">Current password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="current-pw"
                      className="input"
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => { setCurrentPassword(e.target.value); setPwError(null); }}
                      autoComplete="current-password"
                      style={{ paddingRight: 40 }}
                    />
                    <button type="button" onClick={() => setShowCurrentPw((v) => !v)} aria-label={showCurrentPw ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', display: 'flex' }}>
                      {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label className="label" htmlFor="new-pw">New password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="new-pw"
                      className="input"
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      style={{ paddingRight: 40 }}
                    />
                    <button type="button" onClick={() => setShowNewPw((v) => !v)} aria-label={showNewPw ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', display: 'flex' }}>
                      {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <div className="field">
                  <label className="label" htmlFor="confirm-pw">Confirm new password</label>
                  <input
                    id="confirm-pw"
                    className="input"
                    type={showNewPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <p className="error-text">Passwords do not match.</p>
                  )}
                </div>

                {pwError && <p className="error-text" role="alert">{pwError}</p>}

                <button className="btn btn-primary" onClick={requestPasswordChange} disabled={!canSubmitPasswordChange}>
                  Change Password
                </button>
              </div>

              <div className="card" style={{ marginBottom: 20 }} ref={security2faRef}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <h4 style={{ fontSize: 14.5 }}>Two-Factor Authentication</h4>
                  <span className="badge" style={{ color: 'var(--color-warning)', background: 'var(--color-warning-tint)', borderColor: 'transparent' }}>
                    Not Enabled
                  </span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                  Add an additional verification step to protect your administrator account.
                </p>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                  <Fingerprint size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-text-muted)' }} />
                  Two-factor authentication is not yet available for administrator accounts. This area is ready to be
                  connected once it's supported — check back in a future release.
                </div>
              </div>

              <div className="card">
                <h4 style={{ fontSize: 14.5, marginBottom: 12 }}>Login Security</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13 }}>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Last successful login</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(session?.user.last_sign_in_at)}</div>
                  </div>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Email verification</span>
                    <div style={{ color: emailVerified ? 'var(--color-success)' : 'var(--color-warning)' }}>{emailVerified ? 'Verified' : 'Not verified'}</div>
                  </div>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Failed attempts this session</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{failedAttemptsThisSession}</div>
                  </div>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Account lockout status</span>
                    <div style={{ color: 'var(--color-success)' }}>Not locked</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= APPEARANCE ================= */}
          {activeSection === 'appearance' && (
            <div className="settings-section">
              <SectionHeader title="Appearance" description="Choose how the SafeSpace Admin Portal looks on this device." />
              <div className="card">
                <div className="theme-option-grid">
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`theme-option-card${preference === opt.key ? ' selected' : ''}`}
                      onClick={() => setPreference(opt.key)}
                    >
                      <span className="theme-option-preview">
                        <span style={{ width: '30%', background: opt.key === 'dark' ? '#16233A' : opt.key === 'light' ? '#fff' : 'linear-gradient(90deg,#fff 50%,#16233A 50%)' }} />
                        <span style={{ flex: 1, background: opt.key === 'dark' ? '#0E1726' : opt.key === 'light' ? '#F5F7FA' : 'linear-gradient(90deg,#F5F7FA 50%,#0E1726 50%)' }} />
                      </span>
                      <span className="theme-option-label">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <opt.icon size={14} /> {opt.label}
                        </span>
                        {preference === opt.key && <Check size={14} color="var(--color-primary)" />}
                      </span>
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 14 }}>
                  Currently showing the {resolvedTheme === 'dark' ? 'dark' : 'light'} theme
                  {preference === 'system' ? ' (matching your system setting).' : '.'}
                </p>
              </div>
            </div>
          )}

          {/* ================= NOTIFICATIONS ================= */}
          {activeSection === 'notifications' && (
            <div className="settings-section">
              <SectionHeader title="Notification Preferences" description="Choose which alerts appear in your notification panel on this device." />
              <div className="card">
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">Case Reports</div>
                    <div className="settings-toggle-row-desc">New cases reported in your jurisdiction.</div>
                  </div>
                  <ToggleSwitch checked={notifPrefs.caseReports} onChange={() => toggleNotifPref('caseReports', 'Case Reports', notifPrefs.caseReports, false)} label="Case Reports" />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">SOS Alerts</div>
                    <div className="settings-toggle-row-desc">Real-time emergency alerts from survivors.</div>
                  </div>
                  <ToggleSwitch checked={notifPrefs.sosAlerts} onChange={() => toggleNotifPref('sosAlerts', 'SOS Alerts', notifPrefs.sosAlerts, true)} label="SOS Alerts" />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">Case Updates</div>
                    <div className="settings-toggle-row-desc">Status changes on cases assigned to you.</div>
                  </div>
                  <ToggleSwitch checked={notifPrefs.caseUpdates} onChange={() => toggleNotifPref('caseUpdates', 'Case Updates', notifPrefs.caseUpdates, false)} label="Case Updates" />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">Referral Updates</div>
                    <div className="settings-toggle-row-desc">Shelter referral status changes.</div>
                  </div>
                  <ToggleSwitch checked={notifPrefs.referralUpdates} onChange={() => toggleNotifPref('referralUpdates', 'Referral Updates', notifPrefs.referralUpdates, false)} label="Referral Updates" />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">System Notifications</div>
                    <div className="settings-toggle-row-desc">Announcements from SafeSpace administrators.</div>
                  </div>
                  <ToggleSwitch checked={notifPrefs.systemNotifications} onChange={() => toggleNotifPref('systemNotifications', 'System Notifications', notifPrefs.systemNotifications, false)} label="System Notifications" />
                </div>
                <div className="settings-toggle-row locked">
                  <div>
                    <div className="settings-toggle-row-label"><ShieldCheck size={13} /> Security Alerts</div>
                    <div className="settings-toggle-row-desc">Always on — protects your account and can't be disabled.</div>
                  </div>
                  <ToggleSwitch checked={true} onChange={() => {}} disabled label="Security Alerts (always on)" />
                </div>
              </div>
            </div>
          )}

          {/* ================= PRIVACY & DATA ================= */}
          {activeSection === 'privacy' && (
            <div className="settings-section">
              <SectionHeader title="Privacy & Data" description="How SafeSpace handles sensitive case and survivor information." />
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, marginBottom: 10 }}>How SafeSpace protects sensitive information</h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--color-text-muted)', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li><strong style={{ color: 'var(--color-text)' }}>Data confidentiality:</strong> Survivor and case records are only visible to administrators authorized for that case or jurisdiction.</li>
                  <li><strong style={{ color: 'var(--color-text)' }}>Case access:</strong> Access follows your assigned role — municipal administrators see their municipality's cases; provincial administrators see province-wide records.</li>
                  <li><strong style={{ color: 'var(--color-text)' }}>Session protection:</strong> Sessions automatically expire after a period of inactivity to reduce exposure on shared or unattended devices.</li>
                  <li><strong style={{ color: 'var(--color-text)' }}>Data handling:</strong> Changes to case records are attributed to the administrator who made them.</li>
                  <li><strong style={{ color: 'var(--color-text)' }}>Data retention:</strong> Case and account records are retained for as long as needed to support survivors and meet program requirements.</li>
                </ul>
              </div>
              <div className="card">
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                  This page does not display survivor case content. For the full SafeSpace privacy policy, see the public
                  privacy page linked from the SafeSpace website footer.
                </p>
              </div>
            </div>
          )}

          {/* ================= SESSIONS & DEVICES ================= */}
          {activeSection === 'sessions' && (
            <div className="settings-section">
              <SectionHeader title="Sessions & Devices" description="Where you're currently signed in." />
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="session-card">
                  <span className="session-icon"><Laptop size={17} /></span>
                  <div className="session-meta">
                    <div className="session-meta-title">
                      Current Session
                      <span className="session-current-badge">Active now</span>
                    </div>
                    <div className="session-meta-sub">{currentDeviceLabel()} · Signed in {formatDateTime(session?.user.last_sign_in_at)}</div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 16 }}>
                  For your privacy, individual details of other signed-in devices aren't listed here — you can sign out
                  of all of them at once.
                </p>
                <button className="btn btn-outline" onClick={() => setConfirmingSignOutOthers(true)}>
                  <LogOut size={14} /> Sign Out All Other Sessions
                </button>
              </div>

              <div className="card">
                <h4 style={{ fontSize: 14.5, marginBottom: 4 }}>Automatic Session Timeout</h4>
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 14 }}>
                  For security, your administrator session will automatically expire after the selected period of
                  inactivity.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {[15, 30, 60, 240].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="activity-filter-pill"
                      style={timeoutMinutes === m ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : undefined}
                      onClick={() => setTimeoutMinutes(m)}
                    >
                      {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                      {m === DEFAULT_SESSION_TIMEOUT_MINUTES ? ' · Recommended' : ''}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="btn btn-primary" disabled={!timeoutDirty} onClick={() => setConfirmingTimeout(true)}>
                    Save
                  </button>
                  {timeoutDirty && <span className="unsaved-badge">Unsaved changes</span>}
                </div>
              </div>
            </div>
          )}

          {/* ================= ADMINISTRATOR ACTIVITY ================= */}
          {activeSection === 'activity' && (
            <div className="settings-section">
              <SectionHeader title="Administrator Activity" description="A record of security and account actions on your administrator account." />
              <div className="card">
                <div className="activity-filter-row">
                  {(['all', 'security', 'account', 'cases', 'system'] as const).map((f) => (
                    <button key={f} type="button" className={`activity-filter-pill${activityFilter === f ? ' active' : ''}`} onClick={() => setActivityFilter(f)}>
                      {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>

                {activityLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-text" style={{ height: 40 }} />)}
                  </div>
                ) : activityError ? (
                  <div className="dash-error-state" style={{ padding: '24px 0' }}>
                    <p style={{ marginBottom: 12 }}>Unable to load this setting.</p>
                    <button className="btn btn-outline btn-sm" onClick={() => loadActivity(activityLimit)}>Try Again</button>
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '12px 0' }}>No activity recorded in this category yet.</p>
                ) : (
                  <>
                    {filteredLogs.map((log) => {
                      const cat = categorize(log);
                      return (
                        <div key={log.log_id} className="activity-row">
                          <span className="activity-row-icon" style={{ background: cat === 'security' ? 'var(--color-danger-tint)' : cat === 'account' ? 'var(--color-primary-tint)' : cat === 'cases' ? 'var(--color-info-tint)' : 'var(--color-surface-muted)', color: cat === 'security' ? 'var(--color-danger)' : cat === 'account' ? 'var(--color-primary)' : cat === 'cases' ? 'var(--color-info)' : 'var(--color-text-muted)' }}>
                            {cat === 'security' ? <ShieldAlert size={14} /> : <History size={14} />}
                          </span>
                          <div className="activity-row-main">
                            <div className="activity-row-title">{describeAction(log)}</div>
                            <div className="activity-row-sub">{formatDateTime(log.created_at)}</div>
                          </div>
                        </div>
                      );
                    })}
                    {activityLogs.length >= activityLimit && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ marginTop: 12 }}
                        onClick={() => {
                          const next = activityLimit + 10;
                          setActivityLimit(next);
                          loadActivity(next);
                        }}
                      >
                        View Full Activity Log
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ================= ACCESS & PERMISSIONS ================= */}
          {activeSection === 'access' && (
            <div className="settings-section">
              <SectionHeader title="Access & Permissions" description="Your current role and what it allows you to do." />
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, fontSize: 13 }}>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Role</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{roleLabel}</div>
                  </div>
                  <div>
                    <span className="label" style={{ marginBottom: 2 }}>Jurisdiction</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{jurisdictionLabel}</div>
                  </div>
                </div>
                <span className="label" style={{ marginBottom: 8 }}>Permissions</span>
                {rolePermissions.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                    This role's access is scoped directly to its own dashboard and work queue rather than the shared
                    module permissions listed for other roles.
                  </p>
                ) : (
                  rolePermissions.map((p) => (
                    <div key={p} className="permission-row">
                      <Check size={15} /> {p}
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                <KeyRound size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                Permissions are assigned by your role and enforced by the system for every request — not just hidden in
                this screen. Contact a Super Administrator to request a role change.
              </div>
            </div>
          )}

          {/* ================= SYSTEM PREFERENCES ================= */}
          {activeSection === 'system' && (
            <div className="settings-section">
              <SectionHeader title="System Preferences" description="Local display preferences for this device." />
              <div className="card">
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-row-label">Compact density</div>
                    <div className="settings-toggle-row-desc">Reduce padding across tables and cards to fit more on screen.</div>
                  </div>
                  <ToggleSwitch checked={densityCompact} onChange={setDensityCompact} label="Compact density" />
                </div>
              </div>
            </div>
          )}

          {/* ================= ACCOUNT ACTIONS / DANGER ZONE ================= */}
          {activeSection === 'actions' && (
            <div className="settings-section">
              <SectionHeader title="Account Actions" description="High-impact actions for your administrator account." />
              <div className="danger-zone">
                <div className="danger-zone-row">
                  <div>
                    <div className="danger-zone-row-title">Sign out</div>
                    <div className="danger-zone-row-desc">End your current session on this device.</div>
                  </div>
                  <button className="btn btn-outline" onClick={() => setConfirmingLogout(true)}>
                    <LogOut size={14} /> Log Out
                  </button>
                </div>
                <div className="danger-zone-row">
                  <div>
                    <div className="danger-zone-row-title">Disable this account</div>
                    <div className="danger-zone-row-desc">
                      Disabling or deleting an administrator account is handled by a Super Administrator to make sure a
                      jurisdiction is never left without coverage. Contact your Super Administrator to request this.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Confirmation modals ---- */}
      <ConfirmModal
        open={confirmingPwChange}
        icon={<KeyRound size={20} strokeWidth={2} />}
        title="Change your password?"
        description="You'll be signed out of all other devices for security. This device stays signed in."
        confirmLabel="Change Password"
        loadingLabel="Changing..."
        loading={changingPassword}
        onCancel={() => setConfirmingPwChange(false)}
        onConfirm={confirmPasswordChange}
      />

      <ConfirmModal
        open={!!confirmingDisable}
        icon={<AlertTriangle size={20} strokeWidth={2} />}
        title="Turn off this notification?"
        description="Disabling this notification may prevent you from receiving important alerts. Are you sure you want to continue?"
        confirmLabel="Continue"
        onCancel={() => setConfirmingDisable(null)}
        onConfirm={confirmDisableNotif}
      />

      <ConfirmModal
        open={confirmingSignOutOthers}
        icon={<LogOut size={20} strokeWidth={2} />}
        title="Sign out all other sessions?"
        description="All other administrator sessions will be terminated. You will remain signed in on this device."
        confirmLabel="Sign Out All Sessions"
        loadingLabel="Signing out..."
        loading={signingOutOthers}
        danger
        onCancel={() => setConfirmingSignOutOthers(false)}
        onConfirm={confirmSignOutOthers}
      />

      <ConfirmModal
        open={confirmingTimeout}
        icon={<Clock size={20} strokeWidth={2} />}
        title="Apply this session timeout setting?"
        description={`Your session will automatically sign out after ${timeoutMinutes} minutes of inactivity.`}
        confirmLabel="Apply"
        onCancel={() => setConfirmingTimeout(false)}
        onConfirm={applyTimeout}
      />

      <ConfirmModal
        open={confirmingLogout}
        icon={<LogOut size={20} strokeWidth={2} />}
        title="Are you sure you want to log out?"
        description="You'll need to sign in again to access the SafeSpace Administrative Portal."
        confirmLabel="Yes, Log Out"
        loadingLabel="Logging out..."
        loading={loggingOut}
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={confirmLogout}
      />
    </div>
  );
}

function var_space(n: number) {
  return n * 4;
}

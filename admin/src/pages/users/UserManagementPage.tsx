import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { ConfirmDialog, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ShieldAlert } from 'lucide-react';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { hasPermission } from '../../lib/permissions';
import { ROLE_LABEL } from '../../lib/roleLabels';
import { type AdminMetadata, formatDateTime, extractInvokeError } from '../../lib/adminUserHelpers';
import { formatFullName, SUFFIX_OPTIONS } from '../../lib/personName';
import { sanitizePhoneInput, PH_PHONE_RE } from '../../lib/validators';
import type { Barangay, Municipality, Shelter, UserProfile, UserRole } from '../../types/database.types';

// shelter_admin and support_expert are deliberately province-only (not
// municipality tier): a shelter can receive referrals across
// municipality lines (see create-admin-user/index.ts), and a
// support_expert carries no jurisdiction at all — confidential support is
// assigned per-request, not scoped to any one municipal_admin's
// territory.
//
// 'shelter_staff' is retired (role consolidation,
// module24_retire_shelter_staff_role.sql) and deliberately NOT offered
// here — shelter_admin is now the single official shelter role.
// Existing shelter_staff accounts are converted to shelter_admin by that
// migration, not by this page. Mirrors the 'super_admin' precedent
// immediately below: never offered for new accounts, but the enum value
// and every existing check for it are left in place.
//
// 'super_admin' is deliberately NOT offered here. A live audit (RBAC
// finalization pass) confirmed it is 100% functionally identical to
// 'provincial_admin' in every RLS policy, helper function, and
// authorization check in the codebase — including create-admin-user,
// where a provincial_admin/super_admin caller can create either
// interchangeably with the exact same resulting privileges. Two labels
// for one permission set is redundant, not a real jurisdiction/duty
// distinction, so new accounts are steered to the single canonical
// label. The enum value and every existing check for it are left in
// place (never removed) purely for backward compatibility — this is an
// intentionally non-destructive retirement, not a schema change.
// law_enforcement is province-tier-only to create (explicit RBAC design
// decision — Provincial Admin -> Authorized Law Enforcement Account),
// matching the shelter_admin/support_expert precedent exactly. It
// carries no municipality/barangay/shelter jurisdiction (see
// module9_law_enforcement.sql) — access is granted per-referral from
// CaseDetailPage/SosMonitoringPage, not by geography, so there is
// nothing to pick here beyond the account itself.
//
// 'provincial_staff' (RBAC split, module11) is province-tier-only to
// create, same as provincial_admin itself — it carries no municipality/
// barangay/shelter jurisdiction (province-wide operational scope).
// Roles whose grant reaches province-wide data or system administration.
// Escalating INTO one of these requires typed confirmation below.
const PROVINCE_TIER_ROLES: UserRole[] = ['provincial_staff', 'provincial_admin', 'super_admin'];

function creatableRoles(roleTier: 'province' | 'municipality' | 'barangay' | null): UserRole[] {
  if (roleTier === 'province') return ['municipal_admin', 'barangay_admin', 'shelter_admin', 'support_expert', 'law_enforcement', 'provincial_staff', 'provincial_admin'];
  if (roleTier === 'municipality') return ['municipal_admin', 'barangay_admin'];
  return [];
}

export function UserManagementPage() {
  const { profile, roleTier } = useAuth();
  const isProvincial = roleTier === 'province';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [shelterPersonnel, setShelterPersonnel] = useState<UserProfile[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    phoneNumber: '',
    role: '' as UserRole | '',
    municipalityId: '',
    barangayId: '',
    shelterId: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- Edit (RBAC split addition) ----
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Role-change confirmation state. originalRole is the role the account
  // held when the edit dialog opened; pendingRoleChange holds a change
  // awaiting explicit acknowledgement.
  const [originalRole, setOriginalRole] = useState<UserRole | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ from: UserRole; to: UserRole } | null>(null);
  const [editForm, setEditForm] = useState({
    profileId: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    phoneNumber: '',
    role: '' as UserRole | '',
    municipalityId: '',
    barangayId: '',
    shelterId: '',
  });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ---- Last sign-in / email metadata (RBAC split addition) ----
  const [metadata, setMetadata] = useState<Record<string, AdminMetadata>>({});
  const [resetState, setResetState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});

  const availableRoles = useMemo(() => creatableRoles(roleTier), [roleTier]);
  // The edit dropdown must always include the account's CURRENT role even
  // if it wouldn't normally be offered for a fresh account (e.g. an
  // existing 'super_admin' row) — otherwise editing that row would force
  // an unrelated role change just to open the form.
  const editAvailableRoles = useMemo(() => {
    if (editForm.role && !availableRoles.includes(editForm.role)) return [editForm.role, ...availableRoles];
    return availableRoles;
  }, [availableRoles, editForm.role]);

  const load = useCallback(async () => {
    // shelter_admin/shelter_staff are deliberately excluded from this flat
    // list and shown in their own "Shelter Personnel" section below,
    // grouped by shelter — mixing them into one ambiguous admin table
    // would obscure exactly the hierarchy this page is meant to make
    // obvious (which admin/staff belongs to which shelter).
    let query = supabase.from('user_profiles').select('*');
    if (isProvincial) {
      query = query.in('role', ['municipal_admin', 'barangay_admin', 'support_expert', 'law_enforcement', 'provincial_staff', 'provincial_admin', 'super_admin']);
    } else if (profile?.municipality_id) {
      query = query.eq('municipality_id', profile.municipality_id).in('role', ['municipal_admin', 'barangay_admin']);
    }
    const { data } = await query.order('first_name');
    setUsers(data ?? []);

    if (isProvincial) {
      const { data: muni } = await supabase.from('municipalities').select('*').order('municipality_name');
      setMunicipalities(muni ?? []);

      // Only fetched for the provincial tier — shelter accounts are
      // province-only, so a municipal caller never needs this list.
      const { data: shel } = await supabase.from('shelters').select('*').order('shelter_name');
      setShelters(shel ?? []);

      const { data: personnel } = await supabase.from('user_profiles').select('*').eq('role', 'shelter_admin').order('first_name');
      setShelterPersonnel(personnel ?? []);
    }

    // The barangays SELECT policy admits any admin (province or
    // municipal) to every active barangay — no municipality filter
    // needed here just to resolve names in the table below.
    const { data: brgy } = await supabase.from('barangays').select('*').order('barangay_name');
    setBarangays(brgy ?? []);
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
  }, [load]);

  // "Last sign-in" needs auth.users data no RLS policy exposes directly —
  // fetched via the admin-user-metadata Edge Function (service role,
  // re-validates jurisdiction server-side), for whichever accounts are
  // currently listed. Also supplies the target's email, which is what
  // "Reset Access" actually sends the reset link to.
  useEffect(() => {
    if (users.length === 0) {
      setMetadata({});
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke('admin-user-metadata', { body: { profileIds: users.map((u) => u.profile_id) } })
      .then(({ data }) => {
        if (!cancelled) setMetadata((data as { metadata?: Record<string, AdminMetadata> } | null)?.metadata ?? {});
      })
      .catch((e) => console.error('[UserManagementPage] admin-user-metadata:', e));
    return () => {
      cancelled = true;
    };
  }, [users]);

  // Narrower, form-scoped barangay options for the create/edit admin
  // picker — separate from the full list above (used to resolve names in
  // the table), since a provincial caller shouldn't be offered every
  // barangay in the province before they've picked a municipality.
  // Shared by both modals (only one is ever open at a time).
  const [formBarangays, setFormBarangays] = useState<Barangay[]>([]);
  useEffect(() => {
    if (!createModalOpen && !editModalOpen) return;
    const activeMunicipalityId = createModalOpen ? form.municipalityId : editForm.municipalityId;
    const municipalityId = isProvincial ? activeMunicipalityId : profile?.municipality_id;
    if (!municipalityId) {
      setFormBarangays([]);
      return;
    }
    supabase
      .from('barangays')
      .select('*')
      .eq('municipality_id', municipalityId)
      .order('barangay_name')
      .then(({ data }) => setFormBarangays(data ?? []));
  }, [isProvincial, createModalOpen, editModalOpen, form.municipalityId, editForm.municipalityId, profile?.municipality_id]);

  const toggleActive = async (u: UserProfile) => {
    await supabase.from('user_profiles').update({ is_active: !u.is_active }).eq('profile_id', u.profile_id);
    // No manual logAudit() call here — trg_audit_user_profiles (see
    // supabase/module3_barangay_hierarchy.sql) fires automatically.
    setUsers((prev) => prev.map((x) => (x.profile_id === u.profile_id ? { ...x, is_active: !x.is_active } : x)));
  };

  // Deactivating an administrator account immediately blocks their
  // sign-in — materially consequential, so it gets a confirm step.
  // Reactivating does not (it only restores access they already had).
  const [pendingDeactivate, setPendingDeactivate] = useState<UserProfile | null>(null);
  const onToggleActiveClick = (u: UserProfile) => {
    if (u.is_active) setPendingDeactivate(u);
    else toggleActive(u);
  };

  const resetAccess = async (u: UserProfile) => {
    const email = metadata[u.profile_id]?.email;
    if (!email) return;
    setResetState((s) => ({ ...s, [u.profile_id]: 'sending' }));
    // The same public, non-privileged primitive ForgotPasswordPage already
    // uses — no service-role Edge Function needed to send a reset email.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });
    setResetState((s) => ({ ...s, [u.profile_id]: error ? 'error' : 'sent' }));
    if (!error && profile) {
      await logAudit({ profileId: profile.profile_id, action: 'RESET_ACCESS_REQUESTED', tableName: 'user_profiles', recordId: u.profile_id });
    }
  };

  const municipalityName = (id: string | null) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—';
  const barangayName = (id: string | null) => barangays.find((b) => b.barangay_id === id)?.barangay_name ?? '—';

  const resetForm = () => {
    setForm({ email: '', password: '', firstName: '', middleName: '', lastName: '', suffix: '', phoneNumber: '', role: '', municipalityId: '', barangayId: '', shelterId: '' });
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!form.email || !form.password || !form.firstName || !form.lastName || !form.role) {
      setCreateError('Please fill in all required fields.');
      return;
    }
    if (form.phoneNumber.trim() && !PH_PHONE_RE.test(form.phoneNumber.trim())) {
      setCreateError('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX) or leave it blank.');
      return;
    }
    if (form.role === 'municipal_admin' && isProvincial && !form.municipalityId) {
      setCreateError('Please select a municipality.');
      return;
    }
    if (form.role === 'barangay_admin' && (isProvincial ? !form.municipalityId : true) && !form.barangayId) {
      setCreateError('Please select a barangay.');
      return;
    }
    if (form.role === 'shelter_admin' && !form.shelterId) {
      setCreateError('Please select a shelter.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    const { data, error } = await supabase.functions.invoke('create-admin-user', {
      body: {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        suffix: form.suffix.trim() || undefined,
        phoneNumber: form.phoneNumber.trim() || undefined,
        role: form.role,
        // support_expert, law_enforcement, and provincial_staff carry no
        // jurisdiction at all — sending an empty string here (rather than
        // undefined) would try to write '' into a uuid column and fail at
        // the database level.
        municipalityId:
          form.role === 'barangay_admin' ||
          form.role === 'shelter_admin' ||
          form.role === 'support_expert' ||
          form.role === 'law_enforcement' ||
          form.role === 'provincial_staff'
            ? undefined
            : isProvincial
              ? form.municipalityId
              : profile?.municipality_id,
        barangayId: form.role === 'barangay_admin' ? form.barangayId : undefined,
        shelterId: form.role === 'shelter_admin' ? form.shelterId : undefined,
      },
    });

    setCreating(false);

    const message = await extractInvokeError(data, error);
    if (message) {
      setCreateError(message);
      return;
    }

    setCreateModalOpen(false);
    resetForm();
    load();
  };

  const openEdit = (u: UserProfile) => {
    // Captured so submitEdit can tell a ROLE CHANGE apart from an
    // ordinary name/phone edit. Without it the form cannot know whether
    // this save alters what the account can reach.
    setOriginalRole(u.role);
    setEditForm({
      profileId: u.profile_id,
      firstName: u.first_name,
      middleName: u.middle_name ?? '',
      lastName: u.last_name,
      suffix: u.suffix ?? '',
      phoneNumber: u.phone_number ?? '',
      role: u.role,
      municipalityId: u.municipality_id ?? '',
      barangayId: u.barangay_id ?? '',
      shelterId: u.shelter_id ?? '',
    });
    setEditError(null);
    setEditModalOpen(true);
  };

  const submitEdit = async (roleChangeConfirmed = false) => {
    if (!editForm.firstName || !editForm.lastName || !editForm.role) {
      setEditError('Please fill in all required fields.');
      return;
    }
    if (editForm.phoneNumber.trim() && !PH_PHONE_RE.test(editForm.phoneNumber.trim())) {
      setEditError('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX) or leave it blank.');
      return;
    }
    if (editForm.role === 'municipal_admin' && isProvincial && !editForm.municipalityId) {
      setEditError('Please select a municipality.');
      return;
    }
    if (editForm.role === 'barangay_admin' && (isProvincial ? !editForm.municipalityId : true) && !editForm.barangayId) {
      setEditError('Please select a barangay.');
      return;
    }

    // A role change is an ACCESS-CONTROL change, so it is confirmed
    // separately from the rest of the form rather than riding along with
    // a name correction. Escalation into the province tier additionally
    // requires typed confirmation (see the dialog below) — those roles
    // reach province-wide data or system administration.
    if (originalRole && editForm.role !== originalRole && !roleChangeConfirmed) {
      setPendingRoleChange({ from: originalRole, to: editForm.role });
      return;
    }

    setEditing(true);
    setEditError(null);

    const { data, error } = await supabase.functions.invoke('create-admin-user', {
      body: {
        action: 'update',
        profileId: editForm.profileId,
        firstName: editForm.firstName.trim(),
        middleName: editForm.middleName.trim() || undefined,
        lastName: editForm.lastName.trim(),
        suffix: editForm.suffix.trim() || undefined,
        phoneNumber: editForm.phoneNumber.trim() || undefined,
        role: editForm.role,
        municipalityId:
          editForm.role === 'barangay_admin' ||
          editForm.role === 'shelter_admin' ||
          editForm.role === 'shelter_staff' ||
          editForm.role === 'support_expert' ||
          editForm.role === 'law_enforcement' ||
          editForm.role === 'provincial_staff'
            ? undefined
            : isProvincial
              ? editForm.municipalityId
              : profile?.municipality_id,
        barangayId: editForm.role === 'barangay_admin' ? editForm.barangayId : undefined,
        shelterId: editForm.role === 'shelter_admin' || editForm.role === 'shelter_staff' ? editForm.shelterId : undefined,
      },
    });

    setEditing(false);

    const message = await extractInvokeError(data, error);
    if (message) {
      setEditError(message);
      return;
    }

    setEditModalOpen(false);
    load();
  };

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <datalist id="suffix-options">
        {SUFFIX_OPTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <PageHeader
        title={isProvincial ? 'Administrator Management' : 'User Management'}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {availableRoles.length > 0 && (
              <button className="btn btn-primary" onClick={() => setCreateModalOpen(true)}>
                Add administrator
              </button>
            )}
            <DashboardHeaderActions showSearch={hasPermission(profile?.role, 'cases.view')} lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : users.length === 0 ? (
          <EmptyState title="No accounts found" />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  {isProvincial && <th>Municipality</th>}
                  <th>Barangay</th>
                  <th>Phone</th>
                  <th>Last Sign-in</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.profile_id}>
                    <td>{formatFullName(u)}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    {isProvincial && <td>{municipalityName(u.municipality_id)}</td>}
                    <td>{u.barangay_id ? barangayName(u.barangay_id) : '—'}</td>
                    <td>{u.phone_number ?? '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{formatDateTime(metadata[u.profile_id]?.last_sign_in_at ?? null)}</td>
                    <td>
                      <StatusBadge label={u.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="table-actions-cell">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)} disabled={u.profile_id === profile?.profile_id}>
                          Edit
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => resetAccess(u)}
                          disabled={!metadata[u.profile_id]?.email || resetState[u.profile_id] === 'sending'}
                        >
                          {resetState[u.profile_id] === 'sending' ? 'Sending...' : resetState[u.profile_id] === 'sent' ? 'Sent' : 'Reset Access'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => onToggleActiveClick(u)} disabled={u.profile_id === profile?.profile_id}>
                          {u.is_active ? 'Deactivate' : 'Activate'}
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

      {/* Shelter hierarchy — deliberately separate from the flat table
          above, and grouped by shelter so the org chart is obvious at a
          glance. Used to be split into "Shelter Administrators"/"Shelter
          Staff" cards; shelter_staff is retired (role consolidation,
          module24_retire_shelter_staff_role.sql) and shelter_admin is now
          the single official shelter role, so there is only one list. */}
      {isProvincial && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Shelter Administrators</h3>
          {shelters.length === 0 ? (
            <EmptyState title="No shelters yet" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {shelters.map((s) => {
                const admins = shelterPersonnel.filter((p) => p.shelter_id === s.shelter_id);
                return (
                  <div key={s.shelter_id}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{s.shelter_name}</div>
                    {admins.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No administrator assigned</p>
                    ) : (
                      admins.map((a) => (
                        <div key={a.profile_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                          <span>{formatFullName(a)}</span>
                          <StatusBadge label={a.is_active ? 'Active' : 'Inactive'} />
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {createModalOpen && (
        <Modal
          title="Add an administrator"
          onClose={() => {
            setCreateModalOpen(false);
            resetForm();
          }}
          footer={
            <>
              <button
                className="btn btn-outline"
                onClick={() => {
                  setCreateModalOpen(false);
                  resetForm();
                }}
                disabled={creating}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create account'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Role</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole, municipalityId: '', barangayId: '', shelterId: '' }))}
            >
              <option value="">Select a role</option>
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          {(isProvincial && (form.role === 'municipal_admin' || form.role === 'barangay_admin')) || form.role === 'barangay_admin' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {isProvincial && (form.role === 'municipal_admin' || form.role === 'barangay_admin') && (
                <div className="field">
                  <label className="label">Municipality</label>
                  <select className="input" value={form.municipalityId} onChange={(e) => setForm((f) => ({ ...f, municipalityId: e.target.value, barangayId: '' }))}>
                    <option value="">Select municipality</option>
                    {municipalities.map((m) => (
                      <option key={m.municipality_id} value={m.municipality_id}>
                        {m.municipality_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {form.role === 'barangay_admin' && (
                <div className="field">
                  <label className="label">Barangay</label>
                  <select
                    className="input"
                    value={form.barangayId}
                    onChange={(e) => setForm((f) => ({ ...f, barangayId: e.target.value }))}
                    disabled={isProvincial && !form.municipalityId}
                  >
                    <option value="">Select barangay</option>
                    {formBarangays.map((b) => (
                      <option key={b.barangay_id} value={b.barangay_id}>
                        {b.barangay_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : null}

          {form.role === 'shelter_admin' && (
            <div className="field">
              <label className="label">Shelter</label>
              <select className="input" value={form.shelterId} onChange={(e) => setForm((f) => ({ ...f, shelterId: e.target.value }))}>
                <option value="">Select shelter</option>
                {shelters.map((s) => (
                  <option key={s.shelter_id} value={s.shelter_id}>
                    {s.shelter_name} ({municipalityName(s.municipality_id)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">First name</label>
              <input className="input" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Middle name</label>
              <input className="input" value={form.middleName} onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Last name</label>
              <input className="input" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Suffix (optional)</label>
              <input
                className="input"
                list="suffix-options"
                placeholder="e.g. Jr., Sr., III"
                value={form.suffix}
                onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Phone number</label>
              <input
                className="input"
                type="tel"
                inputMode="tel"
                value={form.phoneNumber}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumber: sanitizePhoneInput(e.target.value) }))}
              />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label className="label">Temporary password</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </div>

          {createError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{createError}</p>}
        </Modal>
      )}

      {editModalOpen && (
        <Modal
          title="Edit administrator"
          onClose={() => setEditModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEditModalOpen(false)} disabled={editing}>
                Cancel
              </button>
              {/* Wrapped, NOT passed directly: onClick would hand the
                  MouseEvent to the roleChangeConfirmed parameter, and a
                  MouseEvent is truthy — which would skip the role-change
                  confirmation on every save. */}
              <button className="btn btn-primary" onClick={() => void submitEdit()} disabled={editing}>
                {editing ? 'Saving...' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Role</label>
            <select
              className="input"
              value={editForm.role}
              onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole, municipalityId: '', barangayId: '', shelterId: '' }))}
            >
              {editAvailableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          {(isProvincial && (editForm.role === 'municipal_admin' || editForm.role === 'barangay_admin')) || editForm.role === 'barangay_admin' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {isProvincial && (editForm.role === 'municipal_admin' || editForm.role === 'barangay_admin') && (
                <div className="field">
                  <label className="label">Municipality</label>
                  <select className="input" value={editForm.municipalityId} onChange={(e) => setEditForm((f) => ({ ...f, municipalityId: e.target.value, barangayId: '' }))}>
                    <option value="">Select municipality</option>
                    {municipalities.map((m) => (
                      <option key={m.municipality_id} value={m.municipality_id}>
                        {m.municipality_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {editForm.role === 'barangay_admin' && (
                <div className="field">
                  <label className="label">Barangay</label>
                  <select
                    className="input"
                    value={editForm.barangayId}
                    onChange={(e) => setEditForm((f) => ({ ...f, barangayId: e.target.value }))}
                    disabled={isProvincial && !editForm.municipalityId}
                  >
                    <option value="">Select barangay</option>
                    {formBarangays.map((b) => (
                      <option key={b.barangay_id} value={b.barangay_id}>
                        {b.barangay_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : null}

          {(editForm.role === 'shelter_admin' || editForm.role === 'shelter_staff') && (
            <div className="field">
              <label className="label">Shelter</label>
              <select className="input" value={editForm.shelterId} onChange={(e) => setEditForm((f) => ({ ...f, shelterId: e.target.value }))}>
                <option value="">Select shelter</option>
                {shelters.map((s) => (
                  <option key={s.shelter_id} value={s.shelter_id}>
                    {s.shelter_name} ({municipalityName(s.municipality_id)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">First name</label>
              <input className="input" value={editForm.firstName} onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Middle name</label>
              <input className="input" value={editForm.middleName} onChange={(e) => setEditForm((f) => ({ ...f, middleName: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Last name</label>
              <input className="input" value={editForm.lastName} onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Suffix (optional)</label>
              <input
                className="input"
                list="suffix-options"
                placeholder="e.g. Jr., Sr., III"
                value={editForm.suffix}
                onChange={(e) => setEditForm((f) => ({ ...f, suffix: e.target.value }))}
              />
            </div>
          </div>
          <div className="field">
            <label className="label">Phone number</label>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={editForm.phoneNumber}
              onChange={(e) => setEditForm((f) => ({ ...f, phoneNumber: sanitizePhoneInput(e.target.value) }))}
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Email cannot be changed here. Use Reset Access on the table row to let this administrator set a new password.
          </p>

          {editError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{editError}</p>}
        </Modal>
      )}

      {/* Role change — an access-control change, confirmed separately
          from an ordinary name/phone edit. Escalation into the province
          tier (province-wide operational data, or technical/system
          administration including Backup & Restore) additionally
          requires the role name to be typed, because those grants are
          the ones worth slowing down. */}
      {pendingRoleChange && (
        <ConfirmModal
          open
          icon={<ShieldAlert size={18} />}
          danger
          title="Change this account's role?"
          description={
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{ROLE_LABEL[pendingRoleChange.from]}</strong> → <strong>{ROLE_LABEL[pendingRoleChange.to]}</strong>
              </p>
              <p>
                This changes what this account can see and do immediately, including which cases and survivor records it
                can reach. Jurisdiction fields are reset to match the new role.
              </p>
              {PROVINCE_TIER_ROLES.includes(pendingRoleChange.to) && (
                <p style={{ marginBottom: 0 }}>
                  <strong>This grants province-tier access.</strong>
                  {pendingRoleChange.to === 'provincial_admin' || pendingRoleChange.to === 'super_admin'
                    ? ' That includes system administration — administrator accounts, the audit log, and Backup & Restore.'
                    : ' That includes province-wide case, SOS and shelter data.'}
                </p>
              )}
            </>
          }
          confirmLabel="Change Role"
          loadingLabel="Saving…"
          requirePhrase={PROVINCE_TIER_ROLES.includes(pendingRoleChange.to) ? ROLE_LABEL[pendingRoleChange.to] : undefined}
          loading={editing}
          onCancel={() => setPendingRoleChange(null)}
          onConfirm={() => {
            setPendingRoleChange(null);
            void submitEdit(true);
          }}
        />
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate this account?"
          body={`${formatFullName(pendingDeactivate)} will immediately lose sign-in access. You can reactivate this account at any time.`}
          confirmLabel="Deactivate"
          danger
          onCancel={() => setPendingDeactivate(null)}
          onConfirm={() => {
            toggleActive(pendingDeactivate);
            setPendingDeactivate(null);
          }}
        />
      )}
    </div>
  );
}

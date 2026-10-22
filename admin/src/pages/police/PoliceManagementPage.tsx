import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { ConfirmDialog, EmptyState, Modal, PageHeader, StatusBadge, StatCard } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { type AdminMetadata, formatDateTime, extractInvokeError } from '../../lib/adminUserHelpers';
import { formatFullName, SUFFIX_OPTIONS } from '../../lib/personName';
import { sanitizePhoneInput, PH_PHONE_RE } from '../../lib/validators';
import type { Municipality, UserProfile } from '../../types/database.types';

/**
 * Police Management (module32) — a dedicated personnel-administration
 * surface over the EXISTING law_enforcement role and the EXISTING
 * create-admin-user/admin-user-metadata Edge Functions. Deliberately
 * does not touch sos_alerts, law_enforcement_referrals, or any
 * case-response table — see module32_police_management.sql's header
 * for the full audit this page is built from.
 *
 * PROVINCE-TIER ONLY — provincial_staff/provincial_admin/super_admin.
 * Municipal Admin (MSWDO) does NOT get this module (confirmed product
 * decision); route guard in App.tsx and the police.manage permission in
 * permissions.ts both reflect this, and create-admin-user/index.ts never
 * accepts a municipal_admin caller for role === 'law_enforcement' on
 * either action — so this is enforced server-side, not just by this
 * page/route being unreachable from the sidebar.
 *
 * Scope by role within this page:
 *   - provincial_admin/super_admin: full reach — create, update
 *     (including municipality (re)assignment), province-wide view.
 *   - provincial_staff: province-wide VIEW; may update an existing
 *     officer's name/phone/municipality, but can never create one.
 */
export function PoliceManagementPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const canCreate = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  // provincial_staff may update (reuses the same Edit modal) but never create.
  const canEdit = profile?.role === 'provincial_admin' || profile?.role === 'super_admin' || profile?.role === 'provincial_staff';

  const [officers, setOfficers] = useState<UserProfile[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [metadata, setMetadata] = useState<Record<string, AdminMetadata>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('');
  const [resetState, setResetState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});

  const load = useCallback(async () => {
    // Province-wide — is_provincial_admin() already includes
    // provincial_staff (module11), and this page is unreachable by
    // anyone else (route guard + police.manage permission).
    const { data } = await supabase.from('user_profiles').select('*').eq('role', 'law_enforcement').order('first_name');
    setOfficers(data ?? []);

    const { data: muni } = await supabase.from('municipalities').select('*').eq('is_active', true).order('municipality_name');
    setMunicipalities(muni ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (officers.length === 0) {
      setMetadata({});
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke('admin-user-metadata', { body: { profileIds: officers.map((o) => o.profile_id) } })
      .then(({ data }) => {
        if (!cancelled) setMetadata((data as { metadata?: Record<string, AdminMetadata> } | null)?.metadata ?? {});
      })
      .catch((e) => console.error('[PoliceManagementPage] admin-user-metadata:', e));
    return () => {
      cancelled = true;
    };
  }, [officers]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  const municipalityName = (id: string | null) => (id ? municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—' : 'Unassigned');

  const filtered = useMemo(() => {
    let rows = officers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => formatFullName(o).toLowerCase().includes(q) || (metadata[o.profile_id]?.email ?? '').toLowerCase().includes(q));
    }
    if (statusFilter) rows = rows.filter((o) => (statusFilter === 'active' ? o.is_active : !o.is_active));
    if (municipalityFilter) rows = rows.filter((o) => o.municipality_id === municipalityFilter);
    return rows;
  }, [officers, search, statusFilter, municipalityFilter, metadata]);

  const total = officers.length;
  const activeCount = officers.filter((o) => o.is_active).length;
  const inactiveCount = total - activeCount;
  const assignedCount = officers.filter((o) => o.municipality_id).length;

  const toggleActive = async (o: UserProfile) => {
    // Direct table update, not the Edge Function — the SAME existing
    // "Admins can update profile status in scope" RLS policy + its
    // is_active-only column grant (module2/3) that already lets
    // provincial_staff/provincial_admin toggle any other role's account.
    // Zero new RLS needed for this action.
    const { error } = await supabase.from('user_profiles').update({ is_active: !o.is_active }).eq('profile_id', o.profile_id);
    if (error) {
      showToast('error', 'Could not update this account. Please try again.');
      return;
    }
    setOfficers((prev) => prev.map((x) => (x.profile_id === o.profile_id ? { ...x, is_active: !x.is_active } : x)));
    showToast('success', `${formatFullName(o)} ${o.is_active ? 'deactivated' : 'activated'}.`);
  };

  // Deactivating an officer account immediately blocks their sign-in —
  // materially consequential, so it gets a confirm step. Reactivating
  // does not (it only restores access they already had).
  const [pendingDeactivate, setPendingDeactivate] = useState<UserProfile | null>(null);
  const onToggleActiveClick = (o: UserProfile) => {
    if (o.is_active) setPendingDeactivate(o);
    else toggleActive(o);
  };

  const resendAccess = async (o: UserProfile) => {
    const email = metadata[o.profile_id]?.email;
    if (!email) return;
    setResetState((s) => ({ ...s, [o.profile_id]: 'sending' }));
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/admin/reset-password` });
    setResetState((s) => ({ ...s, [o.profile_id]: error ? 'error' : 'sent' }));
  };

  // ---- Add Police Officer (create — province-admin tier only) ----
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', firstName: '', middleName: '', lastName: '', suffix: '', phoneNumber: '', municipalityId: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetForm = () => {
    setForm({ email: '', password: '', firstName: '', middleName: '', lastName: '', suffix: '', phoneNumber: '', municipalityId: '' });
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!form.email || !form.password || !form.firstName || !form.lastName) {
      setCreateError('Please fill in all required fields.');
      return;
    }
    if (form.phoneNumber.trim() && !PH_PHONE_RE.test(form.phoneNumber.trim())) {
      setCreateError('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX) or leave it blank.');
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
        role: 'law_enforcement',
        municipalityId: form.municipalityId || undefined,
      },
    });
    setCreating(false);
    const message = await extractInvokeError(data, error);
    if (message) {
      setCreateError(message);
      return;
    }
    setCreateOpen(false);
    resetForm();
    showToast('success', 'Police Officer account created.');
    load();
  };

  // ---- Edit officer (update — provincial_admin/super_admin/provincial_staff) ----
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ firstName: '', middleName: '', lastName: '', suffix: '', phoneNumber: '', municipalityId: '' });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEdit = (o: UserProfile) => {
    setEditForm({
      firstName: o.first_name,
      middleName: o.middle_name ?? '',
      lastName: o.last_name,
      suffix: o.suffix ?? '',
      phoneNumber: o.phone_number ?? '',
      municipalityId: o.municipality_id ?? '',
    });
    setEditError(null);
    setEditTarget(o);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.firstName || !editForm.lastName) {
      setEditError('Please fill in all required fields.');
      return;
    }
    if (editForm.phoneNumber.trim() && !PH_PHONE_RE.test(editForm.phoneNumber.trim())) {
      setEditError('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX) or leave it blank.');
      return;
    }
    setEditing(true);
    setEditError(null);
    const { data, error } = await supabase.functions.invoke('create-admin-user', {
      body: {
        action: 'update',
        profileId: editTarget.profile_id,
        role: 'law_enforcement',
        firstName: editForm.firstName.trim(),
        middleName: editForm.middleName.trim() || undefined,
        lastName: editForm.lastName.trim(),
        suffix: editForm.suffix.trim() || undefined,
        phoneNumber: editForm.phoneNumber.trim() || undefined,
        municipalityId: editForm.municipalityId || undefined,
      },
    });
    setEditing(false);
    const message = await extractInvokeError(data, error);
    if (message) {
      setEditError(message);
      return;
    }
    setEditTarget(null);
    showToast('success', 'Officer account updated.');
    load();
  };

  return (
    <div>
      <datalist id="suffix-options">
        {SUFFIX_OPTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <PageHeader
        title="Police Management"
        subtitle="Police Officer accounts across Aurora Province. Account creation is restricted to provincial administrators."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                + Add Police Officer
              </button>
            )}
            <DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -8, marginBottom: 16 }}>
        This page manages Police Officer accounts and assignments only. It does not change how SOS alerts reach a Police
        Officer or how incident referrals are assigned — see Emergency SOS and Case Management for those workflows.
      </p>

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <StatCard label="Total Officers" value={total} />
        <StatCard label="Active" value={activeCount} accent="var(--color-success)" />
        <StatCard label="Inactive" value={inactiveCount} accent="var(--color-text-muted)" />
        <StatCard label="With Municipality Assigned" value={assignedCount} accent="var(--color-primary)" />
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <input
          className="input"
          style={{ flex: '1 1 200px' }}
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="input" style={{ width: 200 }} value={municipalityFilter} onChange={(e) => setMunicipalityFilter(e.target.value)}>
          <option value="">All municipalities (including unassigned)</option>
          {municipalities.map((m) => (
            <option key={m.municipality_id} value={m.municipality_id}>
              {m.municipality_name}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No Police Officer accounts found"
            subtitle='Create one using "Add Police Officer", or adjust your filters.'
          />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Municipality</th>
                  <th>Created</th>
                  <th>Last Sign-in</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.profile_id}>
                    <td>{formatFullName(o)}</td>
                    <td style={{ fontSize: 12.5 }}>{metadata[o.profile_id]?.email ?? '—'}</td>
                    <td>{o.phone_number ?? '—'}</td>
                    <td>{municipalityName(o.municipality_id)}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{formatDateTime(metadata[o.profile_id]?.last_sign_in_at ?? null)}</td>
                    <td>
                      <StatusBadge label={o.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="table-actions-cell">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canEdit && (
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(o)}>
                            Edit
                          </button>
                        )}
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => resendAccess(o)}
                          disabled={!metadata[o.profile_id]?.email || resetState[o.profile_id] === 'sending'}
                        >
                          {resetState[o.profile_id] === 'sending' ? 'Sending...' : resetState[o.profile_id] === 'sent' ? 'Sent' : 'Reset Access'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => onToggleActiveClick(o)}>
                          {o.is_active ? 'Deactivate' : 'Activate'}
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

      {createOpen && (
        <Modal
          title="Add Police Officer"
          onClose={() => {
            setCreateOpen(false);
            resetForm();
          }}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setCreateOpen(false); resetForm(); }} disabled={creating}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create account'}
              </button>
            </>
          }
        >
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
              <input className="input" list="suffix-options" placeholder="e.g. Jr., Sr., III" value={form.suffix} onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))} />
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
          <div className="field">
            <label className="label">Assigned municipality (optional)</label>
            <select className="input" value={form.municipalityId} onChange={(e) => setForm((f) => ({ ...f, municipalityId: e.target.value }))}>
              <option value="">Unassigned</option>
              {municipalities.map((m) => (
                <option key={m.municipality_id} value={m.municipality_id}>{m.municipality_name}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              For personnel oversight only — this does not change how SOS alerts or case referrals reach this officer.
            </p>
          </div>

          {createError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{createError}</p>}
        </Modal>
      )}

      {editTarget && (
        <Modal
          title={`Edit — ${editTarget.first_name} ${editTarget.last_name}`}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEditTarget(null)} disabled={editing}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitEdit} disabled={editing}>
                {editing ? 'Saving...' : 'Save changes'}
              </button>
            </>
          }
        >
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
          <div className="field">
            <label className="label">Assigned municipality</label>
            <select className="input" value={editForm.municipalityId} onChange={(e) => setEditForm((f) => ({ ...f, municipalityId: e.target.value }))}>
              <option value="">Unassigned</option>
              {municipalities.map((m) => (
                <option key={m.municipality_id} value={m.municipality_id}>{m.municipality_name}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Email cannot be changed here. Use Reset Access on the table row to let this officer set a new password.
          </p>

          {editError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{editError}</p>}
        </Modal>
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

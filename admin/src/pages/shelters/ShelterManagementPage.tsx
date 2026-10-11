import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { describeCoordinateError } from '../../lib/geo';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { ShelterLocationPicker } from '../../components/maps/ShelterLocationPicker';
import type { Municipality, Shelter } from '../../types/database.types';

const KNOWN_SERVICES = ['Counseling', 'Legal Aid', 'Medical Care', 'Childcare', 'Skills Training', 'Food & Meals', 'Transportation', 'Emergency Response'];

function parseServices(raw: string): { checked: string[]; other: string } {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const checked: string[] = [];
  const other: string[] = [];
  for (const item of items) {
    const match = KNOWN_SERVICES.find((k) => k.toLowerCase() === item.toLowerCase());
    if (match && !checked.includes(match)) checked.push(match);
    else if (!match) other.push(item);
  }
  return { checked, other: other.join(', ') };
}

function buildServicesString(checked: string[], other: string): string {
  const otherItems = other
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...checked, ...otherItems].join(', ');
}

const EMPTY_FORM = {
  municipality_id: '',
  shelter_name: '',
  address: '',
  contact_number: '',
  email: '',
  capacity: '',
  servicesChecked: [] as string[],
  servicesOther: '',
  latitude: null as number | null,
  longitude: null as number | null,
};

// Full shelter CRUD — creating a shelter and editing its identity/location
// fields (name/address/municipality/coordinates) is provincial/municipal
// admin territory; shelter_admin only ever touches their own shelter's
// operational fields, via ShelterAdminDashboard's smaller edit form, never
// this page (its route is protected accordingly in App.tsx).
export function ShelterManagementPage() {
  const { profile, municipality, roleTier } = useAuth();
  const { showToast } = useToast();
  const isProvincial = roleTier === 'province';

  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOccupancy, setEditingOccupancy] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('shelters').select('*').order('shelter_name');
    if (!isProvincial && profile?.municipality_id) {
      query = query.eq('municipality_id', profile.municipality_id);
    }
    const { data } = await query;
    setShelters(data ?? []);

    if (isProvincial) {
      const { data: muni } = await supabase.from('municipalities').select('*').order('municipality_name');
      setMunicipalities(muni ?? []);
    }
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
  }, [load]);

  const municipalityName = (id: string) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—';

  const openCreate = () => {
    setEditingId(null);
    setEditingOccupancy(0);
    setForm({ ...EMPTY_FORM, municipality_id: isProvincial ? '' : profile?.municipality_id ?? '' });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (s: Shelter) => {
    const { checked, other } = parseServices(s.services_available ?? '');
    setEditingId(s.shelter_id);
    setEditingOccupancy(s.current_occupancy ?? 0);
    setForm({
      municipality_id: s.municipality_id,
      shelter_name: s.shelter_name,
      address: s.address ?? '',
      contact_number: s.contact_number ?? '',
      email: s.email ?? '',
      capacity: s.capacity != null ? String(s.capacity) : '',
      servicesChecked: checked,
      servicesOther: other,
      latitude: s.latitude,
      longitude: s.longitude,
    });
    setError(null);
    setModalOpen(true);
  };

  const toggleActive = async (s: Shelter) => {
    await supabase.from('shelters').update({ is_active: !s.is_active }).eq('shelter_id', s.shelter_id);
    setShelters((prev) => prev.map((x) => (x.shelter_id === s.shelter_id ? { ...x, is_active: !x.is_active } : x)));
  };

  const toggleService = (name: string) => {
    setForm((f) => ({
      ...f,
      servicesChecked: f.servicesChecked.includes(name) ? f.servicesChecked.filter((s) => s !== name) : [...f.servicesChecked, name],
    }));
  };

  const submit = async () => {
    const municipalityId = isProvincial ? form.municipality_id : profile?.municipality_id;
    if (!form.shelter_name.trim() || !municipalityId) {
      setError('Please fill in the shelter name and municipality.');
      return;
    }

    let capacity: number | null = null;
    if (form.capacity.trim()) {
      capacity = Number(form.capacity);
      if (!Number.isFinite(capacity) || capacity < 0) {
        setError('Capacity must be a non-negative number.');
        return;
      }
      if (editingId && capacity < editingOccupancy) {
        setError(`Capacity can't be less than the current occupancy (${editingOccupancy}).`);
        return;
      }
    }

    const coordError = describeCoordinateError(form.latitude, form.longitude);
    if (coordError) {
      setError(coordError);
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      municipality_id: municipalityId,
      shelter_name: form.shelter_name.trim(),
      address: form.address.trim() || null,
      contact_number: form.contact_number.trim() || null,
      email: form.email.trim() || null,
      capacity,
      services_available: buildServicesString(form.servicesChecked, form.servicesOther) || null,
      latitude: form.latitude,
      longitude: form.longitude,
    };

    const { error: dbErr } = editingId
      ? await supabase.from('shelters').update(payload).eq('shelter_id', editingId)
      : await supabase.from('shelters').insert(payload);

    setSaving(false);
    if (dbErr) {
      if (import.meta.env.DEV) console.error('Shelter save failed:', dbErr);
      setError(dbErr.message || 'Could not save this shelter. Please try again.');
      showToast('error', editingId ? 'Could not save changes to this shelter.' : 'Could not create this shelter.');
      return;
    }
    setModalOpen(false);
    showToast('success', editingId ? 'Shelter updated.' : 'Shelter added.');
    load();
  };

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="Shelter Management"
        subtitle={isProvincial ? 'All shelters in the province' : 'Shelters in your municipality'}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={openCreate}>
              Add shelter
            </button>
            <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : shelters.length === 0 ? (
          <EmptyState title="No shelters yet" subtitle="Add your first shelter to get started." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Shelter</th>
                  {isProvincial && <th>Municipality</th>}
                  <th>Address</th>
                  <th>Capacity</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {shelters.map((s) => (
                  <tr key={s.shelter_id}>
                    <td>{s.shelter_name}</td>
                    {isProvincial && <td>{municipalityName(s.municipality_id)}</td>}
                    <td style={{ color: 'var(--color-text-muted)' }}>{s.address ?? '—'}</td>
                    <td>
                      {s.current_occupancy}/{s.capacity ?? '—'}
                    </td>
                    <td>
                      <StatusBadge label={s.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="table-actions-cell">
                      <button className="btn btn-outline btn-sm" style={{ marginRight: 6 }} onClick={() => openEdit(s)}>
                        Edit
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(s)}>
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal
          title={editingId ? 'Edit shelter' : 'Add a shelter'}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>
                {saving ? (editingId ? 'Saving changes...' : 'Creating shelter...') : editingId ? 'Save changes' : 'Add shelter'}
              </button>
            </>
          }
        >
          <SectionHeading first>Basic information</SectionHeading>
          <div className="field">
            <label className="label">Shelter name</label>
            <input className="input" value={form.shelter_name} onChange={(e) => setForm((f) => ({ ...f, shelter_name: e.target.value }))} disabled={saving} />
          </div>
          <div className="field">
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} disabled={saving} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Contact number</label>
              <input
                className="input"
                value={form.contact_number}
                onChange={(e) => setForm((f) => ({ ...f, contact_number: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={saving} />
            </div>
          </div>

          <SectionHeading>Capacity</SectionHeading>
          <div className="field">
            <label className="label">Total capacity</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              disabled={saving}
              style={{ maxWidth: 200 }}
            />
            {editingId && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Currently occupied: {editingOccupancy}</p>
            )}
          </div>

          <SectionHeading>Services</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 12 }}>
            {KNOWN_SERVICES.map((service) => (
              <label key={service} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
                <input type="checkbox" checked={form.servicesChecked.includes(service)} onChange={() => toggleService(service)} disabled={saving} />
                {service}
              </label>
            ))}
          </div>
          <div className="field">
            <label className="label">Other services (comma-separated)</label>
            <input
              className="input"
              placeholder="e.g. Spiritual counseling, Pet boarding"
              value={form.servicesOther}
              onChange={(e) => setForm((f) => ({ ...f, servicesOther: e.target.value }))}
              disabled={saving}
            />
          </div>

          <SectionHeading>Location</SectionHeading>
          <ShelterLocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            address={form.address}
            onChange={(lat, lng) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
          />

          <SectionHeading>Administrative info</SectionHeading>
          {isProvincial ? (
            <div className="field">
              <label className="label">Municipality</label>
              <select
                className="input"
                value={form.municipality_id}
                onChange={(e) => setForm((f) => ({ ...f, municipality_id: e.target.value }))}
                disabled={saving}
              >
                <option value="">Select municipality</option>
                {municipalities.map((m) => (
                  <option key={m.municipality_id} value={m.municipality_id}>
                    {m.municipality_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              This shelter will be created under your municipality: <strong>{municipality?.municipality_name ?? '—'}</strong>
            </p>
          )}

          {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 16 }}>{error}</p>}
        </Modal>
      )}
    </div>
  );
}

function SectionHeading({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <h4
      style={{
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--color-text-muted)',
        marginTop: first ? 0 : 20,
        marginBottom: 10,
        paddingTop: first ? 0 : 16,
        borderTop: first ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {children}
    </h4>
  );
}

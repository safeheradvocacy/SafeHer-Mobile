import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { Barangay, Municipality } from '../../types/database.types';
import { sanitizePhoneInput } from '../../lib/validators';

export function BarangayManagementPage() {
  const { profile, municipality, roleTier } = useAuth();
  const isProvincial = roleTier === 'province';
  const canManage = roleTier === 'province' || roleTier === 'municipality';

  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newMunicipalityId, setNewMunicipalityId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('barangays').select('*').order('barangay_name');
    if (!isProvincial && profile?.municipality_id) {
      query = query.eq('municipality_id', profile.municipality_id);
    }
    const { data } = await query;
    setBarangays(data ?? []);

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

  const toggleActive = async (b: Barangay) => {
    await supabase.from('barangays').update({ is_active: !b.is_active }).eq('barangay_id', b.barangay_id);
    setBarangays((prev) => prev.map((x) => (x.barangay_id === b.barangay_id ? { ...x, is_active: !x.is_active } : x)));
    // No manual logAudit() call here — trg_audit_barangays (see
    // supabase/module3_barangay_hierarchy.sql) fires automatically.
  };

  const submitCreate = async () => {
    const municipalityId = isProvincial ? newMunicipalityId : profile?.municipality_id;
    if (!newName.trim() || !municipalityId) return;
    setSaving(true);
    setError(null);
    const { error: insertErr } = await supabase.from('barangays').insert({
      municipality_id: municipalityId,
      barangay_name: newName.trim(),
      contact_number: newContact.trim() || null,
    });
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message.includes('duplicate') ? 'A barangay with this name already exists in that municipality.' : 'Could not add this barangay. Please try again.');
      return;
    }
    setCreateModalOpen(false);
    setNewName('');
    setNewContact('');
    setNewMunicipalityId('');
    load();
  };

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="Barangay Management"
        subtitle={isProvincial ? 'All barangays in the province' : municipality?.municipality_name}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {canManage && (
              <button className="btn btn-primary" onClick={() => setCreateModalOpen(true)}>
                Add barangay
              </button>
            )}
            <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : barangays.length === 0 ? (
          <EmptyState title="No barangays yet" subtitle="Add your first barangay to get started." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Barangay</th>
                  {isProvincial && <th>Municipality</th>}
                  <th>Contact</th>
                  <th>Status</th>
                  {canManage && <th className="table-actions-cell"></th>}
                </tr>
              </thead>
              <tbody>
                {barangays.map((b) => (
                  <tr key={b.barangay_id}>
                    <td>{b.barangay_name}</td>
                    {isProvincial && <td>{municipalityName(b.municipality_id)}</td>}
                    <td style={{ color: 'var(--color-text-muted)' }}>{b.contact_number ?? '—'}</td>
                    <td>
                      <StatusBadge label={b.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    {canManage && (
                      <td className="table-actions-cell">
                        <button className="btn btn-outline btn-sm" onClick={() => toggleActive(b)}>
                          {b.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createModalOpen && (
        <Modal
          title="Add a barangay"
          onClose={() => setCreateModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setCreateModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={saving || !newName.trim() || (isProvincial && !newMunicipalityId)}
              >
                {saving ? 'Saving...' : 'Add barangay'}
              </button>
            </>
          }
        >
          {isProvincial && (
            <div className="field">
              <label className="label">Municipality</label>
              <select className="input" value={newMunicipalityId} onChange={(e) => setNewMunicipalityId(e.target.value)}>
                <option value="">Select municipality</option>
                {municipalities.map((m) => (
                  <option key={m.municipality_id} value={m.municipality_id}>
                    {m.municipality_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label className="label">Barangay name</label>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Poblacion" />
          </div>
          <div className="field">
            <label className="label">Contact number</label>
            <input className="input" type="tel" inputMode="tel" value={newContact} onChange={(e) => setNewContact(sanitizePhoneInput(e.target.value))} />
          </div>
          {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        </Modal>
      )}
    </div>
  );
}

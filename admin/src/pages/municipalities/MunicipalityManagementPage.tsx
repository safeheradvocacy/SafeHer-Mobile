import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { CaseReport, Municipality, Shelter } from '../../types/database.types';

export function MunicipalityManagementPage() {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [muniRes, caseRes, shelterRes] = await Promise.all([
      supabase.from('municipalities').select('*').order('municipality_name'),
      supabase.from('case_reports').select('*'),
      supabase.from('shelters').select('*'),
    ]);
    setMunicipalities(muniRes.data ?? []);
    setCases(caseRes.data ?? []);
    setShelters(shelterRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  const toggleActive = async (m: Municipality) => {
    await supabase.from('municipalities').update({ is_active: !m.is_active }).eq('municipality_id', m.municipality_id);
    // No manual logAudit() call here — trg_audit_municipalities (see
    // supabase/module3_barangay_hierarchy.sql) fires automatically.
    setMunicipalities((prev) => prev.map((x) => (x.municipality_id === m.municipality_id ? { ...x, is_active: !x.is_active } : x)));
  };

  return (
    <div>
      <PageHeader
        title="Municipality Management"
        subtitle="All municipalities in the province"
        actions={<DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Municipality</th>
              <th>Contact</th>
              <th>Cases</th>
              <th>Shelters</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {municipalities.map((m) => (
              <tr key={m.municipality_id}>
                <td>{m.municipality_name}</td>
                <td style={{ color: 'var(--color-text-muted)' }}>{m.contact_number ?? '—'}</td>
                <td>{cases.filter((c) => c.municipality_id === m.municipality_id).length}</td>
                <td>{shelters.filter((s) => s.municipality_id === m.municipality_id).length}</td>
                <td>{m.is_active ? 'Active' : 'Inactive'}</td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={() => toggleActive(m)}>
                    {m.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

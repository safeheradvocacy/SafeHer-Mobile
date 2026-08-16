import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { PageHeader } from '../../components/ui';
import type { CaseReport, Municipality, Shelter, SosAlert } from '../../types/database.types';

export function MunicipalityManagementPage() {
  const { profile } = useAuth();
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);

  useEffect(() => {
    (async () => {
      const [muniRes, caseRes, shelterRes] = await Promise.all([
        supabase.from('municipalities').select('*').order('municipality_name'),
        supabase.from('case_reports').select('*'),
        supabase.from('shelters').select('*'),
      ]);
      setMunicipalities(muniRes.data ?? []);
      setCases(caseRes.data ?? []);
      setShelters(shelterRes.data ?? []);
    })();
  }, []);

  const toggleActive = async (m: Municipality) => {
    if (!profile) return;
    await supabase.from('municipalities').update({ is_active: !m.is_active }).eq('municipality_id', m.municipality_id);
    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'municipalities',
      recordId: m.municipality_id,
      oldValues: { is_active: m.is_active },
      newValues: { is_active: !m.is_active },
    });
    setMunicipalities((prev) => prev.map((x) => (x.municipality_id === m.municipality_id ? { ...x, is_active: !x.is_active } : x)));
  };

  return (
    <div>
      <PageHeader title="Municipality Management" subtitle="All municipalities in the province" />
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

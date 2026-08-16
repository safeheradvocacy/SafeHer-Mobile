import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { supabase } from '../../lib/supabase';
import { PageHeader, StatCard } from '../../components/ui';
import type { CaseReport, Municipality, Shelter } from '../../types/database.types';

export function ProvincialDashboard() {
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [caseRes, muniRes, shelterRes, sosRes] = await Promise.all([
        supabase.from('case_reports').select('*'),
        supabase.from('municipalities').select('*').eq('is_active', true).order('municipality_name'),
        supabase.from('shelters').select('*').eq('is_active', true),
        supabase.from('sos_alerts').select('*', { count: 'exact', head: true }).in('status', ['Triggered', 'Responding']),
      ]);
      setCases(caseRes.data ?? []);
      setMunicipalities(muniRes.data ?? []);
      setShelters(shelterRes.data ?? []);
      setActiveSosCount(sosRes.count ?? 0);
      setLoading(false);
    })();
  }, []);

  const total = cases.length;
  const pending = cases.filter((c) => c.status === 'Pending').length;
  const active = cases.filter((c) => ['Assigned', 'In Progress', 'Referred', 'Under Review'].includes(c.status)).length;
  const resolved = cases.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length;

  const casesByMuni = municipalities.map((m) => ({
    name: m.municipality_name,
    count: cases.filter((c) => c.municipality_id === m.municipality_id).length,
  }));

  const totalCapacity = shelters.reduce((sum, s) => sum + s.capacity, 0);
  const totalOccupancy = shelters.reduce((sum, s) => sum + s.current_occupancy, 0);
  const utilization = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;

  return (
    <div>
      <PageHeader title="Provincial Dashboard" subtitle="Province-wide oversight across all municipalities" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total cases" value={loading ? '–' : total} />
        <StatCard label="Pending" value={loading ? '–' : pending} accent="#C98A3B" />
        <StatCard label="Active" value={loading ? '–' : active} accent="#4C7EA8" />
        <StatCard label="Resolved" value={loading ? '–' : resolved} accent="#4A8C6F" />
        <StatCard label="Active SOS" value={loading ? '–' : activeSosCount} accent="#C4485B" />
        <StatCard label="Shelter utilization" value={loading ? '–' : `${utilization}%`} accent="#6C5CA6" />
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Cases by municipality</h3>
        {casesByMuni.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No data yet.</p>
        ) : (
          <Bar
            data={{
              labels: casesByMuni.map((m) => m.name),
              datasets: [{ label: 'Cases', data: casesByMuni.map((m) => m.count), backgroundColor: '#6C5CA6' }],
            }}
            options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
          />
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Municipalities</h3>
        <table>
          <thead>
            <tr>
              <th>Municipality</th>
              <th>Cases</th>
              <th>Shelters</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {municipalities.map((m) => (
              <tr key={m.municipality_id}>
                <td>{m.municipality_name}</td>
                <td>{cases.filter((c) => c.municipality_id === m.municipality_id).length}</td>
                <td>{shelters.filter((s) => s.municipality_id === m.municipality_id).length}</td>
                <td>{m.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

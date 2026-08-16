import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { CHART_COLORS } from '../../lib/chartSetup';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader, StatCard, StatusBadge } from '../../components/ui';
import type { CaseReport } from '../../types/database.types';

export function MunicipalDashboard() {
  const { profile, municipality } = useAuth();
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.municipality_id) return;
    (async () => {
      const { data: caseRows } = await supabase
        .from('case_reports')
        .select('*')
        .eq('municipality_id', profile.municipality_id)
        .order('reported_at', { ascending: false });
      setCases(caseRows ?? []);

      const { count } = await supabase
        .from('sos_alerts')
        .select('*, user_profiles!inner(municipality_id)', { count: 'exact', head: true })
        .eq('user_profiles.municipality_id', profile.municipality_id)
        .in('status', ['Triggered', 'Responding']);
      setActiveSosCount(count ?? 0);
      setLoading(false);
    })();
  }, [profile?.municipality_id]);

  const total = cases.length;
  const pending = cases.filter((c) => c.status === 'Pending').length;
  const active = cases.filter((c) => ['Assigned', 'In Progress', 'Referred', 'Under Review'].includes(c.status)).length;
  const resolved = cases.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length;

  const byType = groupCount(cases, (c) => c.case_type);
  const byMonth = trendByMonth(cases);

  return (
    <div>
      <PageHeader title="Municipal Dashboard" subtitle={municipality?.municipality_name ?? undefined} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total cases" value={loading ? '–' : total} />
        <StatCard label="Pending" value={loading ? '–' : pending} accent="#C98A3B" />
        <StatCard label="Active" value={loading ? '–' : active} accent="#4C7EA8" />
        <StatCard label="Resolved" value={loading ? '–' : resolved} accent="#4A8C6F" />
        <StatCard label="Active SOS alerts" value={loading ? '–' : activeSosCount} accent="#C4485B" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Case trend (last 6 months)</h3>
          <Bar
            data={{
              labels: byMonth.map((m) => m.label),
              datasets: [{ label: 'Reports', data: byMonth.map((m) => m.count), backgroundColor: '#6C5CA6' }],
            }}
            options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
          />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Cases by type</h3>
          {byType.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No cases yet.</p>
          ) : (
            <Doughnut
              data={{
                labels: byType.map((t) => t.label),
                datasets: [{ data: byType.map((t) => t.count), backgroundColor: CHART_COLORS }],
              }}
            />
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Recent cases</h3>
        <table>
          <thead>
            <tr>
              <th>Case #</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {cases.slice(0, 8).map((c) => (
              <tr key={c.case_id}>
                <td>
                  <Link to={`/admin/cases/${c.case_id}`}>{c.case_number}</Link>
                </td>
                <td>{c.case_type}</td>
                <td>
                  <StatusBadge label={c.priority_level} />
                </td>
                <td>
                  <StatusBadge label={c.status} />
                </td>
                <td>{new Date(c.reported_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function groupCount<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
}

function trendByMonth(cases: CaseReport[]) {
  const now = new Date();
  const months: { label: string; key: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString(undefined, { month: 'short' }), key: `${d.getFullYear()}-${d.getMonth()}`, count: 0 });
  }
  for (const c of cases) {
    const d = new Date(c.reported_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.count += 1;
  }
  return months;
}

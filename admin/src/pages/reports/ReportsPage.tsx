import React, { useEffect, useMemo, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import '../../lib/chartSetup';
import { CHART_COLORS } from '../../lib/chartSetup';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader, StatCard } from '../../components/ui';
import type { CaseReport, ShelterReferral, SosAlert } from '../../types/database.types';

export function ReportsPage() {
  const { profile } = useAuth();
  const isProvincial = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [referrals, setReferrals] = useState<ShelterReferral[]>([]);
  const [sos, setSos] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let caseQuery = supabase.from('case_reports').select('*');
      if (!isProvincial && profile?.municipality_id) {
        caseQuery = caseQuery.eq('municipality_id', profile.municipality_id);
      }
      const [caseRes, referralRes, sosRes] = await Promise.all([
        caseQuery,
        supabase.from('shelter_referrals').select('*'),
        supabase.from('sos_alerts').select('*'),
      ]);
      setCases(caseRes.data ?? []);
      setReferrals(referralRes.data ?? []);
      setSos(sosRes.data ?? []);
      setLoading(false);
    })();
  }, [isProvincial, profile?.municipality_id]);

  const byType = useMemo(() => groupCount(cases, (c) => c.case_type), [cases]);
  const byStatus = useMemo(() => groupCount(cases, (c) => c.status), [cases]);
  const byPriority = useMemo(() => groupCount(cases, (c) => c.priority_level), [cases]);

  const referralStats = useMemo(() => groupCount(referrals, (r) => r.referral_status), [referrals]);

  return (
    <div>
      <PageHeader title={isProvincial ? 'Provincial Reports & Analytics' : 'Reports & Analytics'} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total cases" value={loading ? '–' : cases.length} />
        <StatCard label="Total referrals" value={loading ? '–' : referrals.length} />
        <StatCard label="Total SOS alerts" value={loading ? '–' : sos.length} />
        <StatCard
          label="Resolution rate"
          value={loading || cases.length === 0 ? '–' : `${Math.round((cases.filter((c) => c.status === 'Resolved' || c.status === 'Closed').length / cases.length) * 100)}%`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <ChartCard title="Cases by type" data={byType} />
        <ChartCard title="Cases by status" data={byStatus} />
        <ChartCard title="Cases by priority" data={byPriority} />
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Referral outcomes</h3>
        {referralStats.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No referrals yet.</p>
        ) : (
          <Bar
            data={{
              labels: referralStats.map((r) => r.label),
              datasets: [{ label: 'Referrals', data: referralStats.map((r) => r.count), backgroundColor: '#6C5CA6' }],
            }}
            options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
          />
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: { label: string; count: number }[] }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: 16, fontSize: 15 }}>{title}</h3>
      {data.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No data yet.</p>
      ) : (
        <Doughnut data={{ labels: data.map((d) => d.label), datasets: [{ data: data.map((d) => d.count), backgroundColor: CHART_COLORS }] }} />
      )}
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

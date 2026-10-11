import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { REFERRAL_STATUS_FLOW, type CaseReport, type ReferralStatus, type Shelter, type ShelterReferral } from '../../types/database.types';

type ReferralRow = ShelterReferral & { shelters?: Shelter; case_reports?: CaseReport };

export function ShelterReferralPage() {
  const { profile, roleTier } = useAuth();
  const isProvincial = roleTier === 'province';
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let shelterQuery = supabase.from('shelters').select('*').eq('is_active', true);
    if (!isProvincial && profile?.municipality_id) {
      shelterQuery = shelterQuery.eq('municipality_id', profile.municipality_id);
    }
    const { data: shelterRows } = await shelterQuery.order('shelter_name');
    setShelters(shelterRows ?? []);

    const { data: referralRows } = await supabase
      .from('shelter_referrals')
      .select('*, shelters(*), case_reports(*)')
      .order('referred_at', { ascending: false });
    setReferrals((referralRows as any) ?? []);
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
  }, [load]);

  const updateReferral = async (r: ReferralRow, status: ReferralStatus) => {
    if (!profile) return;
    await supabase.from('shelter_referrals').update({ referral_status: status }).eq('referral_id', r.referral_id);

    if (status === 'Accepted' && r.shelters) {
      await supabase
        .from('shelters')
        .update({ current_occupancy: r.shelters.current_occupancy + 1 })
        .eq('shelter_id', r.shelters.shelter_id);
    }

    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'shelter_referrals',
      recordId: r.referral_id,
      oldValues: { referral_status: r.referral_status },
      newValues: { referral_status: status },
    });

    load();
  };

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader title="Shelters & Referrals" actions={<DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />} />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Shelters</h3>
        {shelters.length === 0 ? (
          <EmptyState title="No shelters found" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Contact</th>
                <th>Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {shelters.map((s) => (
                <tr key={s.shelter_id}>
                  <td>{s.shelter_name}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>{s.address}</td>
                  <td>{s.contact_number ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>
                        {s.current_occupancy}/{s.capacity}
                      </span>
                      <div style={{ width: 80, height: 6, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, (s.current_occupancy / Math.max(1, s.capacity)) * 100)}%`,
                            height: '100%',
                            background: s.current_occupancy >= s.capacity ? 'var(--color-danger)' : 'var(--color-success)',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Referrals</h3>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : referrals.length === 0 ? (
          <EmptyState title="No referrals yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case #</th>
                <th>Shelter</th>
                <th>Status</th>
                <th>Referred</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => {
                const next = REFERRAL_STATUS_FLOW[r.referral_status] ?? [];
                return (
                  <tr key={r.referral_id}>
                    <td>{r.case_reports?.case_number ?? '—'}</td>
                    <td>{r.shelters?.shelter_name ?? '—'}</td>
                    <td>
                      <StatusBadge label={r.referral_status} />
                    </td>
                    <td>{new Date(r.referred_at).toLocaleDateString()}</td>
                    <td>
                      {next.map((s) => (
                        <button key={s} className="btn btn-outline btn-sm" style={{ marginRight: 6 }} onClick={() => updateReferral(r, s)}>
                          Mark {s}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

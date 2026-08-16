import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { EmptyState, Modal, PageHeader } from '../../components/ui';
import type { Municipality, UserProfile } from '../../types/database.types';

export function UserManagementPage() {
  const { profile } = useAuth();
  const isProvincial = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [loading, setLoading] = useState(true);
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from('user_profiles').select('*');
    if (isProvincial) {
      query = query.in('role', ['municipal_admin', 'provincial_admin']);
    } else if (profile?.municipality_id) {
      query = query.eq('municipality_id', profile.municipality_id).eq('role', 'municipal_admin');
    }
    const { data } = await query.order('first_name');
    setUsers(data ?? []);

    if (isProvincial) {
      const { data: muni } = await supabase.from('municipalities').select('*').order('municipality_name');
      setMunicipalities(muni ?? []);
    }
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (u: UserProfile) => {
    if (!profile) return;
    await supabase.from('user_profiles').update({ is_active: !u.is_active }).eq('profile_id', u.profile_id);
    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'user_profiles',
      recordId: u.profile_id,
      oldValues: { is_active: u.is_active },
      newValues: { is_active: !u.is_active },
    });
    setUsers((prev) => prev.map((x) => (x.profile_id === u.profile_id ? { ...x, is_active: !x.is_active } : x)));
  };

  const municipalityName = (id: string | null) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—';

  return (
    <div>
      <PageHeader
        title={isProvincial ? 'Administrator Management' : 'User Management'}
        actions={
          <button className="btn btn-primary" onClick={() => setInfoModalOpen(true)}>
            Add administrator
          </button>
        }
      />

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : users.length === 0 ? (
          <EmptyState title="No accounts found" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                {isProvincial && <th>Municipality</th>}
                <th>Phone</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.profile_id}>
                  <td>
                    {u.first_name} {u.last_name}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{u.role.replace('_', ' ')}</td>
                  {isProvincial && <td>{municipalityName(u.municipality_id)}</td>}
                  <td>{u.phone_number ?? '—'}</td>
                  <td>{u.is_active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)} disabled={u.profile_id === profile?.profile_id}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {infoModalOpen && (
        <Modal title="Add an administrator" onClose={() => setInfoModalOpen(false)}>
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            Creating a new login requires Supabase's admin API, which needs the project's service role key. That key
            must never be shipped to this browser app. Deploy the included{' '}
            <code>supabase/functions/create-admin-user</code> Edge Function (service role key stays server-side there)
            and call it from here — once deployed, this dialog can POST to it directly.
          </p>
        </Modal>
      )}
    </div>
  );
}

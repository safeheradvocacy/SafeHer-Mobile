import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { PageHeader } from '../../components/ui';

export function SettingsPage() {
  const { profile, municipality, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    const oldValues = { first_name: profile.first_name, last_name: profile.last_name, phone_number: profile.phone_number };
    await supabase.from('user_profiles').update({ first_name: firstName, last_name: lastName, phone_number: phoneNumber }).eq('profile_id', profile.profile_id);
    await logAudit({
      profileId: profile.profile_id,
      action: 'UPDATE',
      tableName: 'user_profiles',
      recordId: profile.profile_id,
      oldValues,
      newValues: { first_name: firstName, last_name: lastName, phone_number: phoneNumber },
    });
    await refreshProfile();
    setSaving(false);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordMsg('Password must be at least 8 characters.');
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    setPasswordMsg(error ? error.message : 'Password updated.');
    if (!error) setNewPassword('');
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle={municipality?.municipality_name ?? 'Province-wide account'} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Profile</h3>
          <div className="field">
            <label className="label">First name</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Last name</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Phone number</label>
            <input className="input" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {savedMsg && <span style={{ marginLeft: 12, color: 'var(--color-success)', fontSize: 13 }}>Saved</span>}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Account security</h3>
          <div className="field">
            <label className="label">New password</label>
            <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <button className="btn btn-outline" onClick={changePassword} disabled={changingPassword}>
            {changingPassword ? 'Updating...' : 'Update password'}
          </button>
          {passwordMsg && <p style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>{passwordMsg}</p>}
        </div>
      </div>
    </div>
  );
}

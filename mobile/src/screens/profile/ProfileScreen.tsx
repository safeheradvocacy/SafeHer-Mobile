import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { Input, PrimaryButton, Screen, Card } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';

export function ProfileScreen() {
  const { profile, survivor, refreshProfile, signOut } = useAuth();
  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '');
  const [emergencyName, setEmergencyName] = useState(survivor?.emergency_contact_name ?? '');
  const [emergencyNumber, setEmergencyNumber] = useState(survivor?.emergency_contact_number ?? '');
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const pickAvatar = async () => {
    if (!profile) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const path = `${profile.profile_id}/${Date.now()}.jpg`;
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true });
    if (uploadErr) {
      Alert.alert('Upload failed', uploadErr.message);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('user_profiles').update({ profile_picture: publicUrl.publicUrl }).eq('profile_id', profile.profile_id);
    await refreshProfile();
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    const oldValues = { first_name: profile.first_name, last_name: profile.last_name, phone_number: profile.phone_number };
    await supabase
      .from('user_profiles')
      .update({ first_name: firstName, last_name: lastName, phone_number: phoneNumber })
      .eq('profile_id', profile.profile_id);

    if (survivor) {
      await supabase
        .from('survivors')
        .update({ emergency_contact_name: emergencyName, emergency_contact_number: emergencyNumber })
        .eq('survivor_id', survivor.survivor_id);
    }

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
    Alert.alert('Saved', 'Your profile has been updated.');
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      Alert.alert('Could not update password', error.message);
      return;
    }
    setNewPassword('');
    Alert.alert('Password updated');
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out of SafeHer?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Pressable onPress={pickAvatar}>
          {profile?.profile_picture ? (
            <Image source={{ uri: profile.profile_picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{profile?.first_name?.[0] ?? '?'}</Text>
            </View>
          )}
          <Text style={styles.changePhoto}>Change photo</Text>
        </Pressable>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Personal information</Text>
        <Input label="First name" value={firstName} onChangeText={setFirstName} />
        <Input label="Last name" value={lastName} onChangeText={setLastName} />
        <Input label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" />
        {survivor && (
          <>
            <Input label="Emergency contact name" value={emergencyName} onChangeText={setEmergencyName} />
            <Input
              label="Emergency contact number"
              value={emergencyNumber}
              onChangeText={setEmergencyNumber}
              keyboardType="phone-pad"
            />
          </>
        )}
        <PrimaryButton title="Save changes" onPress={saveProfile} loading={saving} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Account security</Text>
        <Input label="New password" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
        <PrimaryButton title="Update password" variant="outline" onPress={changePassword} loading={changingPassword} />
      </Card>

      <PrimaryButton title="Log out" variant="danger" onPress={confirmLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 96, height: 96, borderRadius: radius.pill },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { ...typography.display, fontSize: 32, color: colors.primaryDark },
  changePhoto: { ...typography.caption, color: colors.primary, textAlign: 'center', marginTop: spacing.xs },
  sectionTitle: { ...typography.heading, fontSize: 17, color: colors.text, marginBottom: spacing.sm },
});

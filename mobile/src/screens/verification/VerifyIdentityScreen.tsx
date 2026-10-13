import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Screen, Card, PrimaryButton, DropdownInput, AlertMessage, PrivacyNotice } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, radius } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import { readFileAsArrayBuffer } from '../../lib/uploadFile';
import type { UserVerification } from '../../types/database.types';

const DOCUMENT_TYPES = [
  'National ID',
  'Passport',
  "Driver's License",
  "Voter's ID",
  'Postal ID',
  'PhilHealth ID',
  'Barangay Certificate',
  'Other',
].map((label) => ({ label, value: label }));

const MAX_FILE_BYTES = 8 * 1024 * 1024; // matches the identity-documents bucket's server-side file_size_limit

export function VerifyIdentityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { profile, refreshProfile } = useAuth();
  const { palette } = useTheme();

  const [loadingLatest, setLoadingLatest] = useState(true);
  const [latest, setLatest] = useState<UserVerification | null>(null);

  const [documentType, setDocumentType] = useState<string | null>(null);
  const [asset, setAsset] = useState<{ uri: string; mimeType: string; fileSize: number; fileName: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('user_verifications')
          .select('*')
          .eq('profile_id', profile.profile_id)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setLatest(data ?? null);
      } catch (e) {
        // Without this, a thrown exception left loadingLatest stuck true
        // forever — the rest of this screen (submit a new verification)
        // still works fine with no prior record known, so this fails
        // open to "no prior submission" rather than blocking the screen.
        console.error('[VerifyIdentityScreen] load latest verification:', e);
        setLatest(null);
      } finally {
        setLoadingLatest(false);
      }
    })();
  }, [profile]);

  const pickFrom = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'SafeSpace needs camera access to take a photo of your ID.'
          : 'SafeSpace needs photo library access to select your ID.'
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

    if (result.canceled || !result.assets?.[0]) return;
    const picked = result.assets[0];
    const fileSize = picked.fileSize ?? 0;
    if (fileSize > MAX_FILE_BYTES) {
      Alert.alert('File too large', 'Please choose an image under 8 MB.');
      return;
    }
    setAsset({
      uri: picked.uri,
      mimeType: picked.mimeType ?? 'image/jpeg',
      fileSize,
      fileName: picked.fileName ?? `id-${Date.now()}.jpg`,
    });
    setError(null);
  };

  const choosePhoto = () => {
    Alert.alert('Add your ID', 'Choose how you want to add your document.', [
      { text: 'Take Photo', onPress: () => pickFrom('camera') },
      { text: 'Choose from Gallery', onPress: () => pickFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onSubmit = async () => {
    if (!profile || submitting) return;
    if (!documentType) {
      setError('Please select a document type.');
      return;
    }
    if (!asset) {
      setError('Please add a photo of your ID document.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const ext = asset.fileName.includes('.') ? asset.fileName.split('.').pop() : 'jpg';
      const path = `${profile.profile_id}/${Date.now()}.${ext}`;
      const fileBuffer = await readFileAsArrayBuffer(asset.uri);
      const { error: uploadErr } = await supabase.storage
        .from('identity-documents')
        .upload(path, fileBuffer, { contentType: asset.mimeType, upsert: false });
      if (uploadErr) {
        console.error('[VerifyIdentityScreen] storage upload failed:', uploadErr.message);
        setError("We couldn't upload your document. Please try again.");
        setSubmitting(false);
        return;
      }

      const { error: insertErr } = await supabase.from('user_verifications').insert({
        profile_id: profile.profile_id,
        document_path: path,
        document_type: documentType,
      });
      if (insertErr) {
        console.error('[VerifyIdentityScreen] user_verifications insert failed:', insertErr.code, insertErr.message);
        // 23505 = the partial unique index catching a second concurrent
        // pending submission — a friendly message beats a raw DB error.
        if (insertErr.code === '23505') {
          setError('You already have a verification request under review. Please wait for it to be reviewed.');
        } else {
          setError(`We couldn't submit your verification request: ${insertErr.message}`);
        }
        setSubmitting(false);
        return;
      }

      await refreshProfile();
      setSuccess(true);
    } catch (e) {
      console.error('[VerifyIdentityScreen] unexpected error during submit:', e instanceof Error ? e.message : e);
      setError(`We couldn't submit your verification request: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Screen>
        <Card>
          <AlertMessage
            variant="success"
            title="Verification submitted"
            message="Your identity verification request has been submitted and is now awaiting review. We'll notify you once it's been reviewed."
          />
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton title="Back to Profile" onPress={() => navigation.goBack()} />
          </View>
        </Card>
      </Screen>
    );
  }

  if (!loadingLatest && latest?.status === 'pending') {
    return (
      <Screen>
        <Card>
          <AlertMessage
            variant="info"
            title="Verification under review"
            message="Your verification is currently being reviewed. You will be able to submit an incident report once your account has been verified."
          />
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton title="Back to Profile" onPress={() => navigation.goBack()} />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[styles.title, { color: palette.text }]}>Verify Your Account</Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>
        To help keep SafeSpace secure and ensure that reports are submitted by legitimate users, please provide a valid
        identification document for verification.
      </Text>

      {!loadingLatest && latest?.status === 'rejected' ? (
        <AlertMessage
          variant="error"
          title="Verification rejected"
          message={latest.rejection_reason ? `Reason: ${latest.rejection_reason}` : 'Your previous submission was not approved.'}
        />
      ) : null}

      <Card>
        <DropdownInput
          label="Document type"
          placeholder="Select a document type"
          value={documentType}
          options={DOCUMENT_TYPES}
          onSelect={setDocumentType}
        />

        {asset ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: asset.uri }} style={styles.preview} />
            <View style={styles.previewActions}>
              <PrimaryButton title="Replace" variant="outline" size="md" onPress={choosePhoto} />
              <PrimaryButton title="Remove" variant="outline" size="md" onPress={() => setAsset(null)} />
            </View>
          </View>
        ) : (
          <PrimaryButton title="Add ID Document" variant="outline" onPress={choosePhoto} />
        )}

        {error ? <AlertMessage variant="error" title="Couldn't submit" message={error} /> : null}

        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            title="Submit Verification"
            loadingTitle="Submitting..."
            onPress={onSubmit}
            loading={submitting}
          />
        </View>
      </Card>

      <PrivacyNotice
        heading="Your privacy matters"
        text="Your submitted document will only be used for account verification and will be accessible only to authorized personnel. It is never shared publicly."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, marginBottom: spacing.xs },
  body: { ...typography.body, marginBottom: spacing.md },
  previewWrap: { marginBottom: spacing.md },
  preview: { width: '100%', height: 200, borderRadius: radius.md, marginBottom: spacing.sm },
  previewActions: { flexDirection: 'row', gap: spacing.sm },
});

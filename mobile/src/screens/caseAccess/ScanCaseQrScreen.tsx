import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconContainer, PrimaryButton, Screen } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { parseCaseAccessDeepLink } from '../../lib/deepLinks';
import { AppStackParamList } from '../../navigation/types';

/**
 * In-app QR scanner (module14) — reuses the exact same
 * `safeher://case-access/<token>` parser as the OS-level deep link
 * handler (lib/deepLinks.ts), so a code scanned in-app and a code
 * scanned with the phone's native camera app are handled identically.
 * Never reads or displays anything from the code beyond the opaque
 * token; validity/authorization is entirely CaseAccessScreen's job
 * (via redeem_case_access_token), not this screen's.
 */
export function ScanCaseQrScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [invalidCode, setInvalidCode] = useState(false);
  const handledRef = useRef(false);

  const onScanned = ({ data }: { data: string }) => {
    if (handledRef.current) return;
    const token = parseCaseAccessDeepLink(data);
    if (!token) {
      setInvalidCode(true);
      return;
    }
    handledRef.current = true;
    navigation.replace('CaseAccess', { token });
  };

  if (!permission) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.md }}>
          <IconContainer icon="camera" size={72} tint={palette.primary} />
          <Text style={[typography.heading, { color: palette.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            Camera Access Needed
          </Text>
          <Text style={[typography.body, { color: palette.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
            SafeSpace needs camera access to scan a Client Case Access QR code.
          </Text>
          <View style={{ width: '100%', marginTop: spacing.xl }}>
            <PrimaryButton title="Grant Camera Access" onPress={requestPermission} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={styles.flex}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.frame, { borderColor: palette.white }]} />
      </View>
      <View style={styles.caption}>
        <Text style={[typography.body, { color: '#FFFFFF', textAlign: 'center' }]}>
          Point your camera at the Client Case Access QR code
        </Text>
        {invalidCode && (
          <Text style={[typography.caption, { color: '#FFB4B4', textAlign: 'center', marginTop: spacing.xs }]}>
            That doesn't look like a SafeSpace case access code. Please try again.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 16, backgroundColor: 'transparent' },
  caption: { position: 'absolute', bottom: 48, left: 24, right: 24 },
});

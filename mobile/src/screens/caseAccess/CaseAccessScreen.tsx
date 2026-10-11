import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { AlertMessage, IconContainer, PrimaryButton, Screen } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';

type RedeemResult =
  | { state: 'not_authenticated' | 'invalid' | 'identity_verification_required' }
  | { state: 'pending_verification'; case_number: string }
  | { state: 'rejected'; reason: string | null }
  | { state: 'authorized'; case_id: string };

/**
 * The real check-and-route screen (module14) — reached either from the
 * in-app QR scanner or from a `safeher://case-access/<token>` deep link,
 * always while authenticated (RootNavigator only routes here once a
 * session exists). Calls redeem_case_access_token exactly once per
 * mount and renders exactly one state at a time — case information is
 * never shown here; 'authorized' immediately hands off to
 * LinkedCaseDetail, which fetches the client-safe projection separately.
 *
 * Every state below is intentionally generic where the spec requires
 * it: 'invalid' never distinguishes "doesn't exist" from "expired" from
 * "revoked", and 'rejected' never reveals anything about the case
 * itself beyond the admin's own stated reason for THIS requester.
 */
export function CaseAccessScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, 'CaseAccess'>>();
  const { token } = route.params;

  const [result, setResult] = useState<RedeemResult | null>(null);
  const [checking, setChecking] = useState(true);

  const redeem = useCallback(async () => {
    setChecking(true);
    const { data, error } = await supabase.rpc('redeem_case_access_token', { p_token: token });
    if (error || !data) {
      console.error('[CaseAccessScreen] redeem_case_access_token:', error?.message);
      setResult({ state: 'invalid' });
    } else {
      setResult(data as RedeemResult);
    }
    setChecking(false);
  }, [token]);

  useEffect(() => {
    redeem();
  }, [redeem]);

  useEffect(() => {
    if (result?.state === 'authorized') {
      navigation.replace('LinkedCaseDetail', { caseId: result.case_id });
    }
  }, [result, navigation]);

  if (checking || !result || result.state === 'authorized') {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={palette.primary} size="large" />
          <Text style={[typography.body, { color: palette.textMuted, marginTop: spacing.md }]}>Checking access...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.md }}>
        {result.state === 'identity_verification_required' && (
          <>
            <IconContainer icon="shield-checkmark" size={72} tint={palette.primary} />
            <Text style={[typography.heading, { color: palette.text, marginTop: spacing.lg, textAlign: 'center' }]}>
              Identity Verification Required
            </Text>
            <Text style={[typography.body, { color: palette.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
              Before this case can be linked to your account, please complete SafeSpace's identity verification.
            </Text>
            <View style={{ width: '100%', marginTop: spacing.xl, gap: spacing.sm }}>
              <PrimaryButton title="Verify My Identity" onPress={() => navigation.navigate('VerifyIdentity')} />
              <PrimaryButton title="I've Verified — Check Again" variant="outline" onPress={redeem} />
            </View>
          </>
        )}

        {result.state === 'pending_verification' && (
          <>
            <IconContainer icon="time" size={72} tint={palette.warning} />
            <Text style={[typography.heading, { color: palette.text, marginTop: spacing.lg, textAlign: 'center' }]}>
              Verification Pending
            </Text>
            <Text style={[typography.subheading, { color: palette.primary, marginTop: spacing.sm }]}>{result.case_number}</Text>
            <Text style={[typography.body, { color: palette.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
              Your request has been sent to the issuing office. A SafeSpace administrator must verify that this account
              belongs to you before case information becomes available.
            </Text>
            <View style={{ width: '100%', marginTop: spacing.xl }}>
              <PrimaryButton title="Check Again" variant="outline" onPress={redeem} />
            </View>
          </>
        )}

        {result.state === 'rejected' && (
          <>
            <AlertMessage
              variant="error"
              title="Access Not Approved"
              message={result.reason ?? 'Your request to access this case was not approved.'}
            />
            <Text style={[typography.caption, { color: palette.textMuted, marginTop: spacing.md, textAlign: 'center' }]}>
              If you believe this is a mistake, please contact the office that issued your case access code.
            </Text>
          </>
        )}

        {(result.state === 'invalid' || result.state === 'not_authenticated') && (
          <AlertMessage
            variant="error"
            title="This case access code is no longer valid"
            message="Please contact the issuing office for assistance."
          />
        )}
      </View>
    </Screen>
  );
}

import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { usePasscode } from '../contexts/PasscodeContext';
import { AppStackParamList } from '../navigation/types';

// Single shared guard used at every "Report Incident" entry point
// (Home quick action, Home empty-case card, AI assistant's suggestion)
// so the verification requirement can never be bypassed by navigating
// in from somewhere the button-hiding logic forgot about. The real
// backstop is the database RLS policy on case_reports (module10 for
// identity verification, module33 for the security-passcode enrollment
// check added alongside it) — this is the frontend UX layer that
// explains WHY, matching both.
export function useGoToReportIncident() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { profile } = useAuth();
  const { enrolled } = usePasscode();

  return () => {
    const status = profile?.identity_verification_status ?? 'unverified';

    if (status === 'verified') {
      // Checked AFTER identity verification, matching the order the
      // governing spec's own user journey describes (verify identity is
      // pre-existing/unrelated; passcode enrollment is the newer, second
      // gate) and the order the case_reports RLS policy itself checks
      // them in. `enrolled === null` (still loading) is treated as "not
      // yet confirmed enrolled" — never lets a report-submission attempt
      // through on an unresolved check.
      if (enrolled) {
        navigation.navigate('ReportIncident');
      } else {
        navigation.navigate('CreateSecurityPasscode', { mode: 'enroll', returnTo: 'ReportIncident' });
      }
      return;
    }

    if (status === 'pending') {
      Alert.alert(
        'Verification in Progress',
        'Your verification is currently being reviewed. You will be able to submit an incident report once your account has been verified.'
      );
      return;
    }

    if (status === 'rejected') {
      Alert.alert(
        'Account Verification Required',
        'Your account verification was rejected. Please resubmit your verification before submitting an incident report.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Resubmit Verification', onPress: () => navigation.navigate('VerifyIdentity') },
        ]
      );
      return;
    }

    Alert.alert(
      'Account Verification Required',
      'Please verify your account before submitting an incident report.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Verify My Account', onPress: () => navigation.navigate('VerifyIdentity') },
      ]
    );
  };
}

import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { AppStackParamList } from '../navigation/types';

// Single shared guard used at every "Report Incident" entry point
// (Home quick action, Home empty-case card, AI assistant's suggestion)
// so the verification requirement can never be bypassed by navigating
// in from somewhere the button-hiding logic forgot about. The real
// backstop is the database RLS policy on case_reports (module10) —
// this is the frontend UX layer that explains WHY, matching it.
export function useGoToReportIncident() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { profile } = useAuth();

  return () => {
    const status = profile?.identity_verification_status ?? 'unverified';

    if (status === 'verified') {
      navigation.navigate('ReportIncident');
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

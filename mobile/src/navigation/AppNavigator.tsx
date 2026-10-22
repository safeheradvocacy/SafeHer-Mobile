import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList, AppTabParamList } from './types';
import { HomeScreen } from '../screens/home/HomeScreen';
import { CaseListScreen } from '../screens/cases/CaseListScreen';
import { SosScreen } from '../screens/sos/SosScreen';
import { SosHistoryScreen } from '../screens/sos/SosHistoryScreen';
import { SosHistoryDetailScreen } from '../screens/sos/SosHistoryDetailScreen';
import { SafeHerAssistantScreen } from '../screens/assistant/SafeHerAssistantScreen';
import { ShelterLocatorScreen } from '../screens/shelters/ShelterLocatorScreen';
import { RequestShelterScreen } from '../screens/shelters/RequestShelterScreen';
import { ShelterDetailScreen } from '../screens/shelters/ShelterDetailScreen';
import { MyShelterRequestsScreen } from '../screens/shelters/MyShelterRequestsScreen';
import { ReportIncidentScreen } from '../screens/incident/ReportIncidentScreen';
import { CaseDetailScreen } from '../screens/cases/CaseDetailScreen';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ChangePasswordScreen } from '../screens/profile/ChangePasswordScreen';
import { VerifyIdentityScreen } from '../screens/verification/VerifyIdentityScreen';
import { CaseAccessScreen } from '../screens/caseAccess/CaseAccessScreen';
import { ScanCaseQrScreen } from '../screens/caseAccess/ScanCaseQrScreen';
import { LinkedCaseDetailScreen } from '../screens/caseAccess/LinkedCaseDetailScreen';
import { TermsAndConditionsScreen } from '../screens/legal/TermsAndConditionsScreen';
import { AnnouncementsScreen } from '../screens/announcements/AnnouncementsScreen';
import { AnnouncementDetailScreen } from '../screens/announcements/AnnouncementDetailScreen';
import { CreateSecurityPasscodeScreen } from '../screens/security/CreateSecurityPasscodeScreen';
import { VerifySecurityPasscodeScreen } from '../screens/security/VerifySecurityPasscodeScreen';
import { SplashScreen } from '../screens/auth/SplashOnboardingWelcome';
import { ClayTabBar } from './ClayTabBar';
import { useTheme } from '../contexts/ThemeContext';
import { usePasscode } from '../contexts/PasscodeContext';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

function Tabs() {
  const { palette } = useTheme();
  return (
    <Tab.Navigator
      tabBar={(props) => <ClayTabBar {...props} />}
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: palette.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: palette.text },
        headerRight: () => (
          <Pressable onPress={() => navigation.getParent()?.navigate('Profile')} style={{ marginRight: 16 }}>
            <Text style={{ color: palette.primary }}>Profile</Text>
          </Pressable>
        ),
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home', headerShown: false }} />
      <Tab.Screen name="CasesTab" component={CaseListScreen} options={{ title: 'My Cases', headerShown: false }} />
      <Tab.Screen name="SosTab" component={SosScreen} options={{ title: 'SOS', headerShown: false }} />
      <Tab.Screen name="ChatTab" component={SafeHerAssistantScreen} options={{ title: 'Assistant', headerShown: false }} />
      <Tab.Screen name="SheltersTab" component={ShelterLocatorScreen} options={{ title: 'Shelters', headerShown: false }} />
    </Tab.Navigator>
  );
}

// Shown instead of an indefinite splash when the enrollment check has
// genuinely failed (not just "still in flight") — this is specifically
// the failure mode flagged in the diagnosis spec: an enrollment-check
// error must never look like a permanent lockout or hang forever with no
// way out. Deliberately offers only "Try Again" (re-runs the real server
// check) — never a way to proceed past it, since that would be exactly
// the "do not mark passcode setup complete if the server cannot confirm
// enrollment" failure this exists to prevent.
function EnrollmentCheckFailed() {
  const { palette } = useTheme();
  const { enrollmentCheckError, refreshEnrollmentStatus, checkingEnrollment } = usePasscode();
  return (
    <View style={[enrollStyles.wrap, { backgroundColor: palette.background }]}>
      <Ionicons name="cloud-offline-outline" size={40} color={palette.textMuted} />
      <Text style={[enrollStyles.title, { color: palette.text }]}>Couldn't confirm your account setup</Text>
      <Text style={[enrollStyles.body, { color: palette.textMuted }]}>{enrollmentCheckError}</Text>
      <Pressable
        onPress={() => refreshEnrollmentStatus()}
        disabled={checkingEnrollment}
        style={[enrollStyles.retryBtn, { backgroundColor: palette.primary, opacity: checkingEnrollment ? 0.6 : 1 }]}
        accessibilityRole="button"
      >
        <Text style={enrollStyles.retryBtnText}>{checkingEnrollment ? 'Checking...' : 'Try Again'}</Text>
      </Pressable>
    </View>
  );
}

const enrollStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { fontSize: 17, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  body: { fontSize: 14, marginTop: 6, textAlign: 'center' },
  retryBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10 },
  retryBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});

export function AppNavigator() {
  const { palette } = useTheme();
  const { enrolled, enrollmentCheckError } = usePasscode();

  // Mirrors AuthNavigator's own "don't mount the Stack.Navigator until we
  // know the real initial route" pattern (there: hasCompletedOnboarding();
  // here: passcode enrollment) -- initialRouteName is read once at mount,
  // so this must be settled BEFORE the Stack.Navigator below ever renders,
  // not swapped in afterward. `enrolled === null` means the check hasn't
  // resolved yet (see PasscodeContext) -- never defaults to the
  // unenrolled-skipping "Tabs" route in that window, since a transient
  // backend hiccup must never look like "enrollment confirmed."
  //
  // enrollmentCheckError distinguishes "still checking" (plain splash,
  // expected to resolve in under a second normally) from "checked and it
  // genuinely failed" (a real retry screen, not an indefinite spinner —
  // this is the fix for the diagnosis spec's named "endless loading
  // state" failure mode).
  if (enrolled === null) {
    return enrollmentCheckError ? <EnrollmentCheckFailed /> : <SplashScreen />;
  }

  return (
    <Stack.Navigator
      initialRouteName={enrolled ? 'Tabs' : 'CreateSecurityPasscode'}
      screenOptions={{ headerStyle: { backgroundColor: palette.background }, headerShadowVisible: false, headerTitleStyle: { color: palette.text } }}
    >
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="ReportIncident" component={ReportIncidentScreen} options={{ title: 'Report Incident' }} />
      <Stack.Screen name="SosHistory" component={SosHistoryScreen} options={{ title: 'SOS History' }} />
      <Stack.Screen name="SosHistoryDetail" component={SosHistoryDetailScreen} options={{ title: 'Alert Details' }} />
      <Stack.Screen name="RequestShelter" component={RequestShelterScreen} options={{ title: 'Request Shelter' }} />
      <Stack.Screen name="ShelterDetail" component={ShelterDetailScreen} options={{ title: 'Shelter Details' }} />
      <Stack.Screen name="MyShelterRequests" component={MyShelterRequestsScreen} options={{ title: 'My Shelter Requests' }} />
      <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: 'Case Details' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile & Account' }} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change Password' }} />
      <Stack.Screen name="VerifyIdentity" component={VerifyIdentityScreen} options={{ title: 'Verify Your Account' }} />
      <Stack.Screen name="CaseAccess" component={CaseAccessScreen} options={{ title: 'Case Access' }} />
      <Stack.Screen name="ScanCaseQr" component={ScanCaseQrScreen} options={{ title: 'Scan Case Access QR', headerTintColor: '#fff' }} />
      <Stack.Screen name="LinkedCaseDetail" component={LinkedCaseDetailScreen} options={{ title: 'My Case' }} />
      <Stack.Screen name="Terms" component={TermsAndConditionsScreen} options={{ title: 'Terms and Conditions' }} />
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: 'Announcements' }} />
      <Stack.Screen name="AnnouncementDetail" component={AnnouncementDetailScreen} options={{ title: 'Announcement' }} />
      <Stack.Screen
        name="CreateSecurityPasscode"
        component={CreateSecurityPasscodeScreen}
        options={{ title: 'Security Passcode', gestureEnabled: false }}
      />
      <Stack.Screen
        name="VerifySecurityPasscode"
        component={VerifySecurityPasscodeScreen}
        options={{ title: 'Verify Passcode', headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}

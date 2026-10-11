import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';
import { AppStackParamList, AppTabParamList } from './types';
import { HomeScreen } from '../screens/home/HomeScreen';
import { CaseListScreen } from '../screens/cases/CaseListScreen';
import { SosScreen } from '../screens/sos/SosScreen';
import { SafeHerAssistantScreen } from '../screens/assistant/SafeHerAssistantScreen';
import { ShelterLocatorScreen } from '../screens/shelters/ShelterLocatorScreen';
import { RequestShelterScreen } from '../screens/shelters/RequestShelterScreen';
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
import { ClayTabBar } from './ClayTabBar';
import { useTheme } from '../contexts/ThemeContext';

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

export function AppNavigator() {
  const { palette } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: palette.background }, headerShadowVisible: false, headerTitleStyle: { color: palette.text } }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="ReportIncident" component={ReportIncidentScreen} options={{ title: 'Report Incident' }} />
      <Stack.Screen name="RequestShelter" component={RequestShelterScreen} options={{ title: 'Request Shelter' }} />
      <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: 'Case Details' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile & Account' }} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change Password' }} />
      <Stack.Screen name="VerifyIdentity" component={VerifyIdentityScreen} options={{ title: 'Verify Your Account' }} />
      <Stack.Screen name="CaseAccess" component={CaseAccessScreen} options={{ title: 'Case Access' }} />
      <Stack.Screen name="ScanCaseQr" component={ScanCaseQrScreen} options={{ title: 'Scan Case Access QR', headerTintColor: '#fff' }} />
      <Stack.Screen name="LinkedCaseDetail" component={LinkedCaseDetailScreen} options={{ title: 'My Case' }} />
      <Stack.Screen name="Terms" component={TermsAndConditionsScreen} options={{ title: 'Terms and Conditions' }} />
    </Stack.Navigator>
  );
}

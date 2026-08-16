import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';
import { AppStackParamList, AppTabParamList } from './types';
import { HomeScreen } from '../screens/home/HomeScreen';
import { CaseListScreen } from '../screens/cases/CaseListScreen';
import { SosScreen } from '../screens/sos/SosScreen';
import { ChatbotScreen } from '../screens/chatbot/ChatbotScreen';
import { ShelterLocatorScreen } from '../screens/shelters/ShelterLocatorScreen';
import { ReportIncidentScreen } from '../screens/incident/ReportIncidentScreen';
import { CaseDetailScreen } from '../screens/cases/CaseDetailScreen';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { colors } from '../theme/theme';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerRight: () => (
          <Pressable onPress={() => navigation.getParent()?.navigate('Profile')} style={{ marginRight: 16 }}>
            <Text style={{ color: colors.primary }}>Profile</Text>
          </Pressable>
        ),
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="CasesTab" component={CaseListScreen} options={{ title: 'My Cases' }} />
      <Tab.Screen name="SosTab" component={SosScreen} options={{ title: 'SOS' }} />
      <Tab.Screen name="ChatTab" component={ChatbotScreen} options={{ title: 'Assistant' }} />
      <Tab.Screen name="SheltersTab" component={ShelterLocatorScreen} options={{ title: 'Shelters' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="ReportIncident" component={ReportIncidentScreen} options={{ title: 'Report Incident' }} />
      <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: 'Case Details' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile & Account' }} />
    </Stack.Navigator>
  );
}

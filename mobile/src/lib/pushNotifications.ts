// Push notification registration for the hybrid notification architecture:
// database-backed `notifications` rows remain the authoritative record
// (see NotificationsScreen); this module only handles obtaining an Expo
// push token and associating it with the signed-in profile so the
// server-side dispatch trigger (module8_notifications_push.sql) has
// somewhere to deliver a best-effort alert for high-priority events.
//
// ENVIRONMENT NOTE — Expo SDK 57: remote push notifications are
// unavailable in Expo Go (a development build is required), and
// getExpoPushTokenAsync() requires this project to be linked to an EAS
// project (`extra.eas.projectId` in app.json, normally set by running
// `eas init`). Neither has been configured yet.
//
// Critically, `expo-notifications` throws synchronously on Android as
// soon as it is IMPORTED while running inside Expo Go (its
// DevicePushTokenAutoRegistration side-effect module calls
// addPushTokenListener at module-eval time, which calls
// warnOfExpoGoPushUsage(), which throws on Android) — this happens
// before any of our own code runs, so a plain top-level `import` here
// crashes the app on launch. `expo-notifications` is therefore only
// ever `require()`'d lazily, and only when NOT running in Expo Go, so
// the module is never evaluated in the environment that crashes.
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type NotificationsModule from 'expo-notifications';

const LAST_TOKEN_KEY = 'safeher_last_push_token';

export const PUSH_UNAVAILABLE_IN_EXPO_GO = isRunningInExpoGo();

function getNotifications(): typeof NotificationsModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-notifications');
}

// Controls how a notification that arrives while the app is in the
// foreground is presented. Local notifications and this handler exist
// independently of whether remote push is actually reachable. Skipped
// entirely in Expo Go — see note above.
if (!PUSH_UNAVAILABLE_IN_EXPO_GO) {
  getNotifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'unavailable'; reason: 'expo-go' | 'permission-denied' | 'no-eas-project' | 'storage-failed' | 'exception' };

export async function registerForPushNotificationsAsync(profileId: string): Promise<PushRegistrationResult> {
  if (PUSH_UNAVAILABLE_IN_EXPO_GO) {
    console.warn('[pushNotifications] remote push is unavailable in Expo Go — use a development build to test push.');
    return { status: 'unavailable', reason: 'expo-go' };
  }
  try {
    const Notifications = getNotifications();
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return { status: 'unavailable', reason: 'permission-denied' };
    }

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) {
      console.warn('[pushNotifications] no EAS projectId configured — run `eas init` to enable remote push.');
      return { status: 'unavailable', reason: 'no-eas-project' };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase.from('push_tokens').upsert(
      {
        profile_id: profileId,
        expo_push_token: token,
        platform: Platform.OS,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,expo_push_token' }
    );
    if (error) {
      console.warn('[pushNotifications] failed to store token:', error.message);
      return { status: 'unavailable', reason: 'storage-failed' };
    }

    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
    return { status: 'registered', token };
  } catch (e) {
    console.warn('[pushNotifications] registration failed:', e instanceof Error ? e.message : e);
    return { status: 'unavailable', reason: 'exception' };
  }
}

// Removes only THIS device's registration. A user signed in on a second
// device keeps receiving push after this one logs out — deliberately
// per-device, never a blanket "delete all my tokens" on sign-out.
export async function deactivatePushTokenForThisDevice(profileId: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (!token) return;
    await supabase.from('push_tokens').delete().eq('profile_id', profileId).eq('expo_push_token', token);
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  } catch (e) {
    console.warn('[pushNotifications] deregistration failed:', e instanceof Error ? e.message : e);
  }
}

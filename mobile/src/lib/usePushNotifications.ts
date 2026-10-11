import { useEffect } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import type NotificationsModule from 'expo-notifications';
import type { AppStackParamList } from '../navigation/types';
import { PUSH_UNAVAILABLE_IN_EXPO_GO, registerForPushNotificationsAsync } from './pushNotifications';

type RootNavRef = NavigationContainerRef<AppStackParamList>;

// Lazy require — see pushNotifications.ts for why `expo-notifications`
// must never be statically imported (it crashes on Android in Expo Go
// merely by being evaluated).
function getNotifications(): typeof NotificationsModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-notifications');
}

// Tap-to-navigate mapping. Only ever routes to screens that already
// exist in AppNavigator — no new screens are introduced by this file.
// Falls back to the Notifications screen (always safe, always shows
// the full authoritative record) for any type without a more specific
// destination, rather than guessing at a route.
function navigateForNotificationData(navRef: RootNavRef, data: Record<string, unknown> | undefined) {
  if (!navRef.isReady()) return;
  const type = data?.notification_type as string | undefined;
  const caseId = data?.case_id as string | undefined;

  if ((type === 'Case Update' || type === 'Referral') && caseId) {
    navRef.navigate('CaseDetail', { caseId });
  } else {
    navRef.navigate('Notifications');
  }
}

// Mounted once, near the app root (RootNavigator), only while a
// profile is signed in. Handles:
//  - registering this device's push token for the signed-in profile
//  - foreground receipt (no extra action needed beyond the handler set
//    in pushNotifications.ts — this hook only logs it)
//  - the app being opened by tapping a notification, whether it was
//    backgrounded (addNotificationResponseReceivedListener) or fully
//    cold-started from a terminated state (getLastNotificationResponseAsync)
export function usePushNotifications(profileId: string | undefined, navRef: React.RefObject<RootNavRef | null>) {
  useEffect(() => {
    if (!profileId) return;
    registerForPushNotificationsAsync(profileId);
  }, [profileId]);

  useEffect(() => {
    if (PUSH_UNAVAILABLE_IN_EXPO_GO) return;
    const Notifications = getNotifications();

    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Presentation while foregrounded is handled by the handler
      // configured in pushNotifications.ts; the in-app notifications
      // list/badge (NotificationsScreen, its own Realtime subscription)
      // is the authoritative UI for content, so nothing else to do here.
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (navRef.current) navigateForNotificationData(navRef.current, data);
    });

    // Cold-start case: the app was fully closed and launched by tapping
    // a notification — there is no "response received" event for that,
    // this is the documented way to retrieve it after launch.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      // navRef may not be ready yet on the very first tick after cold
      // start; isReady() inside navigateForNotificationData guards that,
      // and a short delay gives NavigationContainer time to mount.
      setTimeout(() => {
        if (navRef.current) navigateForNotificationData(navRef.current, data);
      }, 300);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [navRef]);
}

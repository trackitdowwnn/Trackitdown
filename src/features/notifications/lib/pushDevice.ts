/**
 * WHAT:  Device-side push adapter — creates the Android notification channel
 *        and mints this device's Expo push token.
 * WHY:   Isolates every expo-notifications call the registration path makes,
 *        so the hook is unit-testable and a missing/misconfigured native
 *        module degrades to null instead of throwing. That degradation is the
 *        whole point here: until FCM credentials exist,
 *        `getExpoPushTokenAsync` REJECTS on Android, and an unhandled
 *        rejection at app launch would be a crash on the most ordinary path
 *        there is — opening the app.
 *        Lazy literal require, same rationale as feedDeviceLocation.
 * LINKS: src/features/notifications/hooks/usePushRegistration.ts (caller);
 *        app.json (extra.eas.projectId — required to mint a token);
 *        supabase/functions/_shared/push.ts (sends to ALERTS_CHANNEL_ID);
 *        https://docs.expo.dev/versions/v57.0.0/sdk/notifications/.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The Android channel every notification we send targets. Android REQUIRES a
 * channel to exist before a notification can be displayed; without it the push
 * arrives and is silently dropped. Must match `channelId` in the Edge
 * Functions and `defaultChannel` in app.config.ts's expo-notifications plugin.
 */
export const ALERTS_CHANNEL_ID = 'alerts';

export type PushPlatform = 'ios' | 'android';

/** Injected into usePushRegistration so the hook is unit-testable. */
export interface PushDevice {
  /** Create/update the Android channel. No-op elsewhere. Never throws. */
  ensureChannel(): Promise<void>;
  /** This device's Expo push token, or null when it can't be minted. */
  getExpoPushToken(): Promise<string | null>;
}

interface ExpoNotificationsModule {
  setNotificationChannelAsync(
    channelId: string,
    channel: Record<string, unknown>,
  ): Promise<unknown>;
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<{ data: string }>;
  AndroidImportance: { HIGH: number };
}

function loadExpoNotifications(): ExpoNotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

/** The EAS project the token is minted against. Without it the call throws. */
export function pushProjectId(): string | null {
  const eas = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
  return eas?.projectId ?? null;
}

/** The platform string the push_tokens CHECK constraint accepts, or null on web. */
export function pushPlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

export const expoPushDevice: PushDevice = {
  async ensureChannel() {
    if (Platform.OS !== 'android') return;
    const notifications = loadExpoNotifications();
    if (!notifications) return;
    try {
      await notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
        name: 'Stolen car alerts',
        importance: notifications.AndroidImportance.HIGH,
        // NO `sound` key. On a CHANNEL this field is a custom sound FILENAME
        // bundled via the expo-notifications plugin — passing 'default' names
        // a file that doesn't exist, which logs
        //   "Custom sound 'default' not found in native app"
        // and risks a silent channel. Omitting it gives the system default,
        // which is what we want. (The Expo push MESSAGE payload is different:
        // `sound: 'default'` IS correct there, and _shared/push.ts sends it.)
        enableVibrate: true,
      });
    } catch {
      // A missing channel means Android drops the notification silently.
      // Nothing we can do here; the token registration still proceeds so the
      // server side is correct once the channel can be created.
    }
  },

  async getExpoPushToken() {
    const notifications = loadExpoNotifications();
    if (!notifications) return null;
    const projectId = pushProjectId();
    if (!projectId) return null;
    try {
      const { data } = await notifications.getExpoPushTokenAsync({ projectId });
      return data || null;
    } catch {
      // Expected until FCM (Android) / APNs (iOS) credentials are configured,
      // and on simulators. Not an error worth surfacing to the user — they
      // never asked for a token, and everything else in the app still works.
      return null;
    }
  },
};

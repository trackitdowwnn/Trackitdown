/**
 * WHAT:  Keeps this device's Expo push token registered against the signed-in
 *        user — once per cold start, and again whenever the user changes.
 * WHY:   A token is per DEVICE and can be re-issued by the OS, so it has to be
 *        refreshed on launch rather than captured once at sign-up. Guests are
 *        skipped entirely (a token needs a user_id), and the permission is
 *        only ever READ here — prompting belongs to the startup gate and the
 *        alert-settings primer, so opening the app never fires a dialog
 *        because of this hook.
 *        Nothing here throws: a device with no push credentials yet (the
 *        normal state before FCM is configured) must launch exactly as before.
 * LINKS: ../lib/pushDevice.ts (channel + token), ../api/pushTokenApi.ts;
 *        src/features/notifications/components/NotificationsHost.tsx (caller);
 *        src/features/permissions (checkDevicePermission — silent).
 */

import { useEffect } from 'react';

import { useSession } from '@/features/auth';
import { checkDevicePermission } from '@/features/permissions';
import { createLogger } from '@/shared/lib/logger';

import { registerPushToken } from '../api/pushTokenApi';
import { expoPushDevice, pushPlatform, type PushDevice } from '../lib/pushDevice';
import { isPushTokenRegistered, rememberPushToken } from '../lib/pushTokenCache';

const log = createLogger('notifications');

/**
 * @param enabled gate from the host (false until the app has settled), so
 *   registration never competes with first paint.
 */
export function usePushRegistration(enabled: boolean, device: PushDevice = expoPushDevice): void {
  const { userId } = useSession();

  useEffect(() => {
    if (!enabled || !userId) return;

    let cancelled = false;
    void (async () => {
      const platform = pushPlatform();
      if (!platform) return; // web — no push target

      const permission = await checkDevicePermission('notifications');
      if (permission.state !== 'granted') {
        // Not an error: the user either hasn't been asked yet or said no.
        // Their alert zone still saves; it simply won't fire until they turn
        // notifications on, which the settings screen states plainly.
        log.debug('push_token_skipped', { reason: 'permission', state: permission.state });
        return;
      }
      if (cancelled) return;

      // BEFORE the token: Android silently drops a notification whose channel
      // does not exist, and the channel is cheap and idempotent.
      await device.ensureChannel();
      if (cancelled) return;

      const token = await device.getExpoPushToken();
      if (!token) {
        // Expected until FCM/APNs credentials are configured, and on simulators.
        log.warn('push_token_unavailable', { platform, reason: 'no_token' });
        return;
      }

      if (isPushTokenRegistered(userId, token)) return; // already sent this session
      if (cancelled) return;

      try {
        await registerPushToken(token, platform);
        rememberPushToken(userId, token);
        // SAFETY: never the token itself.
        log.info('push_token_registered', { platform, changed: true });
      } catch {
        // Already warned in the api layer. A failed registration means no
        // pushes until the next launch — not worth interrupting anyone over.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, userId, device]);
}

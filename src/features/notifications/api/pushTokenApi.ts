/**
 * WHAT:  The two writes that keep this device's push token current —
 *        register (upsert) on launch, unregister on sign-out.
 * WHY:   Both go through SECURITY DEFINER RPCs rather than a table write:
 *        `push_tokens` has no client insert/update grant, so `user_id` is
 *        pinned to auth.uid() server-side and a caller can never register a
 *        token on someone else's behalf.
 *        // SAFETY: a push token is a device credential. It is never logged —
 *        events carry the platform and whether anything changed, nothing more.
 * LINKS: supabase/migrations/20260802100000_push_infrastructure.sql
 *        (register_push_token / unregister_push_token);
 *        src/features/notifications/hooks/usePushRegistration.ts (caller);
 *        docs/LOGGING.md.
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { PushPlatform } from '../lib/pushDevice';
import { clearPushTokenCache, getCurrentPushToken } from '../lib/pushTokenCache';

const log = createLogger('notifications');

/**
 * Upsert this device's token against the signed-in user. The RPC moves the
 * token to the caller when a different account previously held it — the same
 * handset changing hands must not keep delivering the old user's notifications.
 */
export async function registerPushToken(token: string, platform: PushPlatform): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) {
    log.warn('push_token_register_failed', { platform, code: error.code });
    throw new Error(error.message);
  }
}

/**
 * Drop this device's token on sign-out. Deliberately silent about whether the
 * row existed — a no-op and a delete are indistinguishable to the caller.
 */
export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
  if (error) {
    log.warn('push_token_unregister_failed', { code: error.code });
    throw new Error(error.message);
  }
}

/**
 * Release this device before signing out.
 *
 * MUST be called while the session is still live — the RPC pins the delete to
 * auth.uid(), so after signOut() there is no way to say "this token was mine".
 * Never throws and never blocks sign-out: the worst case is a stale row that
 * the next person to sign in on this handset takes over anyway (push_tokens is
 * keyed on the token, so registering MOVES it).
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  const token = getCurrentPushToken();
  if (!token) return; // nothing registered this session
  try {
    await unregisterPushToken(token);
  } catch {
    // Already warned above.
  } finally {
    clearPushTokenCache();
  }
}

/**
 * Drop the signed-in user's push token on EVERY device ("Log out of all
 * devices", forget_my_push_tokens, 20261023130000) — the lost-phone case.
 * Same contract as unregisterCurrentPushToken: call while the session is live;
 * never throws.
 *
 * ⚠️ Clears this device's cache too, even on failure. Without that, signing
 * straight back in as the same user would find "already registered" in the
 * cache and skip registering — leaving this phone with no token row and no
 * pushes until the app restarted (code review of #261).
 */
export async function forgetAllPushTokens(): Promise<void> {
  try {
    const { error } = await supabase.rpc('forget_my_push_tokens');
    if (error) {
      // Not fatal — the other phones still lose their session — but they may
      // keep getting pushes until someone signs in there.
      log.warn('push_token_forget_all_failed', { code: error.code });
    }
  } catch {
    log.warn('push_token_forget_all_failed', { code: 'THREW' });
  } finally {
    clearPushTokenCache();
  }
}

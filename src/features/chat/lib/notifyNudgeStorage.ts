/**
 * WHAT:  The once-only flag behind the chat thread's "Turn on notifications to
 *        hear back" row — set when the user dismisses it.
 * WHY:   The first-login welcome (2026-10-27) asks about notifications later,
 *        and only of people the OS will never prompt again (blocked): the
 *        startup requests already re-ask everyone else on every cold start.
 *        A refusal must stick. Same shape as garageNudgeStorage: the version
 *        lives in the key, and an unreadable store reads as "dismissed".
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx (the row);
 *        src/features/permissions/hooks/useStartupPermissionRequests.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const NOTIFY_NUDGE_VERSION = 1;

export const NOTIFY_NUDGE_STORAGE_KEY = `trackitdown.notify_nudge_dismissed_v${NOTIFY_NUDGE_VERSION}`;

export async function hasDismissedNotifyNudge(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NOTIFY_NUDGE_STORAGE_KEY)) === 'true';
  } catch {
    return true;
  }
}

/** Never throws: failing to persist costs at most the row coming back once. */
export async function markNotifyNudgeDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFY_NUDGE_STORAGE_KEY, 'true');
  } catch {
    // Silent by design — nothing the user could do about it.
  }
}

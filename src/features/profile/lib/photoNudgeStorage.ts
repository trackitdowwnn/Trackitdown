/**
 * WHAT:  The once-only flag behind Profile's "Add a photo" row — set when the
 *        user dismisses it, so it never comes back on this install.
 * WHY:   The first-login welcome (2026-10-27) asks for a photo LATER, never at
 *        sign-in: a face next to a spotter's activity is a privacy cost, so the
 *        offer is a quiet, refusable row. A refusal must stick.
 *        Same shape as garageNudgeStorage / alertNudgeStorage: the version lives
 *        in the key, and an unreadable store reads as "dismissed" so a broken
 *        read stays quiet rather than nagging.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (the row);
 *        src/features/garage/lib/garageNudgeStorage.ts (the pattern).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PHOTO_NUDGE_VERSION = 1;

export const PHOTO_NUDGE_STORAGE_KEY = `trackitdown.photo_nudge_dismissed_v${PHOTO_NUDGE_VERSION}`;

export async function hasDismissedPhotoNudge(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PHOTO_NUDGE_STORAGE_KEY)) === 'true';
  } catch {
    return true;
  }
}

/** Never throws: failing to persist costs at most the row coming back once. */
export async function markPhotoNudgeDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(PHOTO_NUDGE_STORAGE_KEY, 'true');
  } catch {
    // Silent by design — nothing the user could do about it.
  }
}

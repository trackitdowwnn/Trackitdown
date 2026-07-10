/**
 * WHAT:  The onboarding "seen" flag — a versioned AsyncStorage key with
 *        read/mark helpers.
 * WHY:   The intro shows exactly once per onboarding VERSION: the version
 *        lives in the key itself, so bumping ONBOARDING_VERSION re-shows the
 *        flow to everyone after a redesign without any migration. Storage
 *        failures never trap the user: a failed read shows the (skippable)
 *        intro again, a failed write means at worst one repeat next launch.
 * LINKS: src/features/auth/hooks/useOnboardingGate.ts (consumer);
 *        src/app/index.tsx (the gate); docs/ARCHITECTURE.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump to re-show the intro to every user (e.g. after a slide redesign). */
export const ONBOARDING_VERSION = 1;

/** Versioned key: older versions' flags simply stop matching. */
export const ONBOARDING_STORAGE_KEY = `trackitdown.onboarding_seen_v${ONBOARDING_VERSION}`;

/** Has THIS version of the intro been seen (completed or skipped)? */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)) === 'true';
  } catch {
    return false; // unreadable storage → show the intro; it has Skip
  }
}

/** Record the intro as seen. Both Skip and Get started call this. */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // Worst case: the intro shows once more next launch. Never block exit.
  }
}

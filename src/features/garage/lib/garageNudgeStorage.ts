/**
 * WHAT:  The "we have already offered the garage" flag — one versioned
 *        AsyncStorage boolean shared by BOTH pushy nudges (the exit sheet and
 *        the Explore card).
 * WHY:   ONE flag, deliberately. The sheet and the card are the same offer in
 *        the user's head, so two independent flags would let us ask someone to
 *        save a car twice after they had already said no — which is the
 *        definition of nagging. The flag means "we asked", NOT "they declined":
 *        the sheet marks it the moment it appears, whatever the user then taps.
 *        The permanent Profile hint deliberately does NOT read this — it is the
 *        quiet safety net that lets these two be so conservative.
 *
 *        FAIL-SOFT, INVERTED. Note this reads the opposite way to
 *        onboardingStorage, which it is otherwise copied from: an unreadable
 *        flag here returns TRUE (suppress). Onboarding is essential and
 *        skippable, so failing open is right there. A nudge failing open would
 *        re-nag someone who already declined; failing closed costs one lost
 *        nudge on a rare storage error. That is the better trade, and it is
 *        exactly the detail someone copying the template would get backwards.
 * LINKS: src/features/auth/lib/onboardingStorage.ts (the template);
 *        src/features/garage/components/SaveYourCarSheet.tsx,
 *        src/features/garage/hooks/useGarageNudgeCard.ts (the two readers).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump to re-offer the garage to everyone (e.g. after a big change to it).
 *  The version lives IN the key, so a bump invalidates old flags with no
 *  migration. */
export const GARAGE_NUDGE_VERSION = 1;

export const GARAGE_NUDGE_STORAGE_KEY = `trackitdown.garage_nudge_offered_v${GARAGE_NUDGE_VERSION}`;

/** Whether we have already offered to save a car. Unreadable storage → true, so
 *  a broken read stays QUIET rather than re-nagging (see the header). */
export async function hasOfferedGarageNudge(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(GARAGE_NUDGE_STORAGE_KEY)) === 'true';
  } catch {
    // Suppress on error — see the fail-soft note in the header.
    return true;
  }
}

/** Record that the offer has been made. Never throws: failing to persist costs
 *  at most one extra nudge, which is not worth surfacing to the user. */
export async function markGarageNudgeOffered(): Promise<void> {
  try {
    await AsyncStorage.setItem(GARAGE_NUDGE_STORAGE_KEY, 'true');
  } catch {
    // Silent by design — nothing the user could do about it.
  }
}

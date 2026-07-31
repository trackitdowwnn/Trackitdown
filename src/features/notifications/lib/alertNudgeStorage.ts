/**
 * WHAT:  The "we have already offered alerts" flag — one versioned
 *        AsyncStorage boolean behind the Explore nudge card.
 * WHY:   The flag means "we asked", NOT "they declined", so accepting and
 *        dismissing both set it: someone who has been to the settings screen
 *        does not need inviting there again.
 *
 *        FAIL-SOFT, INVERTED — copied deliberately from garageNudgeStorage,
 *        and this is the detail a copy-paste gets backwards. An unreadable
 *        flag returns TRUE (suppress). Failing open would re-nag someone who
 *        already declined; failing closed costs one lost nudge on a rare
 *        storage error. That is the better trade for a nudge, and the exact
 *        opposite of onboardingStorage, where failing open is right because
 *        onboarding is essential and skippable.
 * LINKS: src/features/garage/lib/garageNudgeStorage.ts (the template);
 *        ../hooks/useAlertNudgeCard.ts (the only reader).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump to re-offer alerts to everyone. The version lives IN the key, so a
 *  bump invalidates old flags with no migration. */
export const ALERT_NUDGE_VERSION = 1;

export const ALERT_NUDGE_STORAGE_KEY = `trackitdown.alert_nudge_offered_v${ALERT_NUDGE_VERSION}`;

/** Whether we have already offered alerts. Unreadable storage → true, so a
 *  broken read stays QUIET rather than re-nagging (see the header). */
export async function hasOfferedAlertNudge(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ALERT_NUDGE_STORAGE_KEY)) === 'true';
  } catch {
    // Suppress on error — see the inverted fail-soft note in the header.
    return true;
  }
}

/** Record that the offer has been made. Never throws: failing to persist costs
 *  at most one extra nudge, which is not worth surfacing to the user. */
export async function markAlertNudgeOffered(): Promise<void> {
  try {
    await AsyncStorage.setItem(ALERT_NUDGE_STORAGE_KEY, 'true');
  } catch {
    // Silent by design — nothing the user could do about it.
  }
}

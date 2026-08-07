/**
 * WHAT:  The "we have already offered alerts" flag, plus the post-view counter
 *        that decides WHEN to offer — two versioned AsyncStorage values behind
 *        the alert-area sheet.
 * WHY:   The flag means "we asked", NOT "they declined", so accepting and
 *        dismissing both set it: someone who has been to the settings screen
 *        does not need inviting there again.
 *
 *        The COUNT persists while the intent that fires the sheet does not.
 *        That split is deliberate: three listings opened across three sessions
 *        is the same signal of interest as three in one, but the sheet must
 *        still only ever appear moments after a post-detail exit — never out of
 *        nowhere on a later launch (exitNudgeIntent.ts:11-13).
 *
 *        FAIL-SOFT, INVERTED — copied deliberately from garageNudgeStorage,
 *        and this is the detail a copy-paste gets backwards. An unreadable
 *        flag returns TRUE (suppress). Failing open would re-nag someone who
 *        already declined; failing closed costs one lost nudge on a rare
 *        storage error. That is the better trade for a nudge, and the exact
 *        opposite of onboardingStorage, where failing open is right because
 *        onboarding is essential and skippable.
 * LINKS: src/features/garage/lib/garageNudgeStorage.ts (the template);
 *        ../hooks/useCountPostViewForAlertNudge.ts (bumps the counter);
 *        ../components/AlertNudgeSheet.tsx (reads and sets the flag).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump to re-offer alerts to everyone. The version lives IN the key, so a
 *  bump invalidates old flags with no migration. */
export const ALERT_NUDGE_VERSION = 1;

export const ALERT_NUDGE_STORAGE_KEY = `trackitdown.alert_nudge_offered_v${ALERT_NUDGE_VERSION}`;

export const ALERT_NUDGE_POST_VIEWS_KEY = `trackitdown.alert_nudge_post_views_v${ALERT_NUDGE_VERSION}`;

/** Listings opened before the offer is made. Three is enough to read as "this
 *  person is watching cars near them" without being so eager it reads as a
 *  reflex — and it is spent on EXIT of the third, never on entry. */
export const ALERT_NUDGE_VIEW_THRESHOLD = 3;

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

/**
 * Count one finished post view and return the new total.
 *
 * Fails CLOSED like the flag above: an unreadable or unwritable counter returns
 * 0, which is below the threshold, so a storage fault costs a nudge rather than
 * firing one at the wrong moment. Returning a large number on error would open
 * the sheet on a user who had opened one listing.
 */
export async function bumpAlertNudgePostViews(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_NUDGE_POST_VIEWS_KEY);
    // A corrupt value counts as no history rather than poisoning the total.
    const parsed = Number.parseInt(raw ?? '', 10);
    const next = (Number.isFinite(parsed) && parsed > 0 ? parsed : 0) + 1;
    await AsyncStorage.setItem(ALERT_NUDGE_POST_VIEWS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

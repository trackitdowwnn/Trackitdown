/**
 * WHAT:  The "we've already shown this payout's paid moment" flag — the last
 *        celebrated payout key (payoutView's `celebrateKey`), in AsyncStorage.
 * WHY:   2026-10-14 (payout experience redesign, PR5). The paid moment is
 *        the reward reaching their bank, said once. The second visit gets
 *        the folded one-line road instead. ONE key, not a set: only the
 *        latest payout can be on screen, so remembering the last one is
 *        enough, and storage never grows.
 *
 *        FAIL-SOFT TOWARDS QUIET, like garageNudgeStorage. An unreadable flag
 *        reads as "seen". A celebration repeated on every visit is noise;
 *        a celebration missed on a rare storage error costs one moment, and
 *        the screen still says "Paid".
 * LINKS: ./payoutView.ts (celebrateKey); ../screens/PayoutsScreen.tsx;
 *        src/features/garage/lib/garageNudgeStorage.ts (the template).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PAID_MOMENT_STORAGE_KEY = 'trackitdown.payout_paid_moment_v1';

/** Whether this payout's moment has been shown. Unreadable storage → true. */
export async function hasCelebratedPayout(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PAID_MOMENT_STORAGE_KEY)) === key;
  } catch {
    return true;
  }
}

/** Remember it was shown. Never throws: a failed write costs one repeat. */
export async function markPayoutCelebrated(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PAID_MOMENT_STORAGE_KEY, key);
  } catch {
    // Silent by design — nothing the user could do about it.
  }
}

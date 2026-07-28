/**
 * WHAT:  The pure predicates behind the peacetime garage nudge — how old an
 *        account has to be, and whether the Explore card should show.
 * WHY:   Kept pure and free of hooks so the timing rule is trivially testable
 *        and lives in ONE place rather than being spelled out inline on a
 *        screen. Tenure comes from `profiles.created_at`, which we already have:
 *        it needs no new tracking, and unlike a local counter it survives a
 *        reinstall or a device switch — someone who has used the app for a year
 *        should not be treated as brand new because they got a new phone.
 * LINKS: src/features/garage/hooks/useGarageNudgeCard.ts (the only consumer);
 *        src/features/profile/hooks/useMyProfile.ts (supplies createdAt —
 *          INJECTED, never imported here: garage must not depend on profile).
 */

import type { SavedCarState } from '../hooks/useHasSavedCar';

/** How long someone must have had an account before the card appears. Three
 *  days is long enough that they have seen what the app is for, and short
 *  enough to reach them while they still care. */
export const NUDGE_MIN_ACCOUNT_AGE_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Has this account existed for at least `days`?
 *
 * A missing or unparseable timestamp returns FALSE — never nudge on garbage.
 * `now` is a parameter so the boundary is testable without faking the clock.
 */
export function isTenured(
  accountCreatedAt: string | null | undefined,
  now: number,
  days: number = NUDGE_MIN_ACCOUNT_AGE_DAYS,
): boolean {
  if (!accountCreatedAt) {
    return false;
  }
  const created = Date.parse(accountCreatedAt);
  if (Number.isNaN(created)) {
    return false;
  }
  return now - created >= days * MS_PER_DAY;
}

export interface GarageCardVisibilityInput {
  savedCar: SavedCarState;
  accountCreatedAt: string | null | undefined;
  /** Null while the flag is still being read — hold, don't flash. */
  alreadyOffered: boolean | null;
  now: number;
}

/**
 * Should the Explore card show?
 *
 * Every uncertain state resolves to FALSE: an unread flag, an unknown signal, a
 * guest. The card only appears when we positively know the user is tenured, has
 * no saved car, and has never been offered one.
 */
export function shouldShowGarageCard({
  savedCar,
  accountCreatedAt,
  alreadyOffered,
  now,
}: GarageCardVisibilityInput): boolean {
  if (alreadyOffered !== false) {
    return false;
  }
  if (savedCar !== 'none') {
    return false;
  }
  return isTenured(accountCreatedAt, now);
}

/**
 * WHAT:  The five mutable push categories, which notification kinds each one
 *        covers, and the copy the Settings screen shows for them.
 * WHY:   The Settings screen has to name what a switch actually silences, and
 *        the only honest way to do that is from the same map the server filters
 *        on. `supabase/tests/notificationCategories.test.ts` reads the migration
 *        and fails if these two ever disagree — the same guard
 *        `notificationKinds.ts` already has, and for the same reason: a
 *        mismatch here is a switch that lies about what it does.
 *
 *        ⚠️ TWO KINDS ARE ABSENT ON PURPOSE, and their absence is the feature:
 *          * `sighting` — someone has reported seeing YOUR stolen car. The one
 *            notification the whole product exists to deliver.
 *          * `closed_uncredited` — a post you reported on closed without
 *            crediting you, and you have 72 HOURS to contest it.
 *            ⚠️ THE REASON CHANGED ON 2026-09-01 AND THE DECISION DID NOT.
 *            This used to read "the push IS the door", because
 *            /sighting-dispute had no in-app route at all. It has one now:
 *            `My reports` shows it on any report a refund hold names. That
 *            makes muting survivable, not safe — the door is PASSIVE, and a
 *            72-hour window only helps someone who happens to go and look
 *            inside it. Muting would still cost most people the money.
 *            So it stays absent, on the clock rather than on reachability.
 *        They have no category, so there is no column to store a mute in and
 *        no switch a future screen could accidentally offer. The Settings
 *        screen states this rather than hiding it.
 * LINKS: supabase/migrations/20260824170000_notification_preferences.sql
 *          (notification_category — the authority this mirrors);
 *        ./notificationKinds.ts (the full set of eleven);
 *        src/features/profile/screens/SettingsScreen.tsx (the switches).
 */

import type { NotificationKind } from './notificationKinds';

/** Mirrors the `p_category` whitelist in set_my_notification_preference. */
export const NOTIFICATION_CATEGORIES = [
  'alerts',
  'messages',
  'my_sightings',
  'money',
  'watched',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** The caller's five booleans, as get_my_notification_preferences returns them. */
export type NotificationPreferences = Record<NotificationCategory, boolean>;

/** Everything on — what a user with no stored row gets, both here and in SQL. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  alerts: true,
  messages: true,
  my_sightings: true,
  money: true,
  watched: true,
};

/**
 * Which kinds each category covers.
 *
 * ⚠️ MIRRORS `notification_category(kind)` IN THE MIGRATION, one entry for one
 * entry. The SQL is the authority — it is what actually filters the send — and
 * this exists so the screen can say what it silences.
 */
export const CATEGORY_KINDS: Record<NotificationCategory, NotificationKind[]> = {
  alerts: ['alert'],
  messages: ['message'],
  my_sightings: ['sighting_confirmed', 'not_credited', 'credited_no_reward'],
  money: ['credited', 'payout_sent', 'dispute_upheld', 'dispute_rejected'],
  watched: ['recovery'],
};

/**
 * The kinds that may never be muted — every kind with no category.
 *
 * Derived rather than listed, so it cannot fall out of step with
 * CATEGORY_KINDS: add a kind to a category and it leaves this set on its own.
 */
export const UNMUTABLE_KINDS: readonly NotificationKind[] = (() => {
  const mapped = new Set(Object.values(CATEGORY_KINDS).flat());
  // still_missing joins these two for the reason they are here: a consequence
  // is attached. Its protection is the CAP — three asks per case, ever — not a
  // toggle, and a mutable version would need a `my_posts` category that does
  // not exist. Mirrors notification_category returning NULL for it.
  return (['sighting', 'closed_uncredited', 'still_missing'] as NotificationKind[]).filter(
    (kind) => !mapped.has(kind),
  );
})();

export interface CategoryCopy {
  category: NotificationCategory;
  title: string;
  /** What this switch actually silences, in the user's terms. */
  subtitle: string;
}

/**
 * The switches, in the order they are offered — most-frequent first, so the
 * one someone came to turn down is the one they meet first.
 *
 * The subtitles name the EVENT, not the kind. "When a car is reported stolen
 * near you" is checkable against your own experience; "alert" is a word from
 * our schema.
 */
export const CATEGORY_COPY: CategoryCopy[] = [
  {
    category: 'alerts',
    title: 'Cars reported near you',
    subtitle: 'When a car is reported stolen inside one of your alert areas.',
  },
  {
    category: 'messages',
    title: 'Messages',
    subtitle: 'When someone replies to you about a listing.',
  },
  {
    category: 'my_sightings',
    title: 'Your reports',
    subtitle: 'When an owner confirms a sighting you filed, or credits someone else.',
  },
  {
    category: 'money',
    title: 'Payouts',
    subtitle: 'When you earn a bounty and when the transfer goes out.',
  },
  {
    category: 'watched',
    title: 'Cars you follow',
    subtitle: 'When a car on your watchlist is recovered.',
  },
];

/**
 * WHAT:  Pure Reputation v1 maths — the points ladder (badges at 1/3/10/25 on
 *        confirmed sightings), the whole ladder for display, the next rung,
 *        the trusted-spotter rule, and the member-since formatter.
 * WHY:   Badges are trust signals owners weigh when reading sightings, so the
 *        threshold logic is pinned here as pure functions (docs/DOMAIN.md
 *        Reputation v1: display-only, never payout-affecting).
 *
 *        ⚠️ RESHAPED 2026-08-26 (owner). Was 1/5/25 run against all THREE
 *        counters — nine badges — with the next goal competing across
 *        families. Now one ladder on confirmed sightings, because that is the
 *        counter that means an owner acted; the other two remain as stats.
 *        The ladder is also written in SQL twice (see BADGE_THRESHOLDS) and
 *        all three copies must move together.
 * LINKS: docs/DOMAIN.md (Reputation v1);
 *        src/features/profile/components/ReputationCard.tsx (consumer);
 *        supabase/tests/badgeThresholds.test.ts (the cross-boundary pin).
 */

import type { ReputationCounters } from '../types';

/**
 * The badge ladder (owner, 2026-08-26 — was 1/5/25 across three counters).
 *
 * ⚠️ WRITTEN IN THREE PLACES AND THEY MUST AGREE. This array, the
 * `unnest(array[…])` inside `mark_sighting_helpful`, and the `case v_count`
 * arms inside `claim_sighting_confirmed_push` are the same ladder expressed
 * three times — the second decides which rung a confirmation crossed, the third
 * writes the words that go in the push. Move one alone and a spotter is told
 * they earned a badge the app does not show them.
 * `supabase/tests/badgeThresholds.test.ts` reads both migrations and fails if
 * they drift, which is the only thing stopping that.
 */
export const BADGE_THRESHOLDS = [1, 3, 10, 25] as const;

/** The one counter the ladder is built on: a sighting an owner confirmed. */
export const POINTS_COUNTER = 'sightingsHelpful' as const;

/** Ladder labels, mirrored EXACTLY by the SQL that writes the push copy. */
export const BADGE_LABELS: Record<(typeof BADGE_THRESHOLDS)[number], string> = {
  1: 'First confirmed sighting',
  3: '3 confirmed sightings',
  10: '10 confirmed sightings',
  25: '25 confirmed sightings',
};

/**
 * A spotter's points — confirmed sightings, nothing else.
 *
 * Named here rather than read inline so the screen says "points" once and the
 * mapping to a counter lives with the maths. ⚠️ It is `sightingsHelpful` and
 * NOT a sum: `sightingsReported` is uncapped and unverified, so adding it would
 * make the score farmable in exactly the way the confirmed counter is not.
 */
export function spotterPoints(counters: ReputationCounters): number {
  return counters[POINTS_COUNTER];
}

interface CounterKind {
  key: keyof ReputationCounters;
  /** Full phrase for spoken/a11y labels. */
  statLabel: string;
  /** One word for the stat row — never wraps, keeps the 3-up tidy. */
  shortLabel: string;
  /** Grammatical spoken phrase for a count ("1 recovery credited"). */
  spoken: (count: number) => string;
  // ⚠️ `badgeLabels` REMOVED 2026-08-26. Each counter used to carry its own
  // three chip labels because each counter had its own three badges. With a
  // single ladder on confirmed sightings the labels belong to the ladder
  // (BADGE_LABELS), and leaving a per-counter copy here would be a second
  // source of the same words waiting to disagree with the first. These kinds
  // still describe the STATS — which is all they were ever needed for besides.
}

export const COUNTER_KINDS: CounterKind[] = [
  {
    key: 'sightingsReported',
    statLabel: 'Sightings reported',
    shortLabel: 'Sightings',
    spoken: (count) => `${count} ${count === 1 ? 'sighting' : 'sightings'} reported`,
  },
  {
    key: 'sightingsHelpful',
    statLabel: 'Marked helpful',
    shortLabel: 'Helpful',
    spoken: (count) => `${count} marked helpful`,
  },
  {
    key: 'recoveriesCredited',
    statLabel: 'Recoveries credited',
    shortLabel: 'Recoveries',
    spoken: (count) => `${count} ${count === 1 ? 'recovery' : 'recoveries'} credited`,
  },
];

export interface BadgeState {
  key: string;
  label: string;
  /** Which counter family the badge belongs to (drives emblem icon/tint). */
  counter: keyof ReputationCounters;
  threshold: (typeof BADGE_THRESHOLDS)[number];
}

/**
 * Earned badges, ascending.
 *
 * ⚠️ ONE LADDER SINCE 2026-08-26, on confirmed sightings alone. It used to run
 * every threshold against every counter — nine badges — and the cost of
 * collapsing it is real and was accepted deliberately: a spotter with 25
 * REPORTED sightings and none confirmed had three emblems and now has none.
 * Nothing is lost from the database, because badges have always been derived
 * rather than stored; what changed is what the app is willing to call an
 * achievement. Reporting a sighting is something you do; having one confirmed
 * is something an owner did about it.
 */
export function earnedBadges(counters: ReputationCounters): BadgeState[] {
  const points = spotterPoints(counters);
  return BADGE_THRESHOLDS.filter((threshold) => points >= threshold).map((threshold) => ({
    key: `${POINTS_COUNTER}-${threshold}`,
    label: BADGE_LABELS[threshold],
    counter: POINTS_COUNTER,
    threshold,
  }));
}

export interface LadderRung {
  threshold: (typeof BADGE_THRESHOLDS)[number];
  label: string;
  earned: boolean;
  /** True for the single nearest unearned rung — the one being worked toward. */
  next: boolean;
}

/**
 * The WHOLE ladder, earned and not.
 *
 * The reference's lesson (Airbnb's Superhost) is published criteria plus
 * visible progress: you can see what you need, not merely what you are missing
 * next. This screen previously showed one goal, so a spotter could not tell
 * whether anything existed beyond it — which is precisely the question "and
 * after 3?" asks.
 */
export function badgeLadder(counters: ReputationCounters): LadderRung[] {
  const points = spotterPoints(counters);
  const nextThreshold = BADGE_THRESHOLDS.find((threshold) => points < threshold);
  return BADGE_THRESHOLDS.map((threshold) => ({
    threshold,
    label: BADGE_LABELS[threshold],
    earned: points >= threshold,
    next: threshold === nextThreshold,
  }));
}

// Trusted spotter (docs/DOMAIN.md Reputation v1): the app's headline trust
// marker — at least one credited recovery AND five helpful sightings. Both
// counters are server-maintained, so the status is as forgery-proof as they
// are. Derived from PUBLIC counters, so showing it on PublicProfileSheet
// adds nothing beyond the existing privacy boundary.
export const TRUSTED_MIN_RECOVERIES = 1;
/**
 * ⚠️ FIVE, AND IT DID NOT MOVE WITH THE BADGE LADDER (2026-08-26).
 *
 * `20260814120000_reputation_one_point_per_listing` priced the cheapest farm
 * against exactly this number — "the cheapest farm is a SINGLE listing
 * confirmed five times… TRUSTED_MIN_HELPFUL = 5 is met" — and answered it with
 * the per-listing cap, so each point now costs a separate listing and three
 * separate listings for one owner→spotter pair is what `confirmation_pair_count`
 * already refuses to count. The badge rung at 3 is display-only and cheapens a
 * small signal; lowering THIS would reverse that work outright, because it is
 * the marker owners actually weigh. Raised deliberately with the owner before
 * the ladder changed.
 */
export const TRUSTED_MIN_HELPFUL = 5;

export function isTrustedSpotter(counters: ReputationCounters): boolean {
  return (
    counters.recoveriesCredited >= TRUSTED_MIN_RECOVERIES &&
    counters.sightingsHelpful >= TRUSTED_MIN_HELPFUL
  );
}

export interface HighlightItem {
  key: 'recoveries' | 'helpful' | 'reported';
  label: string;
}

/**
 * The card's narrative lines, strongest story first. A zero counter
 * produces NO line — never a sad zero. (Member-since lives in the identity
 * header; the card only tells the spotting story.)
 */
export function highlights(counters: ReputationCounters): HighlightItem[] {
  const items: HighlightItem[] = [];
  const { recoveriesCredited, sightingsHelpful, sightingsReported } = counters;
  if (recoveriesCredited > 0) {
    items.push({
      key: 'recoveries',
      label: `Helped recover ${recoveriesCredited} ${recoveriesCredited === 1 ? 'car' : 'cars'}`,
    });
  }
  if (sightingsHelpful > 0) {
    items.push({
      key: 'helpful',
      label:
        sightingsHelpful === 1
          ? '1 sighting helped an owner'
          : `${sightingsHelpful} sightings helped owners`,
    });
  }
  if (sightingsReported > 0) {
    items.push({
      key: 'reported',
      label: `${sightingsReported} ${sightingsReported === 1 ? 'sighting' : 'sightings'} reported`,
    });
  }
  return items;
}

export interface StatRowItem {
  key: keyof ReputationCounters;
  value: number;
  /** One-word row label (never wraps in the column). */
  label: string;
  /** Resolved grammatical phrase for screen readers ("1 recovery credited"). */
  spoken: string;
}

/**
 * Passport-card stat rows — nonzero counters only (degrade by omission,
 * never a zero row; docs/design-refs/profile/REFERENCE_SPEC.md §2), in
 * counter order: volume first, impact last, like the reference's
 * Reviews → Rating → Years column.
 */
export function passportStats(counters: ReputationCounters): StatRowItem[] {
  return COUNTER_KINDS.filter((kind) => counters[kind.key] > 0).map((kind) => ({
    key: kind.key,
    value: counters[kind.key],
    label: kind.shortLabel,
    spoken: kind.spoken(counters[kind.key]),
  }));
}

export interface NextBadgeGoal {
  label: string;
  /** Current progress toward the goal, e.g. 4 of 5. */
  achieved: number;
  threshold: number;
}

/**
 * The next rung, or null once the ladder is finished.
 *
 * ⚠️ NO LONGER A COMPETITION BETWEEN COUNTERS. It used to pick the nearest
 * unearned badge across all three, with a tie-break on counter order — which
 * meant the goal could jump family between visits as different counters moved.
 * With one ladder there is exactly one next rung and it only ever goes up.
 */
export function nextBadgeGoal(counters: ReputationCounters): NextBadgeGoal | null {
  const points = spotterPoints(counters);
  const threshold = BADGE_THRESHOLDS.find((rung) => points < rung);
  return threshold === undefined
    ? null
    : { label: BADGE_LABELS[threshold], achieved: points, threshold };
}

/** "2026-07-10T…" → "July 2026", or null when unparseable (UK-only, en-GB). */
function monthYear(createdAt: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** Identity-header wording: "Member since July 2026". */
export function memberSinceLabel(createdAt: string): string {
  const label = monthYear(createdAt);
  return label ? `Member since ${label}` : 'Member';
}

/** Story wording for the fresh-account card: "Spotting since July 2026". */
export function spottingSinceLabel(createdAt: string): string {
  const label = monthYear(createdAt);
  return label ? `Spotting since ${label}` : 'Spotting with Trackitdown';
}

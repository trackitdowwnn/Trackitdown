/**
 * WHAT:  Pure Reputation v1 maths — earned badges at the 1/5/25 thresholds,
 *        the single closest next-badge goal, and the member-since formatter.
 * WHY:   Badges are trust signals owners weigh when reading sightings, so
 *        the threshold logic is pinned here as pure functions (docs/DOMAIN.md
 *        Reputation v1: counters + badges at 1/5/25, display-only, never
 *        payout-affecting). Chip labels are deliberately SHORT ("5
 *        sightings", not sentences) and motivation is ONE next goal — the
 *        nearest badge across all counters — never a wall of grey chips.
 * LINKS: docs/DOMAIN.md (Reputation v1);
 *        src/features/profile/components/ReputationCard.tsx (consumer).
 */

import type { ReputationCounters } from '../types';

/** DOMAIN.md: "Badges at simple thresholds (1 / 5 / 25)." */
export const BADGE_THRESHOLDS = [1, 5, 25] as const;

interface CounterKind {
  key: keyof ReputationCounters;
  /** Full phrase for spoken/a11y labels. */
  statLabel: string;
  /** One word for the stat row — never wraps, keeps the 3-up tidy. */
  shortLabel: string;
  /** Grammatical spoken phrase for a count ("1 recovery credited"). */
  spoken: (count: number) => string;
  /** Compact chip label per threshold. */
  badgeLabels: Record<(typeof BADGE_THRESHOLDS)[number], string>;
}

export const COUNTER_KINDS: CounterKind[] = [
  {
    key: 'sightingsReported',
    statLabel: 'Sightings reported',
    shortLabel: 'Sightings',
    spoken: (count) => `${count} ${count === 1 ? 'sighting' : 'sightings'} reported`,
    badgeLabels: { 1: 'First sighting', 5: '5 sightings', 25: '25 sightings' },
  },
  {
    key: 'sightingsHelpful',
    statLabel: 'Marked helpful',
    shortLabel: 'Helpful',
    spoken: (count) => `${count} marked helpful`,
    badgeLabels: { 1: 'First helpful mark', 5: '5 helpful marks', 25: '25 helpful marks' },
  },
  {
    key: 'recoveriesCredited',
    statLabel: 'Recoveries credited',
    shortLabel: 'Recoveries',
    spoken: (count) => `${count} ${count === 1 ? 'recovery' : 'recoveries'} credited`,
    badgeLabels: { 1: 'First recovery', 5: '5 recoveries', 25: '25 recoveries' },
  },
];

export interface BadgeState {
  key: string;
  label: string;
  /** Which counter family the badge belongs to (drives emblem icon/tint). */
  counter: keyof ReputationCounters;
  threshold: (typeof BADGE_THRESHOLDS)[number];
}

/** Earned badges only, counter order then ascending threshold. */
export function earnedBadges(counters: ReputationCounters): BadgeState[] {
  const earned: BadgeState[] = [];
  for (const kind of COUNTER_KINDS) {
    for (const threshold of BADGE_THRESHOLDS) {
      if (counters[kind.key] >= threshold) {
        earned.push({
          key: `${kind.key}-${threshold}`,
          label: kind.badgeLabels[threshold],
          counter: kind.key,
          threshold,
        });
      }
    }
  }
  return earned;
}

// Trusted spotter (docs/DOMAIN.md Reputation v1): the app's headline trust
// marker — at least one credited recovery AND five helpful sightings. Both
// counters are server-maintained, so the status is as forgery-proof as they
// are. Derived from PUBLIC counters, so showing it on PublicProfileSheet
// adds nothing beyond the existing privacy boundary.
export const TRUSTED_MIN_RECOVERIES = 1;
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

/** The single NEAREST unearned badge across all counters (fewest actions
 *  remaining; ties go to counter order) — one line of gentle motivation. */
export function nextBadgeGoal(counters: ReputationCounters): NextBadgeGoal | null {
  let best: NextBadgeGoal | null = null;
  for (const kind of COUNTER_KINDS) {
    const value = counters[kind.key];
    for (const threshold of BADGE_THRESHOLDS) {
      if (value < threshold) {
        if (!best || threshold - value < best.threshold - best.achieved) {
          best = { label: kind.badgeLabels[threshold], achieved: value, threshold };
        }
        break; // only the first unearned threshold per counter competes
      }
    }
  }
  return best;
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

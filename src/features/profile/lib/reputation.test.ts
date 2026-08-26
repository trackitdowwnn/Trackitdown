/**
 * WHAT:  Tests for the Reputation v1 badge maths — earned thresholds
 *        (inclusive), the single nearest next-badge goal with tie-breaking,
 *        compact labels, and the member-since formatter.
 * WHY:   Badges are the trust signal owners weigh when reading sightings; a
 *        threshold slip either flatters fraudsters or robs honest spotters,
 *        and a wrong "next goal" nudges users toward the wrong behaviour.
 * LINKS: src/features/profile/lib/reputation.ts; docs/DOMAIN.md.
 */

import type { ReputationCounters } from '../types';
import {
  badgeLadder,
  earnedBadges,
  highlights,
  isTrustedSpotter,
  memberSinceLabel,
  nextBadgeGoal,
  passportStats,
  spotterPoints,
} from './reputation';

const counters = (
  reported: number,
  helpful: number,
  credited: number,
): ReputationCounters => ({
  sightingsReported: reported,
  sightingsHelpful: helpful,
  recoveriesCredited: credited,
});

describe('earnedBadges', () => {
  // ⚠️ ONE LADDER SINCE 2026-08-26, on CONFIRMED sightings alone. These tests
  // were nine-badge tests: every threshold against every counter. The collapse
  // is deliberate and its cost is asserted below rather than left implicit.
  it('zero counters earn nothing', () => {
    expect(earnedBadges(counters(0, 0, 0))).toEqual([]);
  });

  it('thresholds are inclusive: exactly 1, 3, 10, 25 earn', () => {
    expect(earnedBadges(counters(0, 1, 0)).map((b) => b.label)).toEqual([
      'First confirmed sighting',
    ]);
    expect(earnedBadges(counters(0, 3, 0)).map((b) => b.label)).toEqual([
      'First confirmed sighting',
      '3 confirmed sightings',
    ]);
    expect(earnedBadges(counters(0, 25, 0)).map((b) => b.label)).toEqual([
      'First confirmed sighting',
      '3 confirmed sightings',
      '10 confirmed sightings',
      '25 confirmed sightings',
    ]);
  });

  it('just below a rung does not earn it', () => {
    expect(earnedBadges(counters(0, 2, 0)).map((b) => b.label)).toEqual([
      'First confirmed sighting',
    ]);
  });

  it('⚠️ REPORTED sightings and RECOVERIES no longer earn badges', () => {
    // The accepted cost of one ladder: a prolific reporter whose sightings no
    // owner ever confirmed used to hold three emblems and now holds none.
    // Nothing is lost from the database — badges have always been derived — but
    // this is the assertion that makes the trade visible instead of surprising.
    // Reporting is something you do; a confirmation is something an owner did.
    expect(earnedBadges(counters(25, 0, 25))).toEqual([]);
  });
});

describe('badgeLadder', () => {
  it('shows the whole ladder, not just what is left', () => {
    // The reference's lesson (Superhost): published criteria, not a single
    // hidden next step. A spotter should be able to see that 25 exists.
    const rungs = badgeLadder(counters(0, 3, 0));

    expect(rungs.map((r) => r.threshold)).toEqual([1, 3, 10, 25]);
    expect(rungs.map((r) => r.earned)).toEqual([true, true, false, false]);
  });

  it('marks exactly one rung as next, and only an unearned one', () => {
    const rungs = badgeLadder(counters(0, 3, 0));

    expect(rungs.filter((r) => r.next).map((r) => r.threshold)).toEqual([10]);
    expect(rungs.find((r) => r.next)?.earned).toBe(false);
  });

  it('marks nothing as next once the ladder is finished', () => {
    expect(badgeLadder(counters(0, 40, 0)).some((r) => r.next)).toBe(false);
  });
});

describe('spotterPoints', () => {
  it('⚠️ counts confirmed sightings only, never reported ones', () => {
    // Reported sightings are uncapped and unverified; including them would make
    // the score farmable in exactly the way the confirmed counter is not (the
    // per-listing cap in 20260814120000).
    expect(spotterPoints(counters(50, 2, 1))).toBe(2);
  });
});

describe('nextBadgeGoal', () => {
  it('fresh account: the first rung', () => {
    expect(nextBadgeGoal(counters(0, 0, 0))).toEqual({
      label: 'First confirmed sighting',
      achieved: 0,
      threshold: 1,
    });
  });

  it('⚠️ climbs one ladder and never changes family mid-climb', () => {
    // It used to pick the nearest unearned badge ACROSS the three counters,
    // with a tie-break on counter order — so the goal could swap from
    // "5 sightings" to "5 helpful marks" between two visits because a different
    // counter moved. One ladder means the goal only ever goes up.
    expect(nextBadgeGoal(counters(0, 1, 0))?.threshold).toBe(3);
    expect(nextBadgeGoal(counters(0, 3, 0))?.threshold).toBe(10);
    expect(nextBadgeGoal(counters(0, 10, 0))?.threshold).toBe(25);
  });

  it('⚠️ is unmoved by reported sightings and recoveries', () => {
    // A spotter with fifty reported sightings and no confirmations is still on
    // the first rung — the goal measures the same thing the badges do.
    expect(nextBadgeGoal(counters(50, 0, 12))).toEqual({
      label: 'First confirmed sighting',
      achieved: 0,
      threshold: 1,
    });
  });

  it('ladder finished: no goal', () => {
    expect(nextBadgeGoal(counters(0, 25, 0))).toBeNull();
  });
});

describe('isTrustedSpotter', () => {
  it('requires BOTH a credited recovery and five helpful sightings', () => {
    expect(isTrustedSpotter(counters(0, 5, 1))).toBe(true);
    expect(isTrustedSpotter(counters(99, 5, 0))).toBe(false); // no recovery
    expect(isTrustedSpotter(counters(0, 4, 3))).toBe(false); // helpful short
    expect(isTrustedSpotter(counters(0, 0, 0))).toBe(false);
  });
});

describe('highlights', () => {
  it('tells the story strongest-first with correct plurals', () => {
    expect(highlights(counters(7, 4, 1)).map((h) => h.label)).toEqual([
      'Helped recover 1 car',
      '4 sightings helped owners',
      '7 sightings reported',
    ]);
    expect(highlights(counters(1, 1, 2)).map((h) => h.label)).toEqual([
      'Helped recover 2 cars',
      '1 sighting helped an owner',
      '1 sighting reported',
    ]);
  });

  it('zero counters produce NO lines — never a sad zero', () => {
    expect(highlights(counters(0, 0, 0))).toEqual([]);
    expect(highlights(counters(3, 0, 0)).map((h) => h.key)).toEqual(['reported']);
  });
});

describe('passportStats', () => {
  it('nonzero counters become stat rows in counter order (volume → impact)', () => {
    const rows = passportStats(counters(7, 4, 1));
    expect(rows.map((r) => r.key)).toEqual([
      'sightingsReported',
      'sightingsHelpful',
      'recoveriesCredited',
    ]);
    expect(rows[0]).toMatchObject({ value: 7, label: 'Sightings' });
  });

  it('zero counters produce NO row — degrade by omission, never zeros', () => {
    expect(passportStats(counters(0, 0, 0))).toEqual([]);
    expect(passportStats(counters(3, 0, 0)).map((r) => r.key)).toEqual(['sightingsReported']);
  });
});

describe('memberSinceLabel', () => {
  it('formats month and year', () => {
    expect(memberSinceLabel('2026-07-10T09:00:00Z')).toBe('Member since July 2026');
  });

  it('degrades calmly on a bad timestamp', () => {
    expect(memberSinceLabel('not-a-date')).toBe('Member');
  });
});

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
  earnedBadges,
  highlights,
  isTrustedSpotter,
  memberSinceLabel,
  nextBadgeGoal,
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
  it('zero counters earn nothing', () => {
    expect(earnedBadges(counters(0, 0, 0))).toEqual([]);
  });

  it('thresholds are inclusive: exactly 1, 5, 25 earn', () => {
    const labels = earnedBadges(counters(1, 5, 25)).map((b) => b.label);
    expect(labels).toEqual([
      'First sighting',
      'First helpful mark',
      '5 helpful marks',
      'First recovery',
      '5 recoveries',
      '25 recoveries',
    ]);
  });

  it('just below a threshold does not earn (4 → only the 1-badge)', () => {
    const labels = earnedBadges(counters(4, 0, 0)).map((b) => b.label);
    expect(labels).toEqual(['First sighting']);
  });
});

describe('nextBadgeGoal', () => {
  it('fresh account: the nearest goal is any first badge (counter order tie-break)', () => {
    expect(nextBadgeGoal(counters(0, 0, 0))).toEqual({
      label: 'First sighting',
      achieved: 0,
      threshold: 1,
    });
  });

  it('picks the goal with the fewest actions remaining across counters', () => {
    // 4/5 sightings (1 away) beats 0/1 helpful (1 away? no — 1 away too, tie
    // goes to counter order: sightings first) and 0/1 recoveries.
    expect(nextBadgeGoal(counters(4, 0, 0))).toEqual({
      label: '5 sightings',
      achieved: 4,
      threshold: 5,
    });
    // 23/25 sightings (2 away) loses to 4/5 helpful (1 away).
    expect(nextBadgeGoal(counters(23, 4, 0))).toEqual({
      label: '5 helpful marks',
      achieved: 4,
      threshold: 5,
    });
  });

  it('everything maxed: no goal', () => {
    expect(nextBadgeGoal(counters(25, 25, 25))).toBeNull();
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

describe('memberSinceLabel', () => {
  it('formats month and year', () => {
    expect(memberSinceLabel('2026-07-10T09:00:00Z')).toBe('Member since July 2026');
  });

  it('degrades calmly on a bad timestamp', () => {
    expect(memberSinceLabel('not-a-date')).toBe('Member');
  });
});

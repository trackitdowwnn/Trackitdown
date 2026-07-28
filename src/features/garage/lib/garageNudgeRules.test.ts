/**
 * WHAT:  Tests for the peacetime nudge's timing and visibility rules.
 * WHY:   The boundary matters (a brand-new user must not be nudged before they
 *        have seen what the app is for) and so does the behaviour on bad input:
 *        every uncertain state must resolve to "don't show". A nudge that
 *        appears on a failed profile load or a mid-flight signal is a nudge that
 *        appears at random.
 * LINKS: src/features/garage/lib/garageNudgeRules.ts, docs/TESTING.md.
 */

import { isTenured, shouldShowGarageCard } from './garageNudgeRules';

const NOW = Date.parse('2026-07-27T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

describe('isTenured', () => {
  it('is false just under the threshold', () => {
    expect(isTenured(hoursAgo(71), NOW)).toBe(false); // 2d 23h
  });

  it('is true at exactly the threshold', () => {
    expect(isTenured(daysAgo(3), NOW)).toBe(true);
  });

  it('is true well past it', () => {
    expect(isTenured(daysAgo(400), NOW)).toBe(true);
  });

  it('is false for a brand-new account', () => {
    expect(isTenured(hoursAgo(1), NOW)).toBe(false);
  });

  // Never nudge on garbage — a missing or malformed timestamp means we don't
  // know how long they've been here, and "don't know" must mean "stay quiet".
  it('is false for null, undefined and unparseable input', () => {
    expect(isTenured(null, NOW)).toBe(false);
    expect(isTenured(undefined, NOW)).toBe(false);
    expect(isTenured('not a date', NOW)).toBe(false);
    expect(isTenured('', NOW)).toBe(false);
  });
});

describe('shouldShowGarageCard', () => {
  const base = {
    savedCar: 'none' as const,
    accountCreatedAt: daysAgo(10),
    alreadyOffered: false as boolean | null,
    now: NOW,
  };

  it('shows for a tenured member with no saved car who has never been offered', () => {
    expect(shouldShowGarageCard(base)).toBe(true);
  });

  it('stays hidden once the offer has been made — the sheet and card share a flag', () => {
    expect(shouldShowGarageCard({ ...base, alreadyOffered: true })).toBe(false);
  });

  it('stays hidden while the flag is still being read, rather than flashing', () => {
    expect(shouldShowGarageCard({ ...base, alreadyOffered: null })).toBe(false);
  });

  it('stays hidden for someone who already has a car', () => {
    expect(shouldShowGarageCard({ ...base, savedCar: 'some' })).toBe(false);
  });

  // 'unknown' covers guests, a failed fetch and a request in flight. All three
  // must be silent: a network blip is not a reason to prompt someone.
  it('stays hidden while the saved-car signal is unknown', () => {
    expect(shouldShowGarageCard({ ...base, savedCar: 'unknown' })).toBe(false);
  });

  it('stays hidden for an account younger than the threshold', () => {
    expect(shouldShowGarageCard({ ...base, accountCreatedAt: hoursAgo(2) })).toBe(false);
  });

  it('stays hidden when we have no account date at all', () => {
    expect(shouldShowGarageCard({ ...base, accountCreatedAt: null })).toBe(false);
  });
});

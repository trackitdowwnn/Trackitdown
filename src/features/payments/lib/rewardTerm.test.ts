/**
 * WHAT:  Tests for rewardTerm — the reward's phase at a moment, the one quiet
 *        sentence for it, and the rule that the listing says the date ONCE
 *        (a card, or a line, never both, never neither while there is a term).
 * WHY:   Three surfaces speak about one reward (the banner, the listing's stat
 *        band, the stats page). Each boundary here is a day a sentence about
 *        money changes, so each is pinned.
 * LINKS: src/features/payments/lib/rewardTerm.ts.
 */

import type { RewardStatus } from '../api/rewardChangeApi';
import {
  hasRewardTermCard,
  quietRewardTermLine,
  rewardTermLine,
  rewardTermPhase,
} from './rewardTerm';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

const held = (over: Partial<RewardStatus> = {}): RewardStatus => ({
  postStatus: 'active',
  mode: 'change',
  rewardId: 'r1',
  amountPence: 20000,
  capturedAt: '2026-10-01T10:00:00Z',
  termEndsAt: inDays(40),
  legacyTerm: false,
  rewardEndedAt: null,
  endedRewardPence: null,
  feeAbsorbed: false,
  hasRecentSightings: false,
  blockedMessage: null,
  ...over,
});

const returned = (daysAgo: number): RewardStatus =>
  held({
    mode: 'add',
    rewardId: null,
    amountPence: null,
    capturedAt: null,
    termEndsAt: null,
    rewardEndedAt: inDays(-daysAgo),
    endedRewardPence: 20000,
  });

describe('rewardTermPhase', () => {
  it.each([
    ['quiet', held()],
    ['quiet', held({ termEndsAt: inDays(14.01) })],
    ['renew', held({ termEndsAt: inDays(14) })],
    ['renew', held({ termEndsAt: inDays(1) })],
    ['blocked', held({ termEndsAt: inDays(5), blockedMessage: 'held' })],
    ['ending', held({ termEndsAt: inDays(0) })],
    ['ending', held({ termEndsAt: inDays(-2), blockedMessage: 'held' })],
    ['returned', returned(1)],
    ['returned', returned(14)],
    ['returnedQuiet', returned(15)],
  ])('%s', (phase, status) => {
    expect(rewardTermPhase(status, NOW)).toBe(phase);
  });

  it.each([
    ['no read yet', null],
    ['a fee listing (nothing held, nothing ended)', held({ mode: 'add', rewardId: null, amountPence: null, termEndsAt: null })],
    ['a reward with no term yet', held({ termEndsAt: null })],
    ['an unparseable term', held({ termEndsAt: 'not a date' })],
    ['an ended stamp without its amount', { ...returned(1), endedRewardPence: null }],
  ])('none for %s — never a guessed date', (_label, status) => {
    expect(rewardTermPhase(status, NOW)).toBe('none');
    expect(rewardTermLine(status, NOW)).toBeNull();
  });
});

describe('rewardTermLine', () => {
  it('names the amount and the date while the reward runs', () => {
    expect(rewardTermLine(held({ termEndsAt: '2026-12-04T23:59:59Z' }), NOW)).toBe(
      'Your £200 reward runs until 4 December.',
    );
  });

  it('never says "runs until" a date that has passed', () => {
    expect(rewardTermLine(held({ termEndsAt: '2026-10-04T23:59:59Z' }), NOW)).toBe(
      'Your £200 reward ended on 5 October.',
    );
  });

  it('after the refund: the reward and the day its refund went — never "£200 refunded" (the card fee is kept)', () => {
    expect(rewardTermLine({ ...returned(20), rewardEndedAt: '2026-09-16T09:00:00Z' }, NOW)).toBe(
      'The refund of your £200 reward went to your card on 16 September.',
    );
  });

  it('past its date but held by a claim: says it stays held, not that it went back', () => {
    expect(
      rewardTermLine(held({ termEndsAt: '2026-10-04T23:59:59Z', blockedMessage: 'held' }), NOW),
    ).toBe('Your £200 reward ended on 5 October. It stays held while the recovery or dispute is sorted out.');
  });
});

describe('only a LIVE listing has a running term', () => {
  it.each(['cancelled', 'recovery_claimed', 'recovered', 'draft'] as const)(
    '%s: nothing — its held reward is being refunded or decided, not "running"',
    (postStatus) => {
      const status = held({ postStatus, termEndsAt: inDays(5) });
      expect(rewardTermPhase(status, NOW)).toBe('none');
      expect(rewardTermLine(status, NOW)).toBeNull();
    },
  );

  it('pending_verification is live', () => {
    expect(rewardTermPhase(held({ postStatus: 'pending_verification' }), NOW)).toBe('quiet');
  });
});

describe('the listing says the date once', () => {
  it.each([
    ['quiet', held()],
    ['renew', held({ termEndsAt: inDays(9) })],
    ['blocked', held({ termEndsAt: inDays(9), blockedMessage: 'held' })],
    ['ending', held({ termEndsAt: inDays(-1) })],
    ['returned', returned(2)],
    ['returnedQuiet', returned(30)],
  ])('%s: exactly one of the card and the line', (_label, status) => {
    const card = hasRewardTermCard(status, NOW);
    const line = quietRewardTermLine(status, NOW);
    expect(card !== (line !== null)).toBe(true);
  });
});

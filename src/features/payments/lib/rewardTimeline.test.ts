/**
 * WHAT:  Tests for rewardTimeline — every route an owner's reward money takes,
 *        as the steps the "Your reward" card draws.
 * WHY:   Each route says something about money: who got it, how much came
 *        back, what is still waiting and why. A wrong step here is a wrong
 *        sentence about someone's money, so each route is pinned.
 * LINKS: ./rewardTimeline.ts.
 */

import type { RewardTimeline, TimelineReward } from '../api/rewardTimelineApi';
import { rewardTimeline } from './rewardTimeline';

const reward = (over: Partial<TimelineReward> = {}): TimelineReward => ({
  status: 'held',
  amountPence: 25000,
  capturedAt: '2026-10-01T10:00:00Z',
  termEndsAt: '2026-11-30T23:59:59Z',
  releasedAt: null,
  refundedAt: null,
  refundedPence: null,
  supersededAt: null,
  holdUntil: null,
  holdReason: null,
  ...over,
});

const timeline = (over: Partial<RewardTimeline> = {}): RewardTimeline => ({
  postStatus: 'recovered',
  rewards: [reward()],
  creditedAt: null,
  disputeOpen: false,
  ...over,
});

const shape = (view: ReturnType<typeof rewardTimeline>) =>
  view?.steps.map((step) => `${step.id}:${step.state}`) ?? null;

describe('rewardTimeline', () => {
  it.each(['draft', 'pending_verification', 'active'] as const)(
    'says nothing on a %s listing — the term card tells a live reward',
    (postStatus) => {
      expect(rewardTimeline(timeline({ postStatus }))).toBeNull();
    },
  );

  it('says nothing without a read, or without a reward', () => {
    expect(rewardTimeline(null)).toBeNull();
    expect(rewardTimeline(timeline({ rewards: [] }))).toBeNull();
  });

  it('paid out: taken → credited → paid, with the dates', () => {
    const view = rewardTimeline(
      timeline({
        rewards: [reward({ status: 'released', releasedAt: '2026-10-12T14:00:00Z' })],
        creditedAt: '2026-10-12T13:00:00Z',
      }),
    );
    expect(shape(view)).toEqual(['reward:done', 'credit:done', 'payout:done']);
    expect(view?.steps[0]?.label).toBe('Your £250 reward');
    // Dates beside the label (`meta`, 2026-10-14), not folded into sentences.
    expect(view?.steps[0]?.meta).toBe('1 October');
    expect(view?.steps[1]?.meta).toBe('12 October');
    expect(view?.steps[2]?.meta).toBe('12 October');
    expect(view?.steps[2]?.detail).toBe('Paid to the spotter.');
    expect(view?.outcome).toBe('Paid out');
  });

  it('refunded after a hold: the hold’s date, the figure back, and the card fee kept', () => {
    const view = rewardTimeline(
      timeline({
        postStatus: 'cancelled',
        rewards: [
          reward({
            status: 'refunded',
            refundedPence: 24605,
            refundedAt: '2026-10-16T09:00:00Z',
            holdUntil: '2026-10-16T08:00:00Z',
            holdReason: 'deactivate',
          }),
        ],
      }),
    );
    expect(shape(view)).toEqual(['reward:done', 'hold:done', 'refund:done']);
    expect(view?.steps[1]?.meta).toBe('Until 16 October');
    expect(view?.steps[2]?.meta).toBe('16 October');
    expect(view?.steps[2]?.detail).toBe('£246.05 back to your card — the £3.95 card fee was kept.');
    expect(view?.outcome).toBe('Refunded');
  });

  it('a full refund says no fee was kept — by saying nothing about one', () => {
    const view = rewardTimeline(
      timeline({
        postStatus: 'recovered_no_spotter',
        rewards: [reward({ status: 'refunded', refundedPence: 25000, refundedAt: '2026-10-16T09:00:00Z' })],
      }),
    );
    expect(view?.steps.at(-1)?.detail).toBe('£250 back to your card.');
    expect(view?.steps.at(-1)?.meta).toBe('16 October');
  });

  it('⚠️ credited but not yet sent: the payout is waiting — never "paid"', () => {
    const view = rewardTimeline(
      timeline({ postStatus: 'recovery_claimed', creditedAt: '2026-10-12T13:00:00Z' }),
    );
    expect(shape(view)).toEqual(['reward:done', 'credit:done', 'payout:current']);
    expect(view?.steps[2]?.detail).toBe('Waiting to be sent to the spotter.');
    expect(view?.outcome).toBeNull();
  });

  it('on a refund hold: when it ends — the date the toast used to say once', () => {
    const view = rewardTimeline(
      timeline({
        postStatus: 'cancelled',
        rewards: [reward({ holdUntil: '2026-10-16T08:00:00Z', holdReason: 'deactivate' })],
      }),
    );
    expect(shape(view)).toEqual(['reward:done', 'hold:current', 'refund:upcoming']);
    expect(view?.steps[1]?.meta).toBe('Until 16 October');
    expect(view?.steps[1]?.detail).toBe('Your refund is sent then, unless a sighting is contested.');
  });

  it('a contested hold says it’s being reviewed, not a date it may miss', () => {
    const view = rewardTimeline(
      timeline({
        postStatus: 'cancelled',
        rewards: [reward({ holdUntil: '2026-10-16T08:00:00Z' })],
        disputeOpen: true,
      }),
    );
    expect(view?.steps[1]?.detail).toMatch(/contested this, so it’s being reviewed/);
  });

  it('closed with no hold: being refunded', () => {
    const view = rewardTimeline(timeline({ postStatus: 'cancelled' }));
    expect(shape(view)).toEqual(['reward:done', 'refund:current']);
  });

  it('only the LATEST reward’s road — a renewal’s old one was settled when replaced', () => {
    const view = rewardTimeline(
      timeline({
        rewards: [
          reward({ status: 'superseded', amountPence: 20000, supersededAt: '2026-10-05T10:00:00Z' }),
          reward({ status: 'released', amountPence: 30000, releasedAt: '2026-10-12T14:00:00Z' }),
        ],
      }),
    );
    expect(view?.steps[0]?.label).toBe('Your £300 reward');
    expect(view?.outcome).toBe('Paid out');
  });

  it('names no payment provider (owner, 2026-10-13)', () => {
    const view = rewardTimeline(
      timeline({ rewards: [reward({ status: 'released', releasedAt: '2026-10-12T14:00:00Z' })] }),
    );
    expect(JSON.stringify(view)).not.toMatch(/Stripe/i);
  });
});

/**
 * WHAT:  Tests for payoutProgress — which step of getting paid each state is.
 * WHY:   The tracker's whole value is saying the right thing about WHO is
 *        waiting: a "nothing for you to do" shown to someone Stripe is waiting
 *        on would strand them, and a "sent" we can't see would be a promise
 *        about money. Every state is pinned here.
 * LINKS: ./payoutProgress.ts.
 */

import { payoutProgress } from './payoutProgress';

const states = (input: Parameters<typeof payoutProgress>[0]) =>
  payoutProgress(input)?.map((step) => `${step.id}:${step.state}`) ?? null;

describe('payoutProgress', () => {
  it.each(['guest', 'loading', 'error'] as const)('draws nothing for %s', (status) => {
    expect(payoutProgress({ status, settling: false, pendingCreditPence: 19000 })).toBeNull();
  });

  it('draws nothing while still asking whether a reward waits', () => {
    expect(
      payoutProgress({ status: 'notStarted', settling: false, pendingCreditPence: undefined }),
    ).toBeNull();
  });

  it('draws nothing with nothing to set up, or nothing left to show', () => {
    expect(payoutProgress({ status: 'notStarted', settling: false, pendingCreditPence: null })).toBeNull();
    expect(payoutProgress({ status: 'ready', settling: false, pendingCreditPence: null })).toBeNull();
  });

  it('a reward waiting, nothing started: their details are the step', () => {
    expect(states({ status: 'notStarted', settling: false, pendingCreditPence: 19000 })).toEqual([
      'details:current',
      'check:upcoming',
      'payouts-on:upcoming',
      'reward:upcoming',
    ]);
  });

  it('names the reward by its amount', () => {
    const steps = payoutProgress({ status: 'notStarted', settling: false, pendingCreditPence: 19000 });
    expect(steps?.[3]?.label).toBe('Your £190 reward');
  });

  it('⚠️ unfinished waits on THEM, and says so', () => {
    const steps = payoutProgress({ status: 'unfinished', settling: false, pendingCreditPence: 19000 });
    expect(steps?.map((step) => `${step.id}:${step.state}`)).toEqual([
      'details:done',
      'check:current',
      'payouts-on:upcoming',
      'reward:upcoming',
    ]);
    expect(steps?.[1]?.detail).toMatch(/A few more details are needed from you. Your progress is saved/);
  });

  it('⚠️ verifying waits on Stripe, and says what happens next', () => {
    const steps = payoutProgress({ status: 'verifying', settling: false, pendingCreditPence: 19000 });
    expect(steps?.[1]?.state).toBe('current');
    expect(steps?.[1]?.detail).toMatch(/switch payouts on the moment/);
  });

  it('⚠️ a check holding the payout (2026-10-14): never "on its way", never why', () => {
    const steps = payoutProgress({
      status: 'ready',
      settling: false,
      pendingCreditPence: 19000,
      underReview: true,
    });
    expect(steps?.[3]?.state).toBe('current');
    expect(steps?.[3]?.detail).toMatch(/^A quick check before we send it/);
    expect(steps?.[3]?.detail).not.toMatch(/on its way —|bank may take/);
    expect(steps?.[3]?.detail).not.toMatch(/fraud|collusion|flag|suspicious/i);
  });

  it('…and once the check clears, "on its way" as before', () => {
    const steps = payoutProgress({ status: 'ready', settling: false, pendingCreditPence: 19000 });
    expect(steps?.[3]?.detail).toMatch(/^On its way/);
  });

  it('⚠️ Stripe waiting on THEM (2026-10-14): never "we\'ll switch payouts on"', () => {
    const steps = payoutProgress({
      status: 'verifying',
      settling: false,
      pendingCreditPence: 19000,
      needsAction: true,
    });
    expect(steps?.[1]?.state).toBe('current');
    expect(steps?.[1]?.detail).toMatch(/^Waiting on you/);
    expect(steps?.[1]?.detail).not.toMatch(/switch payouts on/);
  });

  it('settling: their details count as sent, and confirmation is awaited', () => {
    // A row with both flags false reads as "never started" until the webhook
    // lands; someone who just sent everything must not be told to start.
    const steps = payoutProgress({ status: 'notStarted', settling: true, pendingCreditPence: 19000 });
    expect(steps?.[0]?.state).toBe('done');
    expect(steps?.[1]?.detail).toMatch(/Waiting for confirmation/);
  });

  it('ready with a reward waiting: it is on its way — never "arrived"', () => {
    const steps = payoutProgress({ status: 'ready', settling: false, pendingCreditPence: 19000 });
    expect(steps?.map((step) => `${step.id}:${step.state}`)).toEqual([
      'details:done',
      'check:done',
      'payouts-on:done',
      'reward:current',
    ]);
    // We can't see a bank; nothing may claim we can.
    expect(steps?.[3]?.detail).not.toMatch(/arrived|in your account|paid/i);
  });

  it('an account with no reward waiting still tracks its own setup — three steps', () => {
    expect(states({ status: 'verifying', settling: false, pendingCreditPence: null })).toEqual([
      'details:done',
      'check:current',
      'payouts-on:upcoming',
    ]);
  });
});

describe('payoutProgress — a reward sent (PR2b)', () => {
  const sent = { transferPence: 19000, sentAt: '2026-10-13T11:00:00Z' };

  it('ends the road: every step done, the last one saying when', () => {
    const steps = payoutProgress({
      status: 'ready',
      settling: false,
      pendingCreditPence: null,
      latestPayout: sent,
    });
    expect(steps?.map((step) => `${step.id}:${step.state}`)).toEqual([
      'details:done',
      'check:done',
      'payouts-on:done',
      'reward:done',
    ]);
    expect(steps?.[3]?.label).toBe('Your £190 reward');
    expect(steps?.[3]?.detail).toMatch(/^Sent 13 October/);
  });

  it('⚠️ says "sent", never that it arrived — nothing here can see a bank', () => {
    const steps = payoutProgress({
      status: 'ready',
      settling: false,
      pendingCreditPence: null,
      latestPayout: sent,
    });
    expect(steps?.[3]?.detail).not.toMatch(/arrived|in your account|received/i);
  });

  it('a reward still waiting outranks one already sent — that is the road now', () => {
    const steps = payoutProgress({
      status: 'ready',
      settling: false,
      pendingCreditPence: 25000,
      latestPayout: sent,
    });
    expect(steps?.[3]?.state).toBe('current');
    expect(steps?.[3]?.label).toBe('Your £250 reward');
  });

  it('a sent reward is only the end of the road once payouts are on', () => {
    // Unreachable in practice (a release needs a payable account), but the
    // tracker must not draw "all done" over an account Stripe is checking.
    const steps = payoutProgress({
      status: 'verifying',
      settling: false,
      pendingCreditPence: null,
      latestPayout: sent,
    });
    expect(steps?.[1]?.state).toBe('current');
  });
});

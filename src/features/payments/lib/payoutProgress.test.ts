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
    expect(steps?.[1]?.detail).toMatch(/needs a few more details from you. Your progress is saved/);
  });

  it('⚠️ verifying waits on Stripe, and says what happens next', () => {
    const steps = payoutProgress({ status: 'verifying', settling: false, pendingCreditPence: 19000 });
    expect(steps?.[1]?.state).toBe('current');
    expect(steps?.[1]?.detail).toMatch(/switch payouts on the moment/);
  });

  it('settling: their details count as sent, and Stripe is confirming', () => {
    // A row with both flags false reads as "never started" until the webhook
    // lands; someone who just sent everything must not be told to start.
    const steps = payoutProgress({ status: 'notStarted', settling: true, pendingCreditPence: 19000 });
    expect(steps?.[0]?.state).toBe('done');
    expect(steps?.[1]?.detail).toMatch(/Waiting for Stripe to confirm/);
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

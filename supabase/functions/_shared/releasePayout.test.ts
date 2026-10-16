/**
 * WHAT:  Tests for the payout core's pure helpers — the charge a payout is
 *        drawn from, and the groups the payout deadline searches before it
 *        refunds.
 * WHY:   A payout is tied to its reward's charge (`source_transaction`,
 *        2026-10-16) so it never fails on a pending balance. Linking it moves
 *        the transfer into the CHARGE's group, which Stripe generates as
 *        `group_<payment intent>` — a deadline that still searched by post id
 *        alone would find nothing and refund a reward that was already paid.
 * LINKS: ./releasePayout.ts; ../release-held-refunds/index.ts.
 */

import type Stripe from 'npm:stripe@22.4.0';

import { payoutSourceCharge, payoutTransferGroups, splitBounty } from './releasePayout';

// The money core imports these at runtime; none of them is under test here.
jest.mock('./collusion.ts', () => ({ collusionGate: jest.fn() }));
jest.mock('./recoveryAnnounce.ts', () => ({
  announceNotCredited: jest.fn(),
  announcePayoutSent: jest.fn(),
  announceRecoveryToWatchers: jest.fn(),
}));

function charge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: 'ch_reward',
    status: 'succeeded',
    refunded: false,
    transfer_group: null,
    ...overrides,
  } as Stripe.Charge;
}

describe('payoutSourceCharge', () => {
  it('pays from a succeeded, unrefunded charge', () => {
    expect(payoutSourceCharge(charge())).toBe('ch_reward');
  });

  it('refuses when there is no charge to pay from', () => {
    expect(payoutSourceCharge(null)).toBeNull();
  });

  it('refuses an unexpanded charge id rather than guessing', () => {
    expect(payoutSourceCharge('ch_reward')).toBeNull();
  });

  it('refuses a charge that did not succeed', () => {
    expect(payoutSourceCharge(charge({ status: 'pending' }))).toBeNull();
    expect(payoutSourceCharge(charge({ status: 'failed' }))).toBeNull();
  });

  it('refuses a refunded charge — that money has gone back to the owner', () => {
    expect(payoutSourceCharge(charge({ refunded: true }))).toBeNull();
  });
});

describe('payoutTransferGroups', () => {
  it('searches the old post-id group AND the group Stripe generates for a linked payout', () => {
    expect(payoutTransferGroups('post-1', 'pi_1', null)).toEqual(['post-1', 'group_pi_1']);
  });

  it("adds the charge's own group when it has one", () => {
    expect(payoutTransferGroups('post-1', 'pi_1', 'custom')).toEqual([
      'post-1',
      'group_pi_1',
      'custom',
    ]);
  });

  it('never searches the same group twice', () => {
    expect(payoutTransferGroups('post-1', 'pi_1', 'group_pi_1')).toEqual(['post-1', 'group_pi_1']);
    expect(payoutTransferGroups('post-1', 'pi_1', 'post-1')).toEqual(['post-1', 'group_pi_1']);
  });
});

describe('splitBounty', () => {
  it('still pays 95% and keeps the remainder', () => {
    expect(splitBounty(25000)).toEqual({ transferPence: 23750, feePence: 1250 });
    expect(splitBounty(47500)).toEqual({ transferPence: 45125, feePence: 2375 });
  });
});

/**
 * WHAT:  Tests for readPayoutAccountState — whether Stripe says a payee
 *        account can be paid, for both generations of account.
 * WHY:   It is now what moves "Your details are being checked" to "Payouts
 *        on" when the webhook doesn't arrive. Reading the wrong flag for an
 *        account's generation would either strand a payable spotter or, worse,
 *        call an unpayable one ready — and release-payout would then fail at
 *        the transfer.
 * LINKS: supabase/functions/_shared/payoutAccountState.ts.
 */

import type Stripe from 'stripe';

import { readPayoutAccountState } from '../functions/_shared/payoutAccountState';

type Fake = {
  v2?: () => Promise<unknown>;
  v1?: () => Promise<unknown>;
};

const fakeStripe = ({ v2, v1 }: Fake) =>
  ({
    v2: { core: { accounts: { retrieve: jest.fn(v2 ?? (() => Promise.reject(new Error('no v2')))) } } },
    accounts: { retrieve: jest.fn(v1 ?? (() => Promise.reject(new Error('no v1')))) },
  }) as unknown as Stripe;

const v2Account = (status: string | undefined) => ({
  configuration: { recipient: status ? { capabilities: { stripe_balance: { payouts: { status } } } } : undefined },
});

describe('readPayoutAccountState', () => {
  it('a v2 recipient account is payable when its payouts capability is active', async () => {
    const stripe = fakeStripe({
      v2: async () => v2Account('active'),
      // v1's flag is false — for a v2 account it is not the one to trust.
      v1: async () => ({ payouts_enabled: false, details_submitted: false }),
    });
    await expect(readPayoutAccountState(stripe, 'acct_1')).resolves.toEqual({
      payoutsEnabled: true,
      detailsSubmitted: false,
    });
  });

  it('⚠️ a v2 account still pending is NOT payable, whatever v1 says', async () => {
    const stripe = fakeStripe({
      v2: async () => v2Account('pending'),
      v1: async () => ({ payouts_enabled: true, details_submitted: true }),
    });
    const state = await readPayoutAccountState(stripe, 'acct_1');
    expect(state?.payoutsEnabled).toBe(false);
  });

  it('a legacy account (no recipient configuration) reads v1’s payouts_enabled', async () => {
    const stripe = fakeStripe({
      v2: async () => v2Account(undefined),
      v1: async () => ({ payouts_enabled: true, details_submitted: true }),
    });
    await expect(readPayoutAccountState(stripe, 'acct_1')).resolves.toEqual({
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  });

  it('v2 unreadable: v1 decides', async () => {
    const stripe = fakeStripe({ v1: async () => ({ payouts_enabled: false, details_submitted: true }) });
    const state = await readPayoutAccountState(stripe, 'acct_1');
    expect(state).toEqual({ payoutsEnabled: false, detailsSubmitted: true });
  });

  it('v1 unreadable: the v2 capability still answers', async () => {
    const stripe = fakeStripe({ v2: async () => v2Account('active') });
    const state = await readPayoutAccountState(stripe, 'acct_1');
    expect(state?.payoutsEnabled).toBe(true);
  });

  it('nothing readable: null — the row stands rather than a guess', async () => {
    await expect(readPayoutAccountState(fakeStripe({}), 'acct_1')).resolves.toBeNull();
  });

  it('asks v2 for the recipient configuration it reads', async () => {
    const stripe = fakeStripe({ v2: async () => v2Account('active'), v1: async () => ({}) });
    await readPayoutAccountState(stripe, 'acct_9');
    expect(
      (stripe as unknown as { v2: { core: { accounts: { retrieve: jest.Mock } } } }).v2.core.accounts
        .retrieve,
    ).toHaveBeenCalledWith('acct_9', { include: ['configuration.recipient'] });
  });
});

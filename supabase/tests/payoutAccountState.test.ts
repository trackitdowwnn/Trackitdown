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

import {
  PLATFORM_URL,
  ensureBusinessUrl,
  readPayoutAccountState,
} from '../functions/_shared/payoutAccountState';

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
    await expect(readPayoutAccountState(stripe, 'acct_1')).resolves.toMatchObject({
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
    await expect(readPayoutAccountState(stripe, 'acct_1')).resolves.toMatchObject({
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  });

  it('v2 unreadable: v1 decides', async () => {
    const stripe = fakeStripe({ v1: async () => ({ payouts_enabled: false, details_submitted: true }) });
    const state = await readPayoutAccountState(stripe, 'acct_1');
    expect(state).toMatchObject({ payoutsEnabled: false, detailsSubmitted: true });
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
    ).toHaveBeenCalledWith('acct_9', { include: ['configuration.recipient', 'requirements'] });
  });
});

describe('the requirements we can meet ourselves (2026-10-13)', () => {
  const withRequirements = (descriptions: string[]) => ({
    configuration: { recipient: { capabilities: { stripe_balance: { payouts: { status: 'restricted' } } } } },
    requirements: { entries: descriptions.map((description) => ({ description })) },
  });

  it('reports a missing bank and a missing website — the account Stripe held', async () => {
    const stripe = fakeStripe({
      v2: async () => withRequirements(['defaults.profile.business_url', 'external_account']),
      v1: async () => ({ payouts_enabled: false, details_submitted: false }),
    });
    await expect(readPayoutAccountState(stripe, 'acct_1')).resolves.toEqual({
      payoutsEnabled: false,
      detailsSubmitted: false,
      needsBank: true,
      needsWebsite: true,
      // Both are ours to meet — neither is "one more thing from you".
      needsAction: false,
    });
  });

  it('asks for nothing it can’t see — a legacy account reports no needs', async () => {
    const stripe = fakeStripe({ v1: async () => ({ payouts_enabled: false, details_submitted: true }) });
    const state = await readPayoutAccountState(stripe, 'acct_1');
    expect(state).toMatchObject({ needsBank: false, needsWebsite: false, needsAction: false });
  });

  describe('who is waiting on whom (2026-10-14)', () => {
    const withEntries = (entries: object[]) => ({
      configuration: { recipient: { capabilities: { stripe_balance: { payouts: { status: 'restricted' } } } } },
      requirements: { entries },
    });
    const read = (entries: object[]) =>
      readPayoutAccountState(
        fakeStripe({ v2: async () => withEntries(entries), v1: async () => ({}) }),
        'acct_1',
      );

    it('⚠️ a photo ID Stripe is waiting on the spotter for: needsAction', async () => {
      const state = await read([
        {
          description: 'identity.individual.verification.document',
          awaiting_action_from: 'user',
          minimum_deadline: { status: 'currently_due' },
        },
      ]);
      expect(state?.needsAction).toBe(true);
    });

    it('past due counts too', async () => {
      const state = await read([
        {
          description: 'identity.individual.verification.document',
          awaiting_action_from: 'user',
          minimum_deadline: { status: 'past_due' },
        },
      ]);
      expect(state?.needsAction).toBe(true);
    });

    it('Stripe reviewing is NOT the spotter’s to act on — that is "being checked"', async () => {
      const state = await read([
        {
          description: 'identity.individual.verification.document',
          awaiting_action_from: 'stripe',
          minimum_deadline: { status: 'currently_due' },
        },
      ]);
      expect(state?.needsAction).toBe(false);
    });

    it('something only eventually due blocks nothing yet', async () => {
      const state = await read([
        {
          description: 'identity.individual.verification.document',
          awaiting_action_from: 'user',
          minimum_deadline: { status: 'eventually_due' },
        },
      ]);
      expect(state?.needsAction).toBe(false);
    });

    it('the bank and the website are ours to meet, never "one more thing from you"', async () => {
      const state = await read([
        { description: 'external_account', awaiting_action_from: 'user', minimum_deadline: { status: 'currently_due' } },
        {
          description: 'defaults.profile.business_url',
          awaiting_action_from: 'user',
          minimum_deadline: { status: 'currently_due' },
        },
      ]);
      expect(state).toMatchObject({ needsBank: true, needsWebsite: true, needsAction: false });
    });
  });

  it('supplies the platform’s website, and says whether it could', async () => {
    const update = jest.fn(async () => ({}));
    const stripe = { v2: { core: { accounts: { update } } } } as unknown as Stripe;
    await expect(ensureBusinessUrl(stripe, 'acct_7')).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith('acct_7', {
      defaults: { profile: { business_url: PLATFORM_URL } },
    });
    expect(PLATFORM_URL).toBe('https://trackitdown.co.uk');

    const failing = {
      v2: { core: { accounts: { update: jest.fn(async () => Promise.reject(new Error('no'))) } } },
    } as unknown as Stripe;
    await expect(ensureBusinessUrl(failing, 'acct_7')).resolves.toBe(false);
  });
});

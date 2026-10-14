/**
 * WHAT:  Tests for applyPayoutAccountState / syncPayoutAccountFromStripe — the
 *        one step that records Stripe's "can this spotter be paid?" and sends
 *        what they're owed when the answer first turns yes.
 * WHY:   It now runs from the webhook's v2 account events as well as the
 *        Payouts screen's check (2026-10-14). The money edge is the point: a
 *        release on every event would lean on idempotency for nothing, and a
 *        release after a FAILED write would pay against a row that still says
 *        "not payable". An event for an account we never recorded must touch
 *        nothing — the alternative is guessing whose money it is.
 * LINKS: supabase/functions/_shared/applyPayoutAccountState.ts;
 *        ./payoutAccountState.test.ts (the read, and the fake-Stripe pattern).
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  applyPayoutAccountState,
  syncPayoutAccountFromStripe,
  type RecordedPayoutAccount,
} from '../functions/_shared/applyPayoutAccountState';
import type { PayoutAccountState } from '../functions/_shared/payoutAccountState';

const recorded = (over: Partial<RecordedPayoutAccount> = {}): RecordedPayoutAccount => ({
  profileId: 'profile-1',
  accountId: 'acct_1',
  onboardingComplete: true,
  payoutsEnabled: false,
  ...over,
});

const fresh = (over: Partial<PayoutAccountState> = {}): PayoutAccountState => ({
  payoutsEnabled: false,
  detailsSubmitted: false,
  needsBank: false,
  needsProfile: false,
  needsAction: false,
  ...over,
});

/** A fake service-role client: the RPC, and one row (or none) for the lookup. */
const fakeAdmin = ({
  rpcError = null as { message: string } | null,
  row = null as Record<string, unknown> | null,
  lookupError = null as { message: string } | null,
} = {}) => {
  const rpc = jest.fn(async (_name: string, _args: unknown) => ({ error: rpcError }));
  const maybeSingle = jest.fn(async () => ({ data: row, error: lookupError }));
  const eq = jest.fn((_column: string, _value: string) => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn((_table: string) => ({ select }));
  return { admin: { rpc, from } as unknown as SupabaseClient, rpc, from, eq };
};

const v2Stripe = (status: string) =>
  ({
    v2: {
      core: {
        accounts: {
          retrieve: jest.fn(async () => ({
            configuration: { recipient: { capabilities: { stripe_balance: { payouts: { status } } } } },
            requirements: { entries: [] },
          })),
        },
      },
    },
    accounts: { retrieve: jest.fn(async () => ({ payouts_enabled: false, details_submitted: false })) },
  }) as unknown as Stripe;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('applyPayoutAccountState', () => {
  it('⚠️ just became payable: records it, THEN releases what they are owed', async () => {
    const { admin, rpc } = fakeAdmin();
    const order: string[] = [];
    rpc.mockImplementation(async () => {
      order.push('record');
      return { error: null };
    });
    const release = jest.fn(async (_profileId: string) => {
      order.push('release');
    });

    const result = await applyPayoutAccountState(admin, recorded(), fresh({ payoutsEnabled: true }), release);

    expect(result).toEqual({ ok: true, changed: true, becamePayable: true });
    expect(rpc).toHaveBeenCalledWith('upsert_connected_account', {
      p_profile_id: 'profile-1',
      p_stripe_account_id: 'acct_1',
      p_onboarding_complete: true,
      p_payouts_enabled: true,
    });
    expect(release).toHaveBeenCalledWith('profile-1');
    expect(order).toEqual(['record', 'release']);
  });

  it('still pending: nothing recorded, nothing released', async () => {
    const { admin, rpc } = fakeAdmin();
    const release = jest.fn(async () => {});
    const result = await applyPayoutAccountState(admin, recorded(), fresh(), release);
    expect(result).toEqual({ ok: true, changed: false, becamePayable: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('already payable: a repeat event releases nothing a second time', async () => {
    const { admin, rpc } = fakeAdmin();
    const release = jest.fn(async () => {});
    await applyPayoutAccountState(
      admin,
      recorded({ payoutsEnabled: true }),
      fresh({ payoutsEnabled: true }),
      release,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('⚠️ a failed write releases nothing — the row still says "not payable"', async () => {
    const { admin } = fakeAdmin({ rpcError: { message: 'boom' } });
    const release = jest.fn(async () => {});
    const result = await applyPayoutAccountState(admin, recorded(), fresh({ payoutsEnabled: true }), release);
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(release).not.toHaveBeenCalled();
  });

  it('records a payable account going OFF, and releases nothing', async () => {
    const { admin, rpc } = fakeAdmin();
    const release = jest.fn(async () => {});
    await applyPayoutAccountState(admin, recorded({ payoutsEnabled: true }), fresh(), release);
    expect(rpc).toHaveBeenCalledWith(
      'upsert_connected_account',
      expect.objectContaining({ p_payouts_enabled: false }),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('never un-submits: a recorded submission stands whatever v1 says', async () => {
    const { admin, rpc } = fakeAdmin();
    await applyPayoutAccountState(
      admin,
      recorded({ onboardingComplete: true }),
      fresh({ payoutsEnabled: true, detailsSubmitted: false }),
      jest.fn(async () => {}),
    );
    expect(rpc).toHaveBeenCalledWith(
      'upsert_connected_account',
      expect.objectContaining({ p_onboarding_complete: true }),
    );
  });
});

describe('syncPayoutAccountFromStripe (a v2 account event)', () => {
  it('finds our row by the Stripe id, reads Stripe, and releases on the edge', async () => {
    const { admin, from, eq } = fakeAdmin({
      row: { profile_id: 'profile-9', onboarding_complete: true, payouts_enabled: false },
    });
    const release = jest.fn(async () => {});

    const result = await syncPayoutAccountFromStripe(admin, v2Stripe('active'), 'acct_9', release);

    expect(from).toHaveBeenCalledWith('stripe_connected_accounts');
    expect(eq).toHaveBeenCalledWith('stripe_account_id', 'acct_9');
    expect(result).toEqual({ outcome: 'applied', changed: true, becamePayable: true });
    expect(release).toHaveBeenCalledWith('profile-9');
  });

  it('⚠️ an account we never recorded touches nothing and pays no one', async () => {
    const { admin, rpc } = fakeAdmin({ row: null });
    const stripe = v2Stripe('active');
    const release = jest.fn(async () => {});

    const result = await syncPayoutAccountFromStripe(admin, stripe, 'acct_stranger', release);

    expect(result).toEqual({ outcome: 'unknown_account' });
    expect(rpc).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(
      (stripe as unknown as { v2: { core: { accounts: { retrieve: jest.Mock } } } }).v2.core.accounts
        .retrieve,
    ).not.toHaveBeenCalled();
  });

  it('Stripe unreadable: says so, writes nothing (the webhook retries it)', async () => {
    const { admin, rpc } = fakeAdmin({
      row: { profile_id: 'profile-9', onboarding_complete: true, payouts_enabled: false },
    });
    const unreadable = {
      v2: { core: { accounts: { retrieve: jest.fn(async () => Promise.reject(new Error('down'))) } } },
      accounts: { retrieve: jest.fn(async () => Promise.reject(new Error('down'))) },
    } as unknown as Stripe;
    const release = jest.fn(async () => {});

    await expect(syncPayoutAccountFromStripe(admin, unreadable, 'acct_9', release)).resolves.toEqual({
      outcome: 'unreadable',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('our side failing throws, so the webhook answers 500 and Stripe redelivers', async () => {
    const lookupFails = fakeAdmin({ lookupError: { message: 'db down' } });
    await expect(
      syncPayoutAccountFromStripe(lookupFails.admin, v2Stripe('active'), 'acct_9', jest.fn()),
    ).rejects.toThrow('payout account lookup failed: db down');

    const writeFails = fakeAdmin({
      row: { profile_id: 'profile-9', onboarding_complete: true, payouts_enabled: false },
      rpcError: { message: 'nope' },
    });
    const release = jest.fn(async () => {});
    await expect(
      syncPayoutAccountFromStripe(writeFails.admin, v2Stripe('active'), 'acct_9', release),
    ).rejects.toThrow('payout account write failed: nope');
    expect(release).not.toHaveBeenCalled();
  });
});

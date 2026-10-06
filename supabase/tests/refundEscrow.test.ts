/**
 * WHAT:  Tests for the one refund implementation (`_shared/refundEscrow.ts`):
 *        the per-payment idempotency key, the amount rule (the FIXED card fee,
 *        ADR-0021, and that it matches the app's pre-payment quote for every
 *        amount), and that a fee can never be refunded.
 * WHY:   Tier 1 money (docs/TESTING.md), and the key changed on 2026-10-05
 *        from per-POST to per-PAYMENT so a renewable reward cannot collide
 *        inside Stripe's idempotency window. Stripe rejects a reused key whose
 *        parameters differ, and three paths (deactivate, recovery, the sweep)
 *        can refund one payment — so these pin that every parameter is a
 *        function of the payment alone. Importable from Jest because the
 *        module's only imports are `import type` (see push.test.ts).
 * LINKS: supabase/functions/_shared/refundEscrow.ts;
 *        supabase/migrations/20261005110000_a_reward_can_be_replaced.sql;
 *        supabase/tests/reward_ledger_verification.sql (the SQL half).
 */

import { cardFeePence as appCardFeePence } from '../../src/shared/lib/money';
import {
  cardFeePence,
  refundAmountPence,
  refundHeldEscrow,
  refundIdempotencyKey,
  refundPayment,
  refundSupersededForPost,
} from '../functions/_shared/refundEscrow';

type Row = Record<string, unknown> | null;

/** A stand-in for the service-role client's `.from('payments')` chain that
 *  records every filter, so a test can assert the ledger read itself. */
function fakeAdmin(row: Row, error: { message: string } | null = null) {
  const filters: [string, string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push(['eq', column, value]);
      return chain;
    },
    in: (column: string, value: unknown) => {
      filters.push(['in', column, value]);
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: row, error }),
  };
  return { admin: { from: jest.fn(() => chain) }, filters };
}

function fakeStripe(
  feePence: number | null,
  refundId = 're_test',
  existing: { id: string; status: string; amount: number }[] = [],
) {
  const create = jest.fn((_params: Record<string, unknown>, _opts: Record<string, unknown>) =>
    Promise.resolve({ id: refundId }),
  );
  const list = jest.fn(() => Promise.resolve({ data: existing }));
  const retrieve = jest.fn(() =>
    Promise.resolve({
      latest_charge: feePence === null ? null : { balance_transaction: { fee: feePence } },
    }),
  );
  return { stripe: { paymentIntents: { retrieve }, refunds: { create, list } }, create, list, retrieve };
}

// The fakes satisfy only the slice the module touches; the cast is the
// boundary, exactly as in push.test.ts.
type Any = any;

// The failure-path tests make the module log, which is its job; keep the run quiet.
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const HELD = {
  stripe_payment_intent_id: 'pi_abc',
  post_id: 'post-1',
  amount_pence: 20000,
  refund_fee_absorbed: false,
};

describe('refundIdempotencyKey', () => {
  it('is the payment, not the post — the shape every path must share', () => {
    expect(refundIdempotencyKey('pi_abc')).toBe('payment-refund-pi_abc');
  });
});

describe('cardFeePence (ADR-0021)', () => {
  it('is a fixed 1.5% + 20p — £3.20 on £200, £75.20 on £5,000, 35p on £10', () => {
    expect(cardFeePence(20000)).toBe(320);
    expect(cardFeePence(500000)).toBe(7520);
    expect(cardFeePence(1000)).toBe(35);
  });

  // THE PROMISE: the figure the app quotes before payment is the figure the
  // refund withholds. Two copies of one formula (Deno can't import the app),
  // so every reward amount is checked, in whole pounds as the slider emits
  // and at odd pence too.
  it('agrees with the app’s quote for every reward amount', () => {
    for (let pence = 1000; pence <= 500000; pence += 100) {
      expect(cardFeePence(pence)).toBe(appCardFeePence(pence));
    }
    for (const pence of [1001, 1033, 12345, 33333, 499999]) {
      expect(cardFeePence(pence)).toBe(appCardFeePence(pence));
    }
  });
});

describe('refundAmountPence', () => {
  it('withholds the fixed card fee when the owner bears it', () => {
    expect(refundAmountPence(20000, false)).toBe(19680);
    expect(refundAmountPence(1000, false)).toBe(965);
  });

  it('returns the full amount when the fee is absorbed (a stray, or a legacy reward)', () => {
    expect(refundAmountPence(20000, true)).toBe(20000);
  });

  it('refuses a refund that would be zero, negative or more than was paid', () => {
    expect(refundAmountPence(20, false)).toBeNull();
    expect(refundAmountPence(0, true)).toBeNull();
    expect(refundAmountPence(-100, true)).toBeNull();
  });
});

describe('refundPayment', () => {
  it('refunds amount − fee under the payment key with per-payment metadata only', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(320);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toEqual({
      status: 'refunded',
      refundId: 're_test',
      refundPence: 19680,
      feePence: 320,
      paymentIntentId: 'pi_abc',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [params, opts] = create.mock.calls[0];
    expect(params).toEqual({ payment_intent: 'pi_abc', amount: 19680, metadata: { post_id: 'post-1' } });
    expect(opts).toEqual({ idempotencyKey: 'payment-refund-pi_abc' });
  });

  it('refunds in full when the fee is absorbed, and reports no fee withheld', async () => {
    const { admin } = fakeAdmin({ ...HELD, refund_fee_absorbed: true });
    const { stripe, create } = fakeStripe(320);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toMatchObject({ status: 'refunded', refundPence: 20000, feePence: 0 });
    expect(create.mock.calls[0][0]).toMatchObject({ amount: 20000 });
  });

  it('reads only a held or superseded REWARD — never a listing fee', async () => {
    const { admin, filters } = fakeAdmin(HELD);
    const { stripe } = fakeStripe(320);

    await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(filters).toContainEqual(['eq', 'stripe_payment_intent_id', 'pi_abc']);
    expect(filters).toContainEqual(['in', 'status', ['held', 'superseded']]);
    expect(filters).toContainEqual(['eq', 'kind', 'bounty_escrow']);
  });

  it('returns a refund that already moved the money instead of asking for another', async () => {
    // e.g. issued under the old per-post key before this deployed, or >24h ago.
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(320, 're_new', [
      { id: 're_failed', status: 'failed', amount: 19680 },
      { id: 're_old', status: 'succeeded', amount: 19680 },
    ]);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toEqual({
      status: 'refunded',
      refundId: 're_old',
      refundPence: 19680,
      feePence: 320,
      paymentIntentId: 'pi_abc',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores a failed refund and issues a real one', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(320, 're_new', [
      { id: 're_failed', status: 'failed', amount: 19680 },
    ]);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toMatchObject({ status: 'refunded', refundId: 're_new' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  // ADR-0021: the owner gets back exactly what they were quoted, whatever the
  // card actually cost. A premium/international card's higher Stripe fee is
  // Trackitdown's to absorb, and an unreadable fee no longer blocks a refund.
  it('refunds exactly the quoted amount even when the card cost Stripe more', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(700);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toMatchObject({ status: 'refunded', refundPence: 19680, feePence: 320 });
    expect(create.mock.calls[0][0]).toMatchObject({ amount: 19680 });
  });

  it('does not need Stripe’s fee to refund — and never asks for it', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create, retrieve } = fakeStripe(null);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toMatchObject({ status: 'refunded', refundPence: 19680 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(retrieve).not.toHaveBeenCalled();
  });

  // A refund made by hand for LESS than the quote (e.g. "reward minus Stripe's
  // fee", the old rule, on a dearer card) is recorded, but flagged: the owner
  // was promised the fixed-fee figure (ADR-0021, docs/OPERATIONS.md).
  it('flags a hand refund below the quoted figure as an ops alert', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(null, 're_new', [
      { id: 're_hand', status: 'succeeded', amount: 19300 },
    ]);
    const errors = jest.spyOn(console, 'error');

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toMatchObject({ status: 'refunded', refundId: 're_hand', refundPence: 19300, feePence: 700 });
    expect(create).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('[ops] ALERT partial refund'),
      expect.objectContaining({ refundedPence: 19300, expectedPence: 19680 }),
    );
  });

  it('issues nothing when no refundable payment matches', async () => {
    const { admin } = fakeAdmin(null);
    const { stripe, create } = fakeStripe(320);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_gone' });

    expect(outcome).toEqual({ status: 'no_held_payment' });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a ledger read failure as retryable, with no refund', async () => {
    const { admin } = fakeAdmin(null, { message: 'boom' });
    const { stripe, create } = fakeStripe(320);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toEqual({ status: 'lookup_failed' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('refundSupersededForPost', () => {
  it('refunds only THIS post’s superseded payments, superseded-only, and records each through reconcile', async () => {
    const { admin, filters } = fakeAdmin({ ...HELD, stripe_payment_intent_id: 'pi_old' });
    const rpc = jest.fn((name: string) =>
      Promise.resolve(
        name === 'refunds_due'
          ? {
              data: [
                { payment_intent_id: 'pi_old', post_id: 'post-1', reason: 'superseded' },
                { payment_intent_id: 'pi_other_post', post_id: 'post-2', reason: 'superseded' },
                { payment_intent_id: 'pi_hold', post_id: 'post-1', reason: 'deactivate' },
              ],
              error: null,
            }
          : { data: 'superseded_refunded', error: null },
      ),
    );
    const { stripe, create } = fakeStripe(320, 're_old');

    const refunded = await refundSupersededForPost({ ...admin, rpc } as Any, stripe as Any, 'post-1');

    expect(rpc).toHaveBeenCalledWith('refunds_due', { p_limit: 50, p_post_id: 'post-1' });
    expect(refunded).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: 'payment-refund-pi_old' });
    expect(filters).toContainEqual(['in', 'status', ['superseded']]);
    expect(rpc).toHaveBeenCalledWith('reconcile_payment_refund', {
      p_payment_intent_id: 'pi_old',
      p_refund_id: 're_old',
      p_refunded_amount_pence: 19680,
    });
  });

  it('never throws — a failed list is a zero, and the sweep retries', async () => {
    const { admin } = fakeAdmin(HELD);
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    const { stripe, create } = fakeStripe(320);

    await expect(refundSupersededForPost({ ...admin, rpc } as Any, stripe as Any, 'post-1')).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('refundHeldEscrow', () => {
  it('finds the post’s held reward and refunds it with the SAME key the sweep would use', async () => {
    // One fake answers both reads (the held lookup, then the payment read).
    const { admin, filters } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(320);

    const outcome = await refundHeldEscrow(admin as Any, stripe as Any, { postId: 'post-1' });

    expect(outcome).toMatchObject({ status: 'refunded', paymentIntentId: 'pi_abc' });
    expect(filters).toContainEqual(['eq', 'post_id', 'post-1']);
    expect(filters).toContainEqual(['eq', 'status', 'held']);
    // The re-read is narrowed too: a payment superseded in between is not
    // refunded by an owner exit.
    expect(filters).toContainEqual(['in', 'status', ['held']]);
    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: refundIdempotencyKey('pi_abc') });
  });
});

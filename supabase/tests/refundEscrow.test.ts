/**
 * WHAT:  Tests for the one refund implementation (`_shared/refundEscrow.ts`):
 *        the per-payment idempotency key, the amount rule, the fail-closed
 *        fee read, and that a fee can never be refunded.
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

import {
  refundAmountPence,
  refundHeldEscrow,
  refundIdempotencyKey,
  refundPayment,
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

describe('refundAmountPence', () => {
  it('withholds the exact card fee when the owner bears it', () => {
    expect(refundAmountPence(20000, 320, false)).toBe(19680);
  });

  it('returns the full amount when the fee is absorbed (a stray, or a legacy reward)', () => {
    expect(refundAmountPence(20000, 320, true)).toBe(20000);
  });

  it('refuses a refund that would be zero, negative or more than was paid', () => {
    expect(refundAmountPence(300, 320, false)).toBeNull();
    expect(refundAmountPence(320, 320, false)).toBeNull();
    expect(refundAmountPence(20000, -5, false)).toBeNull();
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

  it('fails closed, with no refund, when Stripe will not say what the fee was', async () => {
    const { admin } = fakeAdmin(HELD);
    const { stripe, create } = fakeStripe(null);

    const outcome = await refundPayment(admin as Any, stripe as Any, { paymentIntentId: 'pi_abc' });

    expect(outcome).toEqual({ status: 'stripe_error' });
    expect(create).not.toHaveBeenCalled();
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

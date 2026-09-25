/**
 * WHAT:  Tests for the payments API layer — createBountyPaymentIntent's happy
 *        path (returns the client secret), its { code }→message translation for
 *        the create-payment-intent Edge Function errors, the missing-secret
 *        guard, and the MONEY invariant that the call carries ONLY the post id
 *        (never an amount the client chose).
 * WHY:   The client must never send the charge amount (SECURITY_AND_TRUST §4);
 *        that rule lives in this file's invoke body and is pinned here. The
 *        error mapping is what the wizard shows the user, so it's covered too.
 * LINKS: src/features/payments/api/paymentsApi.ts, docs/TESTING.md.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { PaymentError, createBountyPaymentIntent, deactivatePost } from './paymentsApi';

const mockInvoke = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

/** Build a FunctionsHttpError whose response body is the given { error, code }. */
function httpError(body: unknown): FunctionsHttpError {
  const context = { json: () => Promise.resolve(body) } as unknown as Response;
  return new FunctionsHttpError(context);
}

beforeEach(() => jest.clearAllMocks());

/** The total the pay button showed: a £500 reward plus the 5% fee on top. */
const SHOWN = 52500;
const priced = (amountPence: number = SHOWN) => ({
  data: { clientSecret: 'pi_secret_123', amountPence },
  error: null,
});

describe('createBountyPaymentIntent', () => {
  it('returns the client secret on success', async () => {
    mockInvoke.mockResolvedValue(priced());
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).resolves.toBe('pi_secret_123');
  });

  it('MONEY: sends the post id and the pricing acknowledgement — never an amount', async () => {
    mockInvoke.mockResolvedValue(priced());
    await createBountyPaymentIntent(POST_ID, SHOWN);
    expect(mockInvoke).toHaveBeenCalledWith('create-payment-intent', {
      body: { postId: POST_ID, pricing: 'fee_on_top' },
    });
    const [, options] = mockInvoke.mock.calls[0];
    expect(Object.keys(options.body).sort()).toEqual(['postId', 'pricing']);
  });

  // The sheet must never open on a sum the owner did not see. The server's
  // price is what is charged; this guard only refuses to proceed when the two
  // disagree, so the owner hears "the amount changed" instead of finding out.
  it('MONEY: refuses to hand back a secret when the server priced a different total', async () => {
    mockInvoke.mockResolvedValue(priced(50000));
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({
      code: 'PRICE_MISMATCH',
      message: 'The amount changed. Check the total and try again.',
    });
  });

  it('treats a response with no priced total as a mismatch, not a match', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret_123' }, error: null });
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({
      code: 'PRICE_MISMATCH',
    });
  });

  it('maps a known error code to its user-facing message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'raw', code: 'POST_NOT_DRAFT' }),
    });
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({
      code: 'POST_NOT_DRAFT',
      message: 'This listing has already been paid for.',
    });
  });

  it('explains UPGRADE_REQUIRED in plain words', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'raw', code: 'UPGRADE_REQUIRED' }),
    });
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({
      code: 'UPGRADE_REQUIRED',
      message: 'Update the app to post a listing with a reward.',
    });
  });

  it('falls back to the function-supplied message for an unknown code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'Something specific', code: 'WEIRD' }),
    });
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({
      code: 'WEIRD',
      message: 'Something specific',
    });
  });

  it('does not resolve an inherited Object key (e.g. "constructor") to a function', async () => {
    // Bracket access on the message map would otherwise return Object.prototype's
    // `constructor`; the own-property gate must fall through to body.error.
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'Fallback copy', code: 'constructor' }),
    });
    const err = await createBountyPaymentIntent(POST_ID, SHOWN).catch((e) => e);
    expect(err.code).toBe('constructor');
    expect(err.message).toBe('Fallback copy');
  });

  it('throws a NETWORK PaymentError when the relay errors with no HTTP body', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') });
    const err = await createBountyPaymentIntent(POST_ID, SHOWN).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe('NETWORK');
  });

  it('throws BAD_SHAPE when the function returns no client secret', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(createBountyPaymentIntent(POST_ID, SHOWN)).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });
});

describe('deactivatePost', () => {
  it('returns the server refund figures on success', async () => {
    mockInvoke.mockResolvedValue({
      data: { held: false, refundedPence: 49230, feePence: 770 },
      error: null,
    });
    await expect(deactivatePost(POST_ID)).resolves.toEqual({
      held: false,
      refundedPence: 49230,
      feePence: 770,
    });
  });

  it('returns the held answer with its date when the refund must wait', async () => {
    mockInvoke.mockResolvedValue({
      data: { held: true, refundAfter: '2026-08-08T12:00:00Z' },
      error: null,
    });
    await expect(deactivatePost(POST_ID)).resolves.toEqual({
      held: true,
      refundAfter: '2026-08-08T12:00:00Z',
    });
  });

  it('MONEY: sends only the post id — never a refund amount', async () => {
    mockInvoke.mockResolvedValue({
      data: { held: false, refundedPence: 49230, feePence: 770 },
      error: null,
    });
    await deactivatePost(POST_ID);
    expect(mockInvoke).toHaveBeenCalledWith('deactivate-post', { body: { postId: POST_ID } });
    const [, options] = mockInvoke.mock.calls[0];
    expect(Object.keys(options.body)).toEqual(['postId']);
  });

  it('MONEY: the attested call carries ids and still never an amount', async () => {
    mockInvoke.mockResolvedValue({
      data: { held: true, refundAfter: '2026-08-08T12:00:00Z' },
      error: null,
    });
    await deactivatePost(POST_ID, ['s-1', 's-2']);
    const [, options] = mockInvoke.mock.calls[0];
    expect(Object.keys(options.body).sort()).toEqual(['attestedSightingIds', 'postId']);
  });

  it('maps a known error code to its user-facing message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'raw', code: 'POST_NOT_REFUNDABLE' }),
    });
    await expect(deactivatePost(POST_ID)).rejects.toMatchObject({
      code: 'POST_NOT_REFUNDABLE',
      message: 'This listing can’t be deactivated for a refund.',
    });
  });

  it('throws BAD_SHAPE when the function returns no refund amount', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(deactivatePost(POST_ID)).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('throws a NETWORK PaymentError when the relay errors with no HTTP body', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') });
    const err = await deactivatePost(POST_ID).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe('NETWORK');
  });
});

/**
 * WHAT:  Tests for the payouts API layer — the three onboarding outcomes, the
 *        { code }→message translation, the malformed-body guard, reading my own
 *        payee account, and the SECURITY invariant that the onboarding call
 *        carries no account id at all.
 * WHY:   This is the boundary that decides who gets paid. The account must
 *        always be resolved from the caller's JWT server-side; a payee id that
 *        could travel over the wire is a payee id someone could change, and the
 *        only thing keeping that true on this side is the absence of a body.
 *        That absence is invisible in review, so it is pinned here.
 * LINKS: ./payoutsApi.ts; supabase/functions/connect-onboarding/index.ts;
 *        docs/TESTING.md.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { PaymentError } from '@/shared/lib/functionError';
import {
  fetchMyPayoutAccount,
  fetchPayoutsRelevant,
  startConnectOnboarding,
  submitPayoutDetails,
} from './payoutsApi';

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
jest.mock('@/shared/api', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    from: (...args: unknown[]) => mockFrom(...(args as [])),
    rpc: (...args: unknown[]) => mockRpc(...(args as [])),
  },
}));

// Every log call is captured, because one of the tests below is about what
// must NEVER appear in one.
const mockLogCalls: unknown[][] = [];
const capture = (...args: unknown[]) => {
  mockLogCalls.push(args);
};
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => capture(...args),
    warn: (...args: unknown[]) => capture(...args),
    debug: (...args: unknown[]) => capture(...args),
    error: (...args: unknown[]) => capture(...args),
  }),
}));

const USER_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';

/** Build a FunctionsHttpError whose response body is the given { error, code }. */
function httpError(body: unknown): FunctionsHttpError {
  const context = { json: () => Promise.resolve(body) } as unknown as Response;
  return new FunctionsHttpError(context);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogCalls.length = 0;
});

const DETAILS = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dob: '1990-04-01',
  phone: '07700900123',
  addressLine1: '12 Bridge Street',
  city: 'Manchester',
  postalCode: 'M1 1AA',
  sortCode: '108800',
  accountNumber: '00012345',
};

describe('startConnectOnboarding', () => {
  it('SECURITY: sends no account id — the payee is resolved from the JWT', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'already_enabled' }, error: null });
    await startConnectOnboarding();
    // No body. An account id the client could send is an account id the client
    // could change.
    expect(mockInvoke).toHaveBeenCalledWith('connect-onboarding', undefined);
  });

  it('sends ONLY an intent when skipping prefill — never an identity', async () => {
    // The escape hatch for someone our UK-individual form cannot describe. It
    // says what to do, not who to do it to: the account still comes from the
    // JWT, so nothing about who gets paid travels over the wire.
    mockInvoke.mockResolvedValue({
      data: { status: 'onboarding_session', clientSecret: 'accs_1' },
      error: null,
    });
    await startConnectOnboarding({ skipPrefill: true });

    const [, options] = mockInvoke.mock.calls[0];
    expect(Object.keys(options.body)).toEqual(['skipPrefill']);
  });

  it('returns the in-app onboarding session — the normal setup path', async () => {
    mockInvoke.mockResolvedValue({
      data: { status: 'onboarding_session', clientSecret: 'accs_secret_123' },
      error: null,
    });
    await expect(startConnectOnboarding()).resolves.toEqual({
      status: 'onboarding_session',
      clientSecret: 'accs_secret_123',
    });
  });

  it('rejects a secret-less session rather than mounting a component that cannot load', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'onboarding_session' }, error: null });
    await expect(startConnectOnboarding()).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('returns the onboarding link', async () => {
    mockInvoke.mockResolvedValue({
      data: { status: 'onboarding_required', url: 'https://connect.stripe.com/setup/abc' },
      error: null,
    });
    await expect(startConnectOnboarding()).resolves.toEqual({
      status: 'onboarding_required',
      url: 'https://connect.stripe.com/setup/abc',
    });
  });

  it('returns an update link for an account that is already payable', async () => {
    mockInvoke.mockResolvedValue({
      data: { status: 'update_available', url: 'https://connect.stripe.com/update/abc' },
      error: null,
    });
    await expect(startConnectOnboarding()).resolves.toEqual({
      status: 'update_available',
      url: 'https://connect.stripe.com/update/abc',
    });
  });

  it('reports already_enabled with no link — there is nothing to open', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'already_enabled' }, error: null });
    await expect(startConnectOnboarding()).resolves.toEqual({ status: 'already_enabled' });
  });

  it('maps a known error code to its user-facing message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'nope', code: 'NOT_AUTHENTICATED' }),
    });
    await expect(startConnectOnboarding()).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
      message: 'You need to be signed in to set up payouts.',
    });
  });

  it('falls back to the server line for an unmapped code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'Something specific from the server', code: 'WEIRD' }),
    });
    await expect(startConnectOnboarding()).rejects.toMatchObject({
      code: 'WEIRD',
      message: 'Something specific from the server',
    });
  });

  it('reports a transport failure as NETWORK', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(startConnectOnboarding()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('rejects a link-less onboarding_required rather than waiting forever', async () => {
    // The screen opens a browser with whatever comes back; a missing url would
    // leave it waiting on a window that never appears.
    mockInvoke.mockResolvedValue({ data: { status: 'onboarding_required' }, error: null });
    await expect(startConnectOnboarding()).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('rejects an unrecognised status', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'something_new' }, error: null });
    await expect(startConnectOnboarding()).rejects.toBeInstanceOf(PaymentError);
  });
});

describe('submitPayoutDetails', () => {
  it('NEVER logs the bank details — not masked, not partially, not at all', async () => {
    // The single most important assertion in this file. These numbers pass
    // through our server on their way to Stripe and must leave no trace; a
    // masked tail in a log is still an account number in a log.
    mockInvoke.mockResolvedValue({ data: { status: 'submitted' }, error: null });
    await submitPayoutDetails(DETAILS);

    const logged = JSON.stringify(mockLogCalls);
    expect(logged).not.toContain(DETAILS.accountNumber);
    expect(logged).not.toContain(DETAILS.sortCode);
    expect(logged).not.toContain(DETAILS.dob);
    expect(logged).not.toContain(DETAILS.lastName);
    expect(logged).not.toContain(DETAILS.postalCode);
  });

  it('logs nothing about the details on failure either', async () => {
    // The error path is where a well-meaning "log the body so we can debug it"
    // usually gets added.
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'nope', code: 'DETAILS_REJECTED' }),
    });
    await expect(submitPayoutDetails(DETAILS)).rejects.toBeInstanceOf(PaymentError);

    const logged = JSON.stringify(mockLogCalls);
    expect(logged).not.toContain(DETAILS.accountNumber);
    expect(logged).not.toContain(DETAILS.sortCode);
  });

  it('SECURITY: sends no account id — the payee comes from the JWT', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'submitted' }, error: null });
    await submitPayoutDetails(DETAILS);

    const [, options] = mockInvoke.mock.calls[0];
    expect(Object.keys(options.body)).not.toContain('accountId');
    expect(Object.keys(options.body)).not.toContain('stripeAccountId');
  });

  it('maps a rejection to copy that tells them to check, not to give up', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'nope', code: 'DETAILS_REJECTED' }),
    });
    await expect(submitPayoutDetails(DETAILS)).rejects.toMatchObject({
      code: 'DETAILS_REJECTED',
      message: expect.stringContaining('check them'),
    });
  });

  it('says the details ARE saved when only our note of it failed', async () => {
    // The details reached Stripe; only the gate flag did not. Telling them it
    // failed would send them to re-enter a bank account Stripe already has.
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'nope', code: 'LEDGER_ERROR' }),
    });
    await expect(submitPayoutDetails(DETAILS)).rejects.toMatchObject({
      message: expect.stringContaining('saved'),
    });
  });
});

describe('fetchMyPayoutAccount', () => {
  it('returns null when there is no row — the normal state before setup', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyPayoutAccount(USER_ID)).resolves.toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('stripe_connected_accounts');
    expect(mockEq).toHaveBeenCalledWith('profile_id', USER_ID);
  });

  it('maps the row to camelCase', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        stripe_account_id: 'acct_123',
        onboarding_complete: true,
        payouts_enabled: false,
      },
      error: null,
    });
    await expect(fetchMyPayoutAccount(USER_ID)).resolves.toEqual({
      stripeAccountId: 'acct_123',
      onboardingComplete: true,
      payoutsEnabled: false,
    });
  });

  it('throws on a read failure rather than reporting "not set up"', async () => {
    // Reporting a failed read as "no account" would invite someone who is
    // already onboarded to do it all again.
    mockMaybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST301' } });
    await expect(fetchMyPayoutAccount(USER_ID)).rejects.toBeInstanceOf(PaymentError);
  });
});

describe('fetchPayoutsRelevant', () => {
  it('asks the caller-scoped RPC and returns its boolean', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchPayoutsRelevant()).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('payouts_relevant');
  });

  it('hides the row on error — a missing convenience beats a false invitation', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST301' } });
    await expect(fetchPayoutsRelevant()).resolves.toBe(false);
  });

  it('treats anything but literal true as not relevant', async () => {
    // A null answer (or a shape change) must fail toward hidden, never shown.
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPayoutsRelevant()).resolves.toBe(false);
  });
});

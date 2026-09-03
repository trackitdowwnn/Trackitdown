/**
 * WHAT:  Tests for the payout tokenisers — the request each one builds, and the
 *        privacy properties that are the entire reason this file exists.
 * WHY:   ⚠️ THIS FILE HAD NO COVERAGE AT ALL until 2026-09-02, and it is 155
 *        lines that handle a DATE OF BIRTH, a HOME ADDRESS, a SORT CODE and an
 *        ACCOUNT NUMBER. The whole-app review named it as the sharpest of the
 *        untested files: money and PII in one place, with nothing pinning any
 *        of its behaviour.
 *
 *        Three properties here are load-bearing rather than incidental, and
 *        each would fail SILENTLY:
 *
 *        1. **Nothing is ever logged.** Not the values, not the token ids, not
 *           the response body on failure. A `console.error(body)` added in a
 *           hurry would ship a sort code to whatever collects logs, and no
 *           other test in the repo would notice.
 *        2. **The error copy is fixed.** Stripe's rejection body can echo the
 *           identity values it rejected, so reading it into a message would put
 *           someone's date of birth in a toast.
 *        3. **ToS acceptance rides the token.** Stripe infers the acceptance
 *           date and IP from the client call carrying `shown_and_accepted`. If
 *           that flag stopped being sent, onboarding would fail in a way whose
 *           cause is a legal record, not a bug report.
 *
 *        The request SHAPE is pinned too, because these are the only calls in
 *        the app that talk to Stripe directly rather than through an Edge
 *        Function — nothing server-side would catch a wrong field name, and the
 *        symptom is an account that silently never becomes payable.
 * LINKS: ./stripeTokens.ts; docs/decisions/ADR-0010-whitelabel-payouts.md;
 *        supabase/functions/create-payout-account/index.ts (where the ids go);
 *        docs/TESTING.md (Tier 1: money paths).
 */

import { PaymentError } from '@/shared/lib/functionError';
import type { PayoutDetails } from './payoutsApi';

const mockCreateToken = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  createToken: (...args: unknown[]) => mockCreateToken(...args),
}));

// ⚠️ The key is read at MODULE SCOPE, and jest does not load .env — so a static
// import of stripeTokens would capture '' and every test would hit the
// NO_PUBLISHABLE_KEY guard instead of the code it means to exercise. Set the
// env first, import after. (That module-scope read is also why the missing-key
// test at the bottom has to reset the module registry.)
process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';

// `require`, not a dynamic `import()`: this jest config runs without
// --experimental-vm-modules, so an await import() throws before any test runs.
const { createIdentityToken, createBankToken } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load AFTER the env assignment above
  require('./stripeTokens') as typeof import('./stripeTokens');

const details: PayoutDetails = {
  firstName: 'Alex',
  lastName: 'Mercer',
  dob: '1990-04-07',
  phone: '+447700900000',
  addressLine1: '12 Oak Street',
  addressLine2: 'Flat 3',
  city: 'Manchester',
  postalCode: 'M1 2AB',
  sortCode: '108800',
  accountNumber: '00012345',
};

/** Every value in `details` that a person would be upset to find in a log. */
const SECRETS = [
  '1990-04-07',
  '12 Oak Street',
  'M1 2AB',
  '108800',
  '00012345',
  '+447700900000',
];

const originalFetch = globalThis.fetch;
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  mockCreateToken.mockReset();
  // Spy on EVERY console method: the assertion is that this module is silent,
  // and "silent" cannot mean "silent on the two methods we remembered".
  consoleSpies.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  globalThis.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; body?: unknown }) {
  const fetchMock = jest.fn(async () => ({
    ok: response.ok,
    json: async () => response.body ?? {},
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Everything the console was handed, as one searchable string. */
function everythingLogged(): string {
  return JSON.stringify(consoleSpies.map((spy) => spy.mock.calls));
}

describe('createIdentityToken', () => {
  it('posts to the v2 account_tokens endpoint with the mandatory version header', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 'ct_123' } });

    await expect(createIdentityToken(details, 'alex@example.com')).resolves.toBe('ct_123');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v2/core/account_tokens');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    // ⚠️ Stripe rejects every /v2 call without this header. Its absence is a
    // 400 that looks like a details problem, so it would be debugged in the
    // wrong place.
    expect(headers['Stripe-Version']).toBe('2026-03-25.dahlia');
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it('⚠️ carries the ToS acceptance, which is what makes it a legal record', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 'ct_123' } });
    await createIdentityToken(details, 'alex@example.com');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Stripe observes the acceptance DATE and IP from this request. Moving the
    // flag server-side would make both our claims rather than observed facts,
    // and would record the acceptance on the wrong machine (ADR-0010).
    expect(
      body.identity.attestations.terms_of_service.account.shown_and_accepted,
    ).toBe(true);
  });

  it('splits the date of birth into the integers Stripe expects', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 'ct_123' } });
    await createIdentityToken(details, 'alex@example.com');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Numbers, not strings, and not zero-padded — '04' would be rejected.
    expect(body.identity.individual.date_of_birth).toEqual({ day: 7, month: 4, year: 1990 });
  });

  it('omits blank optionals rather than sending empty strings', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 'ct_123' } });
    await createIdentityToken(
      { ...details, phone: '', addressLine2: '' },
      'alex@example.com',
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // JSON.stringify drops undefined, so an omitted field is absent entirely —
    // an empty string would be a value Stripe has to reject.
    expect(body.identity.individual).not.toHaveProperty('phone');
    expect(body.identity.individual.address).not.toHaveProperty('line2');
  });

  it('⚠️ never puts the rejection body in front of a person', async () => {
    // Stripe's rejection can echo the values it rejected. This one echoes a
    // date of birth, which is exactly the shape of the accident being guarded.
    mockFetch({
      ok: false,
      body: { error: { message: 'Invalid date_of_birth: 1990-04-07 for Alex Mercer' } },
    });

    const error = await createIdentityToken(details, 'alex@example.com').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe('DETAILS_REJECTED');
    expect((error as PaymentError).message).toBe(
      'Stripe couldn’t accept those details. Please check them and try again.',
    );
    for (const secret of SECRETS) {
      expect((error as PaymentError).message).not.toContain(secret);
    }
  });

  it('rejects a 200 with no id rather than returning an empty token', async () => {
    mockFetch({ ok: true, body: { object: 'account_token' } });

    const error = await createIdentityToken(details, 'alex@example.com').catch(
      (err: unknown) => err,
    );

    // Returning '' here would send an empty token id to our Edge Function,
    // where it becomes a Stripe error about the wrong thing entirely.
    expect((error as PaymentError).code).toBe('BAD_SHAPE');
  });

  it('⚠️ logs NOTHING — not on success, not on failure', async () => {
    mockFetch({ ok: true, body: { id: 'ct_123' } });
    await createIdentityToken(details, 'alex@example.com');

    mockFetch({ ok: false, body: { error: { message: 'sort_code 108800 rejected' } } });
    await createIdentityToken(details, 'alex@example.com').catch(() => {});

    const logged = everythingLogged();
    for (const secret of SECRETS) {
      expect(logged).not.toContain(secret);
    }
    // Not even the token id: it is single-use and short-lived, but a log line
    // is the wrong place to learn that habit.
    expect(logged).not.toContain('ct_123');
    expect(logged).toBe('[[],[],[],[],[]]');
  });

  it('refuses before making a request when no publishable key is bundled', async () => {
    const saved = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const fetchMock = mockFetch({ ok: true, body: { id: 'ct_123' } });
    try {
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = '';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- a deliberately fresh module registry
      const fresh = require('./stripeTokens') as typeof import('./stripeTokens');

      const error = await fresh
        .createIdentityToken(details, 'alex@example.com')
        .catch((err: unknown) => err);

      // A misconfigured build must fail HERE, not at Stripe with a 401 that
      // reads like the user's details were wrong. (`.code` rather than
      // instanceof: resetModules gives this import its own PaymentError class.)
      expect((error as PaymentError).code).toBe('NO_PUBLISHABLE_KEY');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = saved;
      jest.resetModules();
    }
  });
});

describe('createBankToken', () => {
  it('maps a UK sort code to routingNumber and pins country/currency', async () => {
    mockCreateToken.mockResolvedValue({ token: { id: 'btok_123' }, error: null });

    await expect(createBankToken(details)).resolves.toBe('btok_123');

    // ⚠️ sortCode → routingNumber is the one field name that is not obvious,
    // and getting it wrong produces a token Stripe accepts and cannot pay.
    expect(mockCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BankAccount',
        country: 'GB',
        currency: 'gbp',
        accountHolderType: 'Individual',
        routingNumber: '108800',
        accountNumber: '00012345',
        accountHolderName: 'Alex Mercer',
      }),
    );
  });

  it('omits the holder name when only the numbers are supplied', async () => {
    mockCreateToken.mockResolvedValue({ token: { id: 'btok_123' }, error: null });

    // The bank-only replacement form: the name is already on the account at
    // Stripe, and re-asking it to change a sort code would be theatre.
    await createBankToken({ sortCode: '108800', accountNumber: '00012345' });

    expect(mockCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({ accountHolderName: undefined }),
    );
  });

  it('treats a token with no id as a failure', async () => {
    mockCreateToken.mockResolvedValue({ token: null, error: null });

    const error = await createBankToken(details).catch((err: unknown) => err);

    expect((error as PaymentError).code).toBe('DETAILS_REJECTED');
  });

  it('⚠️ never leaks the account number through the SDK error', async () => {
    mockCreateToken.mockResolvedValue({
      token: null,
      error: { message: 'Invalid account_number: 00012345', code: 'invalid_bank_account' },
    });

    const error = await createBankToken(details).catch((err: unknown) => err);

    expect((error as PaymentError).message).toBe(
      'Stripe couldn’t accept that bank account. Please check it and try again.',
    );
    expect((error as PaymentError).message).not.toContain('00012345');
    expect(everythingLogged()).not.toContain('00012345');
  });
});

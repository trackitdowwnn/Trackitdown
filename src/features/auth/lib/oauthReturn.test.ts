/**
 * WHAT:  Tests for the web sign-in return — what a return URL carries, that
 *        only a one-time code is accepted (never tokens), that one return
 *        signs in ONCE, and never over a signed-in account.
 * WHY:   The security review (2026-10-15) found a forged token link could
 *        sign a victim into an attacker's account; a stolen or replayed
 *        return could too. These are the doors that must stay shut — plus the
 *        Android realities (three deliveries, 'dismiss' on success).
 * LINKS: ./oauthReturn.ts; ../api/authApi.ts (signInWithAppleWeb).
 */

import {
  completeOAuthReturn,
  firstNameFrom,
  handleAuthReturnPath,
  oauthReturnsHandled,
  parseOAuthReturn,
  resetOAuthReturnsForTests,
} from './oauthReturn';

const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockExchange = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      setSession: (...a: unknown[]) => mockSetSession(...a),
    },
  },
  supabaseOAuthHandshake: () => ({
    auth: { exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a) },
  }),
  resetOAuthHandshake: () => mockResetHandshake(),
}));
const mockResetHandshake = jest.fn();

const RETURN = 'trackitdown://auth-callback?code=code-1';

beforeEach(() => {
  jest.clearAllMocks();
  resetOAuthReturnsForTests();
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockExchange.mockResolvedValue({
    data: {
      session: { access_token: 'acc-1', refresh_token: 'ref-1' },
      user: { id: 'u9', user_metadata: { full_name: 'Sam Jones' } },
    },
    error: null,
  });
  mockSetSession.mockResolvedValue({ error: null });
});

describe('parseOAuthReturn', () => {
  it('reads the one-time code', () => {
    expect(parseOAuthReturn(RETURN)).toEqual({ code: 'code-1' });
  });

  it('accepts the path form +native-intent may pass', () => {
    expect(parseOAuthReturn('/auth-callback?code=code-1')).toEqual({ code: 'code-1' });
    expect(parseOAuthReturn('auth-callback?code=code-1')).toEqual({ code: 'code-1' });
  });

  it('⚠️ tokens in the URL are NOT a sign-in — the forged-link door stays shut', () => {
    expect(
      parseOAuthReturn('trackitdown://auth-callback#access_token=evil&refresh_token=evil'),
    ).toBeNull();
  });

  it('reads a provider error, and calls backing out a cancel', () => {
    expect(parseOAuthReturn('trackitdown://auth-callback?error=server_error')).toEqual({
      error: 'server_error',
      cancelled: false,
    });
    expect(parseOAuthReturn('trackitdown://auth-callback?error=access_denied')).toMatchObject({
      cancelled: true,
    });
    expect(
      parseOAuthReturn('trackitdown://auth-callback#error=x&error_description=user+cancelled'),
    ).toMatchObject({ cancelled: true });
  });

  it.each([
    ['trackitdown://stripe-redirect?code=x', 'not ours'],
    ['trackitdown://auth-callbackery?code=x', 'only looks like ours'],
    ['trackitdown://post/auth-callback?code=x', 'ours only somewhere inside'],
    ['trackitdown://auth-callback', 'nothing in it'],
    ['trackitdown://auth-callback?code=%E0%A4%A', 'a malformed escape'],
  ])('%s → null (%s)', (url) => {
    expect(parseOAuthReturn(url)).toBeNull();
  });
});

describe('firstNameFrom', () => {
  it.each([
    [{ given_name: 'Sam' }, 'Sam'],
    [{ full_name: 'Sam Jones' }, 'Sam'],
    [{ name: '  Alex  Smith ' }, 'Alex'],
    [{}, null],
    [undefined, null],
  ])('%j → %s', (metadata, name) => {
    expect(firstNameFrom(metadata as Record<string, unknown> | undefined)).toBe(name);
  });
});

describe('completeOAuthReturn', () => {
  it('redeems the code on the handshake client, then signs the app in', async () => {
    await expect(completeOAuthReturn(RETURN)).resolves.toEqual({ userId: 'u9', firstName: 'Sam' });
    expect(mockExchange).toHaveBeenCalledWith('code-1');
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'acc-1', refresh_token: 'ref-1' });
  });

  it('⚠️ the same return delivered three ways is redeemed ONCE, with one outcome', async () => {
    const [a, b, c] = await Promise.all([
      completeOAuthReturn(RETURN),
      completeOAuthReturn(RETURN),
      completeOAuthReturn(RETURN),
    ]);
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(oauthReturnsHandled()).toBe(1);
  });

  it('⚠️ never over a signed-in account — a link nobody started changes nothing', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'mine' } } });
    await expect(completeOAuthReturn(RETURN)).resolves.toBeNull();
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('⚠️ a code this device can’t redeem (forged, stolen, replayed) signs nobody in', async () => {
    mockExchange.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'pkce_code_verifier_not_found' },
    });
    await expect(completeOAuthReturn(RETURN)).resolves.toEqual({ error: 'exchange', cancelled: false });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('⚠️ drops the handshake client after every exchange — its session copy can’t refresh', async () => {
    await completeOAuthReturn(RETURN);
    expect(mockResetHandshake).toHaveBeenCalledTimes(1);

    resetOAuthReturnsForTests();
    mockExchange.mockResolvedValue({ data: { session: null, user: null }, error: { code: 'x' } });
    await completeOAuthReturn('trackitdown://auth-callback?code=code-2');
    expect(mockResetHandshake).toHaveBeenCalledTimes(2); // on failure too
  });

  it('a session the app can’t take is a failure — never a throw', async () => {
    mockSetSession.mockResolvedValue({ error: { code: 'bad_jwt' } });
    await expect(completeOAuthReturn(RETURN)).resolves.toEqual({ error: 'session', cancelled: false });
  });

  it('a URL that isn’t a return does nothing', async () => {
    await expect(completeOAuthReturn('trackitdown://post/1')).resolves.toBeNull();
    expect(mockExchange).not.toHaveBeenCalled();
  });
});

describe('handleAuthReturnPath (+native-intent’s auth half)', () => {
  it('⚠️ a return STAYS where the app is — no "unmatched route" screen', () => {
    expect(handleAuthReturnPath({ path: RETURN, initial: false })).toBeNull();
    expect(handleAuthReturnPath({ path: '/auth-callback?code=c', initial: false })).toBeNull();
  });

  it('a cold start on a return goes home — there is nowhere to stay', () => {
    expect(handleAuthReturnPath({ path: RETURN, initial: true })).toBe('/');
  });

  it('not ours: undefined, so the next hook decides', () => {
    expect(handleAuthReturnPath({ path: 'trackitdown://stripe-redirect', initial: false })).toBeUndefined();
  });

  it('offers the return to sign-in too (a cold start has nobody else listening)', async () => {
    handleAuthReturnPath({ path: RETURN, initial: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockExchange).toHaveBeenCalledWith('code-1');
  });
});

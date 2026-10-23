/**
 * WHAT:  Tests for the auth data layer — OTP request (incl. rate-limit copy),
 *        OTP verify (success → userId, wrong/expired → INVALID_OTP), the two
 *        social sign-ins (success, user-cancel → cancelled flag, failure), and
 *        profile existence/creation (display_name defaults to first name).
 * WHY:   This is the app's ONLY sign-in path and a Tier-1 safety gate — a
 *        mis-mapped error (e.g. showing lock-out language, or treating a cancel
 *        as a crash) or a bad profile insert would break the front door. Error
 *        codes are asserted because screens branch on them.
 * LINKS: src/features/auth/api/authApi.ts, docs/TESTING.md.
 */

import { Linking } from 'react-native';

import { resetOAuthReturnsForTests } from '../lib/oauthReturn';
import {
  AuthActionError,
  createProfile,
  hasProfile,
  isAppleWebSignInConfigured,
  requestEmailOtp,
  signInWithApple,
  signInWithAppleWeb,
  isGoogleSignInConfigured,
  signInWithGoogle,
  verifyEmailOtp,
} from './authApi';

const mockOpenAuth = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a),
}));

const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockSetSession = jest.fn();
const mockMaybeSingle = jest.fn();
const mockInsert = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...a: unknown[]) => mockSignInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      signInWithIdToken: (...a: unknown[]) => mockSignInWithIdToken(...a),
      setSession: (...a: unknown[]) => mockSetSession(...a),
      getSession: () => mockGetSession(),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }) }),
      insert: (...a: unknown[]) => mockInsert(...a),
    }),
  },
  // The PKCE handshake client (Apple on Android).
  supabaseOAuthHandshake: () => ({
    auth: {
      signInWithOAuth: (...a: unknown[]) => mockSignInWithOAuth(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a),
    },
  }),
  resetOAuthHandshake: jest.fn(),
}));
const mockGetSession = jest.fn();
const mockExchange = jest.fn();

const mockAppleSignIn = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  __esModule: true, // so `await import(...)` exposes named exports, not under default
  signInAsync: (...a: unknown[]) => mockAppleSignIn(...a),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const mockGoogleSignIn = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
  __esModule: true,
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: (...a: unknown[]) => mockGoogleSignIn(...a),
  },
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetOAuthReturnsForTests();
  mockInsert.mockResolvedValue({ error: null });
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web.apps.googleusercontent.com';
});

describe('requestEmailOtp', () => {
  it('sends with shouldCreateUser (sign-up == sign-in)', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await requestEmailOtp('  jane@example.com  ');
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'jane@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('maps a 429 to the rate-limit copy', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { status: 429, code: 'over_email_send_rate_limit' } });
    await expect(requestEmailOtp('jane@example.com')).rejects.toMatchObject({
      code: 'OTP_RATE_LIMIT',
      // Time-honest copy: the budget is 2/hour, so never promise "a minute".
      message: expect.stringContaining('try again later'),
    });
  });

  it('maps other send errors to a generic retry', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { status: 500, code: 'unexpected' } });
    await expect(requestEmailOtp('jane@example.com')).rejects.toMatchObject({ code: 'OTP_SEND_FAILED' });
  });
});

describe('verifyEmailOtp', () => {
  it('returns the user id on success', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    await expect(verifyEmailOtp('jane@example.com', '12345678')).resolves.toBe('u1');
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'jane@example.com',
      token: '12345678',
      type: 'email',
    });
  });

  it('maps a wrong/expired code to INVALID_OTP with calm copy (never lock-out)', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: null }, error: { code: 'otp_expired' } });
    await expect(verifyEmailOtp('jane@example.com', '000000')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      message: expect.stringContaining('didn’t match'),
    });
  });
});

describe('social sign-in', () => {
  it('apple: success returns the user id', async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: 'apple-tok' });
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null });
    await expect(signInWithApple()).resolves.toEqual({ cancelled: false, userId: 'u2' });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-tok' });
  });

  it('apple: user cancel is a calm outcome, not an error', async () => {
    mockAppleSignIn.mockRejectedValue(Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(signInWithApple()).resolves.toEqual({ cancelled: true });
  });

  it('google: success returns the user id', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'g-tok' } });
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'u3' } }, error: null });
    await expect(signInWithGoogle()).resolves.toEqual({
      cancelled: false,
      userId: 'u3',
      firstName: null,
    });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'g-tok' });
  });

  it('google: carries their given name, for a new user’s name box (2026-10-15)', async () => {
    mockGoogleSignIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'g-tok', user: { givenName: 'Sam', familyName: 'Jones' } },
    });
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'u3' } }, error: null });
    await expect(signInWithGoogle()).resolves.toMatchObject({ firstName: 'Sam' });
  });

  it('google: user cancel returns the cancelled flag', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(signInWithGoogle()).resolves.toEqual({ cancelled: true });
  });

  it('⚠️ google: v13+ RETURNS a cancel — a calm cancel, never "Sign-in failed"', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(signInWithGoogle()).resolves.toEqual({ cancelled: true });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('google: is set up only when the web client id is in the bundle', () => {
    expect(isGoogleSignInConfigured()).toBe(true);
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    expect(isGoogleSignInConfigured()).toBe(false);
  });

  it('google: a real failure throws AuthActionError', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
    await expect(signInWithGoogle()).rejects.toBeInstanceOf(AuthActionError);
  });

  it('google: fails closed when the web client id is unset', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SOCIAL_FAILED' });
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
  });
});

describe('profiles', () => {
  it('hasProfile: present row → true, absent → false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'u1' }, error: null });
    await expect(hasProfile('u1')).resolves.toBe(true);
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(hasProfile('u1')).resolves.toBe(false);
  });

  it('createProfile: inserts first_name, and defaults display_name to it when omitted', async () => {
    await createProfile('u1', { firstName: '  Jane  ' });
    expect(mockInsert).toHaveBeenCalledWith({ id: 'u1', first_name: 'Jane', display_name: 'Jane' });
  });

  it('createProfile: uses the given display name when provided', async () => {
    await createProfile('u1', { firstName: 'Jane', displayName: 'Jane Smith' });
    expect(mockInsert).toHaveBeenCalledWith({
      id: 'u1',
      first_name: 'Jane',
      display_name: 'Jane Smith',
    });
  });

  it('createProfile: maps a real insert error to PROFILE_CREATE_FAILED', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23502' } }); // not-null violation
    await expect(createProfile('u1', { firstName: 'Jane' })).rejects.toMatchObject({
      code: 'PROFILE_CREATE_FAILED',
    });
  });

  it('createProfile: treats a duplicate row (23505) as success — idempotent', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505' } });
    await expect(createProfile('u1', { firstName: 'Jane' })).resolves.toBeUndefined();
  });
});

describe('Sign in with Apple on Android — the web flow (2026-10-15)', () => {
  const RETURN = 'trackitdown://auth-callback?code=code-1';
  let linkListener: ((event: { url: string }) => void) | null = null;
  const removeLink = jest.fn();

  beforeEach(() => {
    linkListener = null;
    jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, fn) => {
      linkListener = fn as (event: { url: string }) => void;
      return { remove: removeLink } as unknown as ReturnType<typeof Linking.addEventListener>;
    });
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.example/apple' }, error: null });
    // A guest, a code this device can redeem, and the app taking the session.
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockExchange.mockResolvedValue({
      data: {
        session: { access_token: 'acc-1', refresh_token: 'ref-1' },
        user: { id: 'u7', user_metadata: { full_name: 'Sam Jones' } },
      },
      error: null,
    });
    mockSetSession.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN;
  });

  it('asks Supabase for Apple, back to our scheme, without it opening a browser itself', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: RETURN });
    await signInWithAppleWeb();
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: {
        redirectTo: 'trackitdown://auth-callback',
        skipBrowserRedirect: true,
        scopes: 'name email',
      },
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(
      'https://supabase.example/apple',
      'trackitdown://auth-callback',
    );
  });

  it('back with the session: signed in, with the first name Apple gave', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: RETURN });
    await expect(signInWithAppleWeb()).resolves.toEqual({
      cancelled: false,
      userId: 'u7',
      firstName: 'Sam',
    });
    // Redeemed with this device's verifier, then handed to the app's client.
    expect(mockExchange).toHaveBeenCalledWith('code-1');
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'acc-1', refresh_token: 'ref-1' });
  });

  it('⚠️ Android calls the success a "dismiss" — the Linking event still signs them in', async () => {
    mockOpenAuth.mockImplementation(async () => {
      linkListener?.({ url: RETURN });
      return { type: 'dismiss' };
    });
    await expect(signInWithAppleWeb()).resolves.toMatchObject({ cancelled: false, userId: 'u7' });
    // …and once, not once per delivery.
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });

  it('⚠️ both deliveries of the same return sign in ONCE', async () => {
    mockOpenAuth.mockImplementation(async () => {
      linkListener?.({ url: RETURN });
      return { type: 'success', url: RETURN };
    });
    await signInWithAppleWeb();
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });

  it('closing Apple’s page with nothing back is a calm cancel — no error', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'cancel' });
    await expect(signInWithAppleWeb()).resolves.toEqual({ cancelled: true });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('Apple’s own "cancelled" comes back as a cancel too', async () => {
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url: 'trackitdown://auth-callback?error=access_denied',
    });
    await expect(signInWithAppleWeb()).resolves.toEqual({ cancelled: true });
  });

  it('a real failure from the provider throws SOCIAL_FAILED', async () => {
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url: 'trackitdown://auth-callback?error=server_error',
    });
    await expect(signInWithAppleWeb()).rejects.toMatchObject({ code: 'SOCIAL_FAILED' });
  });

  it('Supabase can’t start it: SOCIAL_FAILED, and no browser opens', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: { code: 'provider_disabled' } });
    await expect(signInWithAppleWeb()).rejects.toBeInstanceOf(AuthActionError);
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('the link listener is always removed — success, cancel or failure', async () => {
    mockOpenAuth.mockRejectedValue(new Error('WebBrowser is already open'));
    await expect(signInWithAppleWeb()).rejects.toMatchObject({ code: 'SOCIAL_FAILED' });
    expect(removeLink).toHaveBeenCalledTimes(1);
  });

  it('is switched on only once the setup is done (EXPO_PUBLIC_APPLE_SIGN_IN)', () => {
    expect(isAppleWebSignInConfigured()).toBe(false);
    process.env.EXPO_PUBLIC_APPLE_SIGN_IN = 'true';
    expect(isAppleWebSignInConfigured()).toBe(true);
  });
});

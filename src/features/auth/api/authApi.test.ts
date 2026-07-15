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

import {
  AuthActionError,
  createProfile,
  hasProfile,
  requestEmailOtp,
  signInWithApple,
  signInWithGoogle,
  verifyEmailOtp,
} from './authApi';

const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockMaybeSingle = jest.fn();
const mockInsert = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...a: unknown[]) => mockSignInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      signInWithIdToken: (...a: unknown[]) => mockSignInWithIdToken(...a),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }) }),
      insert: (...a: unknown[]) => mockInsert(...a),
    }),
  },
}));

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
    mockGoogleSignIn.mockResolvedValue({ data: { idToken: 'g-tok' } });
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'u3' } }, error: null });
    await expect(signInWithGoogle()).resolves.toEqual({ cancelled: false, userId: 'u3' });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'g-tok' });
  });

  it('google: user cancel returns the cancelled flag', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(signInWithGoogle()).resolves.toEqual({ cancelled: true });
  });

  it('google: a real failure throws AuthActionError', async () => {
    mockGoogleSignIn.mockResolvedValue({ data: { idToken: null } });
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

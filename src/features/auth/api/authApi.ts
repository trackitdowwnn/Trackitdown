/**
 * WHAT:  The auth feature's Supabase calls — request/verify an email OTP, the
 *        two native social sign-ins (Apple, Google — both via signInWithIdToken),
 *        and the first-ever profile row (existence check + create).
 * WHY:   This is the ONLY place the app calls supabase.auth sign-in, so the
 *        one unified passwordless path (sign-up == sign-in) and its error→copy
 *        translation live in one auditable file. Every call logs a [auth] funnel
 *        event with the email REDACTED (SECURITY_AND_TRUST §3: an email is
 *        personal data — never logged in full). A wrong/expired code and a
 *        social cancel are ordinary outcomes, not crashes, so they map to
 *        calm copy / a cancelled flag, never lock-out language.
 * LINKS: src/features/auth/components/AuthSheet.tsx (the one auth surface);
 *        src/shared/api (supabase client, session now in SecureStore);
 *        supabase/migrations/…profile_fields_and_avatars.sql (profiles_insert_self
 *        RLS + the INSERT grant this uses); docs/LOGGING.md.
 */

// NOTE: expo-apple-authentication and @react-native-google-signin are loaded
// LAZILY (inside the social functions) — NOT at module top level. These are
// optional native modules that only exist in a dev build; a static import would
// crash the WHOLE app at startup (this file is on the AuthGate → _layout path)
// on any binary without them (Expo Go, or a build predating them). Email OTP
// must always boot; social fails gracefully only when its button is tapped.

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib';
import { redactEmail } from '@/shared/lib/logger';

const log = createLogger('auth');

// --- Errors -----------------------------------------------------------------

/** An auth failure whose `message` is already plain-English (shown to the user)
 *  and whose `code` drives screen behaviour (e.g. INVALID_OTP → shake+clear). */
export class AuthActionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuthActionError';
    this.code = code;
  }
}

// Time-honest: the send budget is 2 emails/HOUR (README Config), so promising
// "a minute" would send the user into a retry loop that keeps failing.
const RATE_LIMIT = 'Too many codes requested — please try again later.';
const SEND_FAILED = 'We couldn’t send the code. Check the email and try again.';
const INVALID_OTP = 'That code didn’t match — check the latest email.';
const SOCIAL_FAILED = 'Sign-in didn’t complete. Please try again.';
const PROFILE_FAILED = 'We couldn’t finish setting up your account. Please try again.';

/** Supabase surfaces rate limits as HTTP 429 (and/or an over_email_send_rate_limit
 *  code). Either signal → the calm "try again later" copy. */
function isRateLimited(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === 'over_email_send_rate_limit';
}

// --- Email OTP --------------------------------------------------------------

/**
 * Send a 6-digit OTP to `email`. Sign-up and sign-in are the SAME call
 * (shouldCreateUser: true) — no account-exists fork, no password.
 */
export async function requestEmailOtp(email: string): Promise<void> {
  const address = email.trim();
  log.info('otp_requested', { email: redactEmail(address) });
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: true },
  });
  if (error) {
    if (isRateLimited(error)) {
      log.warn('otp_rate_limited', { email: redactEmail(address) });
      throw new AuthActionError(RATE_LIMIT, 'OTP_RATE_LIMIT');
    }
    log.error('otp_send_failed', { code: error.code });
    throw new AuthActionError(SEND_FAILED, 'OTP_SEND_FAILED');
  }
}

/**
 * Verify the code. On success the session is set on the client (SecureStore)
 * and the auth gate reacts; returns the user id so the caller can branch
 * new-vs-existing. A wrong OR expired code is one calm outcome (INVALID_OTP) —
 * Supabase doesn't distinguish them, and "check the latest email" covers both.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<string> {
  const address = email.trim();
  const { data, error } = await supabase.auth.verifyOtp({
    email: address,
    token,
    type: 'email',
  });
  if (error || !data.user) {
    log.warn('otp_failed', { email: redactEmail(address), code: error?.code });
    throw new AuthActionError(INVALID_OTP, 'INVALID_OTP');
  }
  log.info('otp_verified', { userId: data.user.id });
  return data.user.id;
}

// --- Social sign-in (native idToken → signInWithIdToken; no deep link) -------

/** Success returns the user id; a user-cancel returns `{ cancelled: true }`
 *  (no error toast); a real failure throws AuthActionError. */
export type SocialResult = { cancelled: true } | { cancelled: false; userId: string };

/** Sign in with Apple (iOS). Uses the identity token; the caller must only
 *  render the button on a device where AppleAuthentication.isAvailableAsync(). */
export async function signInWithApple(): Promise<SocialResult> {
  let apple: typeof import('expo-apple-authentication');
  try {
    // Lazy require (not a top-level import) so a binary without this native
    // module boots fine and only fails here, when the button is tapped.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    apple = require('expo-apple-authentication');
  } catch {
    log.error('social_signin_failed', { provider: 'apple', reason: 'module_missing' });
    throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
  }
  try {
    const credential = await apple.signInAsync({
      requestedScopes: [
        apple.AppleAuthenticationScope.FULL_NAME,
        apple.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error || !data.user) {
      log.error('social_signin_failed', { provider: 'apple', code: error?.code });
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    log.info('social_signin', { provider: 'apple', userId: data.user.id });
    return { cancelled: false, userId: data.user.id };
  } catch (err) {
    // The native cancel code is an ordinary outcome, not an error.
    if (err instanceof Error && 'code' in err && err.code === 'ERR_REQUEST_CANCELED') {
      return { cancelled: true };
    }
    if (err instanceof AuthActionError) throw err;
    log.error('social_signin_failed', { provider: 'apple' });
    throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
  }
}

/** Sign in with Google (iOS + Android). Configured with the WEB client id so
 *  the returned idToken's audience matches the Supabase Google provider. */
export async function signInWithGoogle(): Promise<SocialResult> {
  let google: typeof import('@react-native-google-signin/google-signin');
  try {
    // Lazy require (not a top-level import): this third-party native module is
    // absent from Expo Go and any build predating it, and a static import here
    // would crash the whole app at startup (this file is on the boot path).
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    google = require('@react-native-google-signin/google-signin');
  } catch {
    log.error('social_signin_failed', { provider: 'google', reason: 'module_missing' });
    throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
  }
  const { GoogleSignin, isErrorWithCode, statusCodes } = google;
  try {
    // Fail closed: without the WEB client id the idToken's audience would fall
    // back to the iOS client id and Supabase would reject it — clearer to stop
    // here (also the "social pending credentials" state, see README).
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId) {
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    GoogleSignin.configure({
      webClientId,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    const idToken = response.data?.idToken;
    if (!idToken) {
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error || !data.user) {
      log.error('social_signin_failed', { provider: 'google', code: error?.code });
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    log.info('social_signin', { provider: 'google', userId: data.user.id });
    return { cancelled: false, userId: data.user.id };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      return { cancelled: true };
    }
    if (err instanceof AuthActionError) throw err;
    log.error('social_signin_failed', { provider: 'google' });
    throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
  }
}

// --- Profile (first-ever row) -----------------------------------------------

/** Whether a profiles row exists for the user — the new-vs-existing branch.
 *  maybeSingle() returns null (not an error) when the row is absent. */
export async function hasProfile(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    log.error('profile_check_failed', { code: error.code });
    throw new AuthActionError(PROFILE_FAILED, 'PROFILE_CHECK_FAILED');
  }
  return data !== null;
}

/**
 * Create the user's profile row (RLS profiles_insert_self pins id = auth.uid()).
 * first_name is the PUBLIC identity (required). display_name is NOT NULL in the
 * DB but private (surname) — default it to the first name when omitted.
 */
export async function createProfile(
  userId: string,
  fields: { firstName: string; displayName?: string },
): Promise<void> {
  const firstName = fields.firstName.trim();
  const displayName = fields.displayName?.trim() || firstName;
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, first_name: firstName, display_name: displayName });
  // Idempotent: 23505 (row already exists) is success — a returning user routed
  // here by a transient gate error can proceed instead of soft-locking.
  if (error && error.code !== '23505') {
    log.error('profile_create_failed', { code: error.code });
    throw new AuthActionError(PROFILE_FAILED, 'PROFILE_CREATE_FAILED');
  }
  log.info('profile_completed', { userId });
}

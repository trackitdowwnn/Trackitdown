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
// expo-web-browser (Apple's web flow on Android) is a core Expo module, in
// Expo Go and every build — so it is imported normally.

import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { supabase, supabaseOAuthHandshake } from '@/shared/api';
import { createLogger } from '@/shared/lib';
import { redactEmail } from '@/shared/lib/logger';

import {
  OAUTH_REDIRECT,
  completeOAuthReturn,
  latestOAuthReturn,
  oauthReturnsHandled,
  parseOAuthReturn,
  type OAuthOutcome,
} from '../lib/oauthReturn';

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
 * Send an 8-digit OTP to `email`. Sign-up and sign-in are the SAME call
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
export type SocialResult =
  | { cancelled: true }
  | {
      cancelled: false;
      userId: string;
      /** The provider's given name, to start a new user's name box with. */
      firstName?: string | null;
    };

/**
 * Whether Google sign-in can work in this bundle: the WEB client id is
 * inlined at bundle time (EXPO_PUBLIC_*), so an app published without it has
 * a button that can only fail. The sheet hides the button until it's set.
 */
export function isGoogleSignInConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
}

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

/**
 * Whether Sign in with Apple on Android is switched on in this bundle — off
 * until the Apple Developer setup + Supabase's Apple provider are done
 * (README). Like Google's gate: never a button that can only fail.
 */
export function isAppleWebSignInConfigured(): boolean {
  return process.env.EXPO_PUBLIC_APPLE_SIGN_IN === 'true';
}

/** How long a 'dismiss' waits for the return to land by another path. */
const RETURN_GRACE_MS = 1500;
const RETURN_POLL_MS = 100;

/**
 * Sign in with Apple on ANDROID (2026-10-15): Apple has no Android sign-in
 * kit, so it is Supabase's web flow — Apple's page in an in-app browser, then
 * back on `trackitdown://auth-callback` with the session's tokens.
 *
 * ⚠️ A 'dismiss' IS NOT A CANCEL ON ANDROID. The browser often reports a
 * real success that way, so the Linking listener (subscribed BEFORE the
 * browser opens) and +native-intent both feed the same idempotent
 * completeOAuthReturn, and a 'dismiss' waits a beat for either to land
 * before calling it a cancel. Cancel stays quiet; a failure is SOCIAL_FAILED.
 */
export async function signInWithAppleWeb(): Promise<SocialResult> {
  // On the PKCE handshake client: it makes (and keeps) the verifier that alone
  // can redeem the code Apple's return brings back — see oauthReturn.ts.
  const { data, error } = await supabaseOAuthHandshake().auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true, scopes: 'name email' },
  });
  if (error || !data?.url) {
    log.error('social_signin_failed', { provider: 'apple', via: 'web', stage: 'start', code: error?.code });
    throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
  }

  const before = oauthReturnsHandled();
  let fromLink: Promise<OAuthOutcome> | null = null;
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (parseOAuthReturn(url)) fromLink = completeOAuthReturn(url);
  });
  try {
    let outcome: OAuthOutcome = null;
    try {
      const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
      if (result.type === 'success') outcome = await completeOAuthReturn(result.url);
    } catch {
      log.error('social_signin_failed', { provider: 'apple', via: 'web', stage: 'browser' });
      throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    }
    // Landed another way — the Linking event, or +native-intent.
    for (let waited = 0; !outcome && waited <= RETURN_GRACE_MS; waited += RETURN_POLL_MS) {
      const other: Promise<OAuthOutcome> | null =
        fromLink ?? (oauthReturnsHandled() > before ? latestOAuthReturn() : null);
      if (other) {
        outcome = await other;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETURN_POLL_MS));
    }

    if (!outcome || ('error' in outcome && outcome.cancelled)) return { cancelled: true };
    if ('error' in outcome) throw new AuthActionError(SOCIAL_FAILED, 'SOCIAL_FAILED');
    return { cancelled: false, userId: outcome.userId, firstName: outcome.firstName };
  } finally {
    subscription.remove();
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
    // ⚠️ v13+ RETURNS a cancel ({ type: 'cancelled' }) rather than throwing
    // it (the installed v16 included). Read as "no token", backing out of the
    // account picker showed "Sign-in failed" to someone who changed their mind.
    if (response.type === 'cancelled') {
      return { cancelled: true };
    }
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
    // Their given name starts a NEW user's name box (never sent anywhere by
    // this; createProfile writes only what they confirm).
    return {
      cancelled: false,
      userId: data.user.id,
      // Optional all the way: a name is a nicety, never a reason to fail.
      firstName: response.data?.user?.givenName ?? null,
    };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      return { cancelled: true };
    }
    if (err instanceof AuthActionError) throw err;
    // The native code, never anything personal: DEVELOPER_ERROR ("10") is a
    // client id / SHA-1 mismatch in Google Cloud — the setup error to expect.
    log.error('social_signin_failed', {
      provider: 'google',
      code: isErrorWithCode(err) ? err.code : undefined,
    });
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

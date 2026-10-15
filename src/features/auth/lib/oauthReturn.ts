/**
 * WHAT:  The way back from a web sign-in (Sign in with Apple on Android):
 *        read the return URL's one-time code, redeem it, and hand the session
 *        to the app — ONCE.
 * WHY:   2026-10-15. Apple has no Android sign-in kit, so on Android it is
 *        Supabase's web flow: Apple's page in an in-app browser, then
 *        `trackitdown://auth-callback?code=…`.
 *
 *        ⚠️ PKCE, NOT TOKENS IN THE URL (security review, 2026-10-15). The
 *        first draft took `#access_token=…&refresh_token=…` — and any web page
 *        or QR code could open such a link with an ATTACKER's tokens and
 *        silently sign the victim into the attacker's account (whose payout
 *        details and sighting locations they'd then fill in); an app claiming
 *        the same scheme could take the tokens outright; and a re-delivered
 *        launch link could replay them. Now the URL carries only a code, which
 *        only THIS device can redeem — it holds the verifier made when the
 *        sign-in started (supabaseOAuthHandshake, kept in the keychain so a
 *        cold start can still finish) — and redemption spends both. Token
 *        URLs are ignored outright.
 *
 *        ⚠️ ONE RETURN, UP TO THREE DELIVERIES. On Android the same URL can
 *        arrive through the browser session's result, a Linking 'url' event,
 *        and expo-router's +native-intent — and the browser often reports a
 *        real success as 'dismiss'. Every path calls `completeOAuthReturn`;
 *        the same code twice gets the first outcome.
 *
 *        ⚠️ NEVER OVER A SIGNED-IN ACCOUNT. A return while someone is already
 *        signed in is ignored — the sheet only offers this to guests, so the
 *        only way here signed-in is a link nobody started.
 *
 *        Parsed by hand, not URLSearchParams: React Native's has long left
 *        `get` unimplemented.
 * PRIVACY: the code and the session go only to Supabase — never logged,
 *        never stored by us.
 * LINKS: ../api/authApi.ts (signInWithAppleWeb); src/app/+native-intent.tsx;
 *        src/shared/api/supabase.ts (supabaseOAuthHandshake).
 */

import { resetOAuthHandshake, supabase, supabaseOAuthHandshake } from '@/shared/api';
import { createLogger } from '@/shared/lib';

const log = createLogger('auth');

/** Where Supabase sends a web sign-in back to (allow-listed in Supabase). */
export const OAUTH_REDIRECT = 'trackitdown://auth-callback';

export type OAuthReturn = { code: string } | { error: string; cancelled: boolean } | null;

export type OAuthOutcome =
  | { userId: string; firstName: string | null }
  | { error: string; cancelled: boolean }
  | null;

/** `a=1&b=2` → a map, decoded; anything malformed is skipped. */
function readParams(part: string, into: Map<string, string>) {
  for (const pair of part.split('&')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    try {
      into.set(
        decodeURIComponent(pair.slice(0, at)),
        decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' ')),
      );
    } catch {
      // A malformed escape is no parameter at all.
    }
  }
}

/**
 * The return as a full URL, or null if it isn't ours EXACTLY —
 * `trackitdown://auth-callback` followed by nothing, `?`, `#` or `/`.
 * +native-intent may hand over just the path (`/auth-callback?code=…`), so
 * that form is accepted too, and rebuilt onto our scheme.
 */
function asOurReturn(url: string): string | null {
  const path = 'auth-callback';
  let rest: string;
  if (url.startsWith(OAUTH_REDIRECT)) rest = url.slice(OAUTH_REDIRECT.length);
  else if (url.startsWith(`/${path}`)) rest = url.slice(path.length + 1);
  else if (url.startsWith(path)) rest = url.slice(path.length);
  else return null;
  const next = rest.charAt(0);
  return next === '' || next === '?' || next === '#' || next === '/' ? OAUTH_REDIRECT + rest : null;
}

function isOurReturn(url: string): boolean {
  return asOurReturn(url) !== null;
}

/** What a return URL carries: a code, an error, or nothing of ours. Tokens
 *  in the URL are NOT accepted (see the header). */
export function parseOAuthReturn(raw: string): OAuthReturn {
  const url = asOurReturn(raw);
  if (!url) return null;
  const query = new Map<string, string>();
  const fragment = new Map<string, string>();
  const hashAt = url.indexOf('#');
  const queryAt = url.indexOf('?');
  if (queryAt >= 0) {
    readParams(url.slice(queryAt + 1, hashAt > queryAt ? hashAt : undefined), query);
  }
  if (hashAt >= 0) readParams(url.slice(hashAt + 1), fragment);

  const error = query.get('error') ?? fragment.get('error');
  if (error) {
    const description = query.get('error_description') ?? fragment.get('error_description') ?? '';
    // Backing out of Apple's page is a choice, not a failure.
    const cancelled = error === 'access_denied' || /cancel/i.test(`${error} ${description}`);
    return { error, cancelled };
  }
  const code = query.get('code');
  return code ? { code } : null;
}

/** A first name from the provider's metadata — best effort. Apple sends a
 *  name only on the FIRST sign-in; after that there is none to give. */
export function firstNameFrom(metadata: Record<string, unknown> | undefined): string | null {
  const given = metadata?.given_name;
  if (typeof given === 'string' && given.trim()) return given.trim();
  for (const key of ['full_name', 'name']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().split(/\s+/)[0] ?? null;
  }
  return null;
}

let latest: { code: string; promise: Promise<OAuthOutcome> } | null = null;
let handled = 0;

async function redeem(code: string): Promise<OAuthOutcome> {
  try {
    // Never over a signed-in account (see the header).
    const { data: current } = await supabase.auth.getSession();
    if (current.session) {
      log.warn('oauth_return_ignored', { reason: 'signed_in' });
      return null;
    }
    // Only this device's verifier can redeem it; it is spent either way. The
    // handshake client is dropped straight after, so its copy of the session
    // can never refresh behind the app's back (security review).
    const exchange = await supabaseOAuthHandshake()
      .auth.exchangeCodeForSession(code)
      .finally(() => resetOAuthHandshake());
    const { data, error } = exchange;
    if (error || !data.session || !data.user) {
      log.error('oauth_return_failed', { stage: 'exchange', code: error?.code });
      return { error: 'exchange', cancelled: false };
    }
    const { error: setError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (setError) {
      log.error('oauth_return_failed', { stage: 'session', code: setError.code });
      return { error: 'session', cancelled: false };
    }
    log.info('social_signin', { provider: 'apple', via: 'web', userId: data.user.id });
    return { userId: data.user.id, firstName: firstNameFrom(data.user.user_metadata) };
  } catch {
    log.error('oauth_return_failed', { stage: 'exchange' });
    return { error: 'exchange', cancelled: false };
  }
}

/**
 * Sign in from a return URL. Idempotent per code: a second delivery of the
 * same return gets the first one's outcome. Never throws.
 */
export function completeOAuthReturn(url: string): Promise<OAuthOutcome> {
  const parsed = parseOAuthReturn(url);
  if (!parsed) return Promise.resolve(null);
  if ('error' in parsed) {
    if (!parsed.cancelled) log.error('oauth_return_failed', { stage: 'provider', code: parsed.error });
    return Promise.resolve(parsed);
  }
  if (latest?.code === parsed.code) return latest.promise;
  const promise = redeem(parsed.code);
  latest = { code: parsed.code, promise };
  handled += 1;
  return promise;
}

/** How many distinct returns have been taken — so a sign-in can tell
 *  whether one landed (by another path) while its browser was open. */
export function oauthReturnsHandled(): number {
  return handled;
}

/** The most recent return's outcome, or null. */
export function latestOAuthReturn(): Promise<OAuthOutcome> | null {
  return latest?.promise ?? null;
}

/**
 * +native-intent's auth half: a sign-in return STAYS where the app is (the
 * sheet resolves itself) — null means "no redirection" (expo-router v57) —
 * instead of opening the unmatched-route screen over it. The URL is also
 * offered to completeOAuthReturn, for a cold start where nothing else is
 * listening; it can only succeed with this device's verifier. On a cold start
 * there is nowhere to stay, so home. `undefined` = not ours. Never throws.
 */
export function handleAuthReturnPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null | undefined {
  if (!isOurReturn(path)) return undefined;
  void completeOAuthReturn(path).catch(() => null);
  return initial ? '/' : null;
}

/** Tests only: forget every return. */
export function resetOAuthReturnsForTests(): void {
  latest = null;
  handled = 0;
}

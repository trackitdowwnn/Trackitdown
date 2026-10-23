/**
 * WHAT:  Was THIS session signed in (or re-verified) within the last few
 *        minutes? Reads the access token's `amr` claim — Supabase's signed
 *        record of how and when the session authenticated:
 *        `[{ method: 'otp' | 'oauth' | …, timestamp: <unix seconds> }]`.
 * WHY:   Account deletion must not be one tap away for whoever holds an
 *        unlocked phone (danger-zone research, 2026-10-23: re-verify before
 *        the irreversible step). The app asks for a fresh email code (or a
 *        Google/Apple re-sign-in) right before deleting; verifying it mints a
 *        NEW session with a fresh `amr` timestamp. A refreshed token keeps its
 *        session's original `amr`, so an old session can't pass by refreshing.
 *
 *        FAILS CLOSED: a token with no `amr`, or one this can't read, is not
 *        recent. Call ONLY with a JWT already verified (auth.getUser) — this
 *        decodes the payload, it does not check the signature.
 * LINKS: ../delete-account/index.ts; ./recentSignIn.test.ts.
 */

/** How long a fresh verification counts — long enough to read the screen
 *  and press the button, short enough that an old session can't pass. */
export const RECENT_SIGN_IN_SECONDS = 5 * 60;

/**
 * ⚠️ THE ONLY METHODS THAT COUNT AS PROOF: an email code (`otp`) or a
 * Google/Apple sign-in (`oauth`). Each needs something the token alone can't
 * give — the inbox, or the provider account. Anything else a stolen access
 * token could mint for itself would otherwise pass (security review of #266):
 * `updateUser({ password })` then a `password` sign-in, or enrolling a TOTP
 * factor (a fresh `totp` claim on the SAME session). `token_refresh`,
 * `recovery`, `email_change`, `anonymous`, `mfa/*` likewise don't count.
 */
const PROOF_METHODS: ReadonlySet<string> = new Set(['otp', 'oauth']);

export function isRecentSignIn(
  jwt: string,
  nowSeconds: number,
  maxAgeSeconds: number = RECENT_SIGN_IN_SECONDS,
): boolean {
  const payload = decodePayload(jwt);
  const amr = payload?.amr;
  if (!Array.isArray(amr)) return false;
  let latest = -Infinity;
  for (const entry of amr) {
    const { method, timestamp } = (entry ?? {}) as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !PROOF_METHODS.has(method)) continue;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      latest = Math.max(latest, timestamp);
    }
  }
  // A timestamp from the future (clock skew beyond a minute) is not trusted.
  return latest >= nowSeconds - maxAgeSeconds && latest <= nowSeconds + 60;
}

function decodePayload(jwt: string): { amr?: unknown } | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    return parsed !== null && typeof parsed === 'object' ? (parsed as { amr?: unknown }) : null;
  } catch {
    return null;
  }
}

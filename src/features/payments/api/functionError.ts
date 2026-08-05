/**
 * WHAT:  The one typed error the payments feature throws, and the one function
 *        that builds it from a non-2xx Edge Function response.
 * WHY:   Every money Edge Function answers failures the same way — a JSON body
 *        of `{ error, code }` — so every client caller needs the same three
 *        steps: pull the code out, map it to copy a person can read, and keep
 *        the raw code for logs and tests. Doing that once means a new function
 *        contributes a message map and nothing else.
 *
 *        SPLIT OUT OF paymentsApi.ts (2026-08-03) because it was private there
 *        and payouts needed it. ONE error class, deliberately: a sibling
 *        `PayoutError` would mean every `catch` in the feature had to test two
 *        types to answer the same question, and the first one written would be
 *        the one someone forgot.
 * LINKS: ./paymentsApi.ts (escrow + refunds, re-exports PaymentError);
 *        ./payoutsApi.ts (Connect onboarding);
 *        supabase/functions/_shared/http.ts (errorResponse — the { error, code }
 *          shape this parses).
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

/** Error carrying a plain-English `message` (shown to the user) plus a `code`
 *  for logging/tests. Thrown by every payments api call. */
export class PaymentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

/** Pull the { error, code } body out of a non-2xx Edge Function response and map
 *  it to user-facing copy via the supplied `messages` map (+ `fallback`). */
export async function parseFunctionError(
  error: unknown,
  messages: Record<string, string>,
  fallback: string,
): Promise<PaymentError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string; code?: string };
      const code = body.code ?? 'UNKNOWN';
      // Own-property lookup only: bracket access on a plain object STILL resolves
      // inherited keys (a `code` of 'toString'/'constructor' would map to a
      // function), so gate on Object.hasOwn before reading the map.
      const mapped = Object.hasOwn(messages, code) ? messages[code] : undefined;
      const message = mapped ?? body.error ?? fallback;
      return new PaymentError(message, code);
    } catch {
      return new PaymentError(fallback, 'UNKNOWN');
    }
  }
  // Network / relay error with no HTTP body.
  return new PaymentError(fallback, 'NETWORK');
}

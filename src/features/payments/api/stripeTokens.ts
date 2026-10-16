/**
 * WHAT:  Client-side tokenisation for the payout form — turns identity and
 *        bank details into single-use Stripe tokens WITHOUT them ever touching
 *        our server.
 * WHY:   ADR-0010's data posture, completed. The previous generation POSTed a
 *        sort code and date of birth to our Edge Function in transit to
 *        Stripe; this generation sends them from the phone STRAIGHT to
 *        Stripe's API and hands our server two opaque ids. Our threat model
 *        loses the data entirely.
 *
 *        TWO TOKENS, ONE MECHANISM — the PUBLISHABLE key over plain fetch:
 *        - Identity (name, DOB, address, ToS acceptance) → a v2 ACCOUNT TOKEN,
 *          a JSON REST endpoint with no RN SDK wrapper. The `Stripe-Version`
 *          header is MANDATORY on every /v2 call.
 *        - Bank details → a v1 bank token (a `btok_`), form-encoded. Not the
 *          SDK's createToken since 2026-10-16: its Android side drops the
 *          error type, so "offline" and "wrong numbers" looked the same.
 *
 *        ToS RIDES THE TOKEN, deliberately: Stripe infers acceptance date/IP
 *        from the client call that carries `shown_and_accepted`. Moving
 *        acceptance to the server would make date and IP OUR claims instead of
 *        observed facts — and would put the acceptance on the wrong machine.
 *
 * SAFETY: nothing in this file logs. Not the values, not the token ids, not
 *        the request body on failure — payoutsApi's log-absence tests cover
 *        the call sites, and the fetch error path surfaces a fixed string.
 *        Tokens are single-use and expire in ten minutes, which also bounds
 *        what a leaked one could ever do.
 * LINKS: docs/decisions/ADR-0010-whitelabel-payouts.md;
 *        ../screens/PayoutSetupScreen.tsx (the caller);
 *        supabase/functions/create-payout-account/index.ts (where the ids go);
 *        BountyPaymentProvider.tsx (why the publishable key is bundle-safe).
 */

import { PaymentError } from '@/shared/lib/functionError';

import type { PayoutDetails } from './payoutsApi';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Mandatory on every /v2 call; matches the server SDK's pinned line. */
const STRIPE_VERSION = '2026-03-25.dahlia';

const TOKEN_FAILURE = 'We couldn’t save your details. Please try again.';

/** Busy, down or offline — never "your details are wrong". "Partner", as the
 *  rest of the app says it. */
const UNREACHABLE = 'We couldn’t reach our payment partner. Please try again.';

/**
 * Mint the v2 account token carrying identity + ToS acceptance.
 *
 * `email` comes from the signed-in session (it is the account's contact and
 * the individual's email — Stripe allows it on recipient configurations).
 */
export async function createIdentityToken(
  details: PayoutDetails,
  email: string,
): Promise<string> {
  if (!publishableKey) {
    throw new PaymentError(TOKEN_FAILURE, 'NO_PUBLISHABLE_KEY');
  }

  const [year, month, day] = details.dob.split('-').map(Number);

  // Offline or a dropped connection: no answer at all, so never a refusal.
  const response = await fetch('https://api.stripe.com/v2/core/account_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      'Stripe-Version': STRIPE_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contact_email: email,
      display_name: `${details.firstName} ${details.lastName}`,
      identity: {
        entity_type: 'individual',
        attestations: {
          // The setup wizard's review showed our terms and the Stripe
          // Connected Account Agreement, and "Send to Stripe" was the
          // acceptance. Date/IP are observed by Stripe from THIS request.
          terms_of_service: { account: { shown_and_accepted: true } },
        },
        individual: {
          given_name: details.firstName,
          surname: details.lastName,
          email,
          phone: details.phone || undefined,
          date_of_birth: { day, month, year },
          address: {
            line1: details.addressLine1,
            line2: details.addressLine2 || undefined,
            city: details.city,
            postal_code: details.postalCode,
            country: 'GB',
          },
        },
      },
    }),
  }).catch(() => {
    throw new PaymentError(UNREACHABLE, 'STRIPE_UNAVAILABLE');
  });

  if (!response.ok) {
    // The response body can echo rejected identity values — never read into a
    // log or an error message. A fixed string is all the caller gets.
    //
    // ⚠️ BUSY OR DOWN IS NOT A REFUSAL (security review, 2026-10-13). A 429 or
    // a 5xx says nothing about the details, and DETAILS_REJECTED leads to
    // "Continue with Stripe", which spends the prefill window for good. Those
    // get a retry instead; only Stripe actually answering "no" is a refusal
    // (isRefusalStatus — a key problem on our side, 401/403, is not theirs).
    if (!isRefusalStatus(response.status)) {
      throw new PaymentError(UNREACHABLE, 'STRIPE_UNAVAILABLE');
    }
    throw new PaymentError(
      'Those details couldn’t be accepted. Please check them and try again.',
      'DETAILS_REJECTED',
    );
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) {
    throw new PaymentError(TOKEN_FAILURE, 'BAD_SHAPE');
  }
  return body.id;
}

/**
 * What a bank token needs. `PayoutDetails` satisfies this structurally; the
 * bank-only replacement form sends just the two numbers — the holder name is
 * already on the account at Stripe, and re-asking it to change a sort code
 * would be theatre.
 */
export interface BankTokenDetails {
  firstName?: string;
  lastName?: string;
  sortCode: string;
  accountNumber: string;
}

/**
 * Mint the bank token (a `btok_`) STRAIGHT from the phone to Stripe's
 * /v1/tokens with the publishable key, the identity path's mechanism.
 *
 * ⚠️ NOT THE SDK'S createToken ANY MORE (2026-10-16). Every error used to be
 * DETAILS_REJECTED, and that leads to "Set up another way", which spends the
 * prefill window for good — a spotter who lost signal lost the in-app form.
 * Telling "offline" from "wrong numbers" needs the error's type, and the
 * Android SDK (0.81) drops it: every failure arrives as `Failed` with a
 * message and nothing else. A plain request gives an HTTP status on both
 * platforms, read the same way as the identity token's.
 *
 * @throws PaymentError DETAILS_REJECTED when Stripe refuses the numbers (400 or
 *   402); STRIPE_UNAVAILABLE when there was no answer, or one that says nothing
 *   about the details (offline, 401/403, 429, 5xx).
 */
export async function createBankToken(details: BankTokenDetails): Promise<string> {
  if (!publishableKey) {
    throw new PaymentError(TOKEN_FAILURE, 'NO_PUBLISHABLE_KEY');
  }
  const form = new URLSearchParams({
    'bank_account[country]': 'GB',
    'bank_account[currency]': 'gbp',
    'bank_account[account_holder_type]': 'individual',
    // ⚠️ The sort code goes in routing_number — the one name that isn't
    // obvious, and getting it wrong makes a token Stripe accepts and can't pay.
    'bank_account[routing_number]': details.sortCode,
    'bank_account[account_number]': details.accountNumber,
  });
  if (details.firstName && details.lastName) {
    form.append('bank_account[account_holder_name]', `${details.firstName} ${details.lastName}`);
  }

  const response = await fetch('https://api.stripe.com/v1/tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }).catch(() => {
    throw new PaymentError(UNREACHABLE, 'STRIPE_UNAVAILABLE');
  });

  if (!response.ok) {
    // The body can echo the numbers — never read. The status is enough.
    if (!isRefusalStatus(response.status)) {
      throw new PaymentError(UNREACHABLE, 'STRIPE_UNAVAILABLE');
    }
    throw new PaymentError(
      'That bank account couldn’t be accepted. Please check it and try again.',
      'DETAILS_REJECTED',
    );
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) {
    throw new PaymentError(UNREACHABLE, 'STRIPE_UNAVAILABLE');
  }
  return body.id;
}

/**
 * Stripe actually judged the details: 400 (invalid_request_error) or 402
 * (card_error). Everything else — our key (401/403), busy (429), down (5xx) —
 * says nothing about what they typed, and must never lead to the path that
 * can't be undone.
 */
function isRefusalStatus(status: number): boolean {
  return status === 400 || status === 402;
}

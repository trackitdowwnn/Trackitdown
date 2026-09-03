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
 *        TWO TOKENS, TWO MECHANISMS, because Stripe splits them this way:
 *        - Identity (name, DOB, address, ToS acceptance) → a v2 ACCOUNT TOKEN,
 *          minted with the PUBLISHABLE key over plain fetch. There is no RN
 *          SDK wrapper and none is needed — it is a JSON REST endpoint. The
 *          `Stripe-Version` header is MANDATORY on every /v2 call.
 *        - Bank details → the RN SDK's own `createToken({type:'BankAccount'})`
 *          (a `btok_`), which needs the StripeProvider that already wraps the
 *          payout screen.
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
 *        ../components/PayoutDetailsForm.tsx (the caller);
 *        supabase/functions/create-payout-account/index.ts (where the ids go);
 *        BountyPaymentProvider.tsx (why the publishable key is bundle-safe).
 */

import { createToken } from '@stripe/stripe-react-native';

import { PaymentError } from '@/shared/lib/functionError';
import type { PayoutDetails } from './payoutsApi';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Mandatory on every /v2 call; matches the server SDK's pinned line. */
const STRIPE_VERSION = '2026-03-25.dahlia';

const TOKEN_FAILURE = 'We couldn’t save your details. Please try again.';

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
          // The form showed our terms and the Stripe Connected Account
          // Agreement, and Continue was the acceptance. Date/IP are observed
          // by Stripe from THIS request.
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
  });

  if (!response.ok) {
    // The response body can echo rejected identity values — never read into a
    // log or an error message. A fixed string is all the caller gets.
    throw new PaymentError(
      'Stripe couldn’t accept those details. Please check them and try again.',
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
 * Mint the bank token via the SDK. Needs a mounted StripeProvider —
 * PayoutsScreen wraps itself in BountyPaymentProvider for exactly this.
 */
export async function createBankToken(details: BankTokenDetails): Promise<string> {
  const holderName =
    details.firstName && details.lastName
      ? `${details.firstName} ${details.lastName}`
      : undefined;
  const { token, error } = await createToken({
    type: 'BankAccount',
    country: 'GB',
    currency: 'gbp',
    accountHolderName: holderName,
    accountHolderType: 'Individual',
    routingNumber: details.sortCode,
    accountNumber: details.accountNumber,
  });

  if (error || !token?.id) {
    throw new PaymentError(
      'Stripe couldn’t accept that bank account. Please check it and try again.',
      'DETAILS_REJECTED',
    );
  }
  return token.id;
}

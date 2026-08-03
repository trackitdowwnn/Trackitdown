/**
 * WHAT:  Takes the payout details a spotter typed into OUR form — bank account,
 *        name, date of birth, address, phone — and submits them to Stripe.
 * WHY:   Onboarding used to mean handing someone to Stripe's screen to type
 *        their bank details into Stripe's UI. Stripe permits a platform to
 *        submit those fields itself, in its own native forms, for an Express
 *        account:
 *
 *          "you can update all information UNTIL you create an Account Link or
 *           Account Session, after which some properties can no longer be
 *           updated"
 *
 *        THE WINDOW IS THE WHOLE POINT, AND IT SHUTS SILENTLY. Once a session
 *        exists this function can no longer change anything, for the life of
 *        that account — so `connect-onboarding` will not mint one until this
 *        has run. Until 2026-08-03 it minted a session on the first tap, which
 *        closed the window before any form of ours could ever be shown.
 *
 * MONEY/PII: THIS IS THE ONLY PLACE IN THE PRODUCT THAT TOUCHES RAW BANK
 *        DETAILS, AND IT IS A PASS-THROUGH. A sort code and account number
 *        arrive, go to Stripe, and are gone when the request ends. They are
 *        never written to our database — no column exists for them and none
 *        should — and never logged, not even redacted: a partial account number
 *        in a log is still an account number in a log. Only the fact that
 *        details were submitted is recorded, by `mark_payout_details_submitted`.
 *
 *        Tokenising instead (createToken → `btok_`) would keep the numbers off
 *        our server entirely, and is NOT available: a bank-account token may
 *        only be attached to an account where `controller.requirement_collection`
 *        is `application`, which Express is not. The raw dictionary is the only
 *        route Stripe offers here.
 *
 * SAFETY: the account is always the CALLER's, resolved from their JWT. No
 *        account id is accepted from the request body — an id that could travel
 *        over the wire is an id someone could change, and this endpoint writes
 *        the destination that money is eventually paid to.
 * LINKS: supabase/functions/_shared/connectAccount.ts (find/create);
 *        supabase/migrations/20260803120000_payout_details_submitted.sql;
 *        supabase/functions/connect-onboarding/index.ts (the gate this opens);
 *        src/features/payments/api/payoutsApi.ts (the caller).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { createConnectAccount, findConnectAccount } from '../_shared/connectAccount.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/** Exactly what the form may send. Anything else is ignored, not trusted. */
interface PayoutDetailsBody {
  firstName?: unknown;
  lastName?: unknown;
  dob?: unknown; // YYYY-MM-DD
  phone?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  postalCode?: unknown;
  sortCode?: unknown; // 6 digits, no dashes
  accountNumber?: unknown; // 8 digits
}

const asTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Digits only — the client formats for humans, Stripe wants the raw number. */
const asDigits = (value: unknown): string => asTrimmed(value).replace(/\D/g, '');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }

  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const userId = userData.user.id;

  let body: PayoutDetailsBody;
  try {
    body = (await request.json()) as PayoutDetailsBody;
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }

  const firstName = asTrimmed(body.firstName);
  const lastName = asTrimmed(body.lastName);
  const dob = asTrimmed(body.dob);
  const sortCode = asDigits(body.sortCode);
  const accountNumber = asDigits(body.accountNumber);
  const addressLine1 = asTrimmed(body.addressLine1);
  const city = asTrimmed(body.city);
  const postalCode = asTrimmed(body.postalCode);

  // Re-validated here, not just in the form: the client's zod schema is for the
  // person's benefit, this is for the account's. A malformed sort code accepted
  // here is a payout that fails silently weeks later.
  const dobMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (
    !firstName ||
    !lastName ||
    !dobMatch ||
    sortCode.length !== 6 ||
    accountNumber.length !== 8 ||
    !addressLine1 ||
    !city ||
    !postalCode
  ) {
    // Deliberately vague and field-less: the form already said which box is
    // wrong, and naming bank fields in a response body invites logging them.
    return errorResponse('INVALID_DETAILS', 'Please check your details and try again.', 400);
  }

  // --- The account must exist before anything can be attached to it ----------
  let lookup;
  try {
    lookup = await findConnectAccount(admin, userId);
  } catch (err) {
    console.error('[payments] payout details lookup failed', (err as Error).message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t save your details. Please try again.', 500);
  }

  // Past the window. Stripe will refuse the update, so say so rather than
  // pretending it worked — the embedded component is where they go now.
  if (lookup.payoutsEnabled) {
    return jsonResponse({ status: 'already_enabled' });
  }

  const stripe = createStripeClient();
  let accountId = lookup.accountId;
  if (!accountId) {
    try {
      accountId = await createConnectAccount(stripe, admin, userId);
    } catch (err) {
      console.error('[payments] payout account create failed', (err as Error).message);
      return errorResponse('STRIPE_ERROR', 'We couldn’t save your details. Please try again.', 502);
    }
  }

  // --- The submission -------------------------------------------------------
  try {
    await stripe.accounts.update(accountId, {
      business_type: 'individual',
      individual: {
        first_name: firstName,
        last_name: lastName,
        dob: {
          year: Number(dobMatch[1]),
          month: Number(dobMatch[2]),
          day: Number(dobMatch[3]),
        },
        address: {
          line1: addressLine1,
          line2: asTrimmed(body.addressLine2) || undefined,
          city,
          postal_code: postalCode,
          country: 'GB',
        },
        phone: asTrimmed(body.phone) || undefined,
        email: userData.user.email ?? undefined,
      },
      business_profile: {
        // What the account is FOR. Stripe requires a product description and an
        // MCC; 7399 is "business services, not elsewhere classified", which is
        // what an information reward is.
        mcc: '7399',
        product_description: 'Rewards for reporting sightings of stolen vehicles.',
      },
      // RAW DICTIONARY, NOT A TOKEN — see the header. Express accounts reject
      // `btok_` values, and this is the only route Stripe offers.
      external_account: {
        object: 'bank_account',
        country: 'GB',
        currency: 'gbp',
        account_holder_name: `${firstName} ${lastName}`,
        account_holder_type: 'individual',
        routing_number: sortCode,
        account_number: accountNumber,
      },
    });
  } catch (err) {
    // Stripe's message can quote the value it rejected, so it is not logged and
    // never reaches the client. The `type` is enough to tell a validation
    // rejection from an outage.
    const failure = err as { type?: string };
    console.error('[payments] payout details rejected', { type: failure.type ?? 'unknown' });
    return errorResponse(
      'DETAILS_REJECTED',
      'Stripe couldn’t accept those details. Please check them and try again.',
      400,
    );
  }

  // Opens the gate: `connect-onboarding` may now mint a session.
  const { error: markError } = await admin.rpc('mark_payout_details_submitted', {
    p_profile_id: userId,
    p_stripe_account_id: accountId,
  });
  if (markError) {
    // The details ARE with Stripe; only our note of it failed. Retrying is safe
    // (the update is a plain overwrite), so this is a retryable error rather
    // than a lie about what happened.
    console.error('[payments] payout details mark failed', markError.message);
    return errorResponse('LEDGER_ERROR', 'Your details are saved. Please check back shortly.', 500);
  }

  // Counts and outcomes only. Nothing from the body is ever logged.
  console.log('[payments] payout details submitted', { accountId });
  return jsonResponse({ status: 'submitted' });
});

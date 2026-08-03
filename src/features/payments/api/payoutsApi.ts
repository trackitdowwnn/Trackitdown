/**
 * WHAT:  The client boundary to the PAYEE half of the money loop — starts (or
 *        resumes, or updates) a spotter's Stripe Connect onboarding, and reads
 *        back where their account stands.
 * WHY:   `release-payout` will not move a penny unless
 *        `stripe_connected_accounts.payouts_enabled` is true, and until this
 *        file existed nothing in the app could give a spotter an account at
 *        all. The escrow had a payer and no payee.
 *
 *        SEPARATE FROM paymentsApi.ts on purpose: that file's job is the
 *        bounty escrow — charging an owner and refunding them. This is the
 *        person on the other side of the transfer, with different states and a
 *        different failure vocabulary. They share `parseFunctionError` and the
 *        one `PaymentError` class, and nothing else.
 *
 * MONEY: nothing here moves money, and nothing here decides who is payable.
 *        The onboarding call sends NO account id (see below), and the readiness
 *        flags are written only by Stripe's own `account.updated` webhook. A
 *        client cannot make itself payable.
 * LINKS: supabase/functions/connect-onboarding/index.ts (the codes mapped here);
 *        supabase/functions/stripe-webhook/index.ts (account.updated — the only
 *          writer of payouts_enabled);
 *        supabase/functions/release-payout/index.ts (what this unblocks);
 *        ../hooks/usePayoutAccount.ts (the state machine over this).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { PaymentError, parseFunctionError } from './functionError';

const log = createLogger('payments');

/** Codes the connect-onboarding function returns → user-facing copy. */
export const PAYOUT_ONBOARDING_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to set up payouts.',
  LOOKUP_FAILED: 'We couldn’t set up payouts. Please try again.',
  STRIPE_ERROR: 'We couldn’t set up payouts. Please try again.',
  LEDGER_ERROR: 'We couldn’t set up payouts. Please try again.',
  METHOD_NOT_ALLOWED: 'We couldn’t set up payouts. Please try again.',
};

const ONBOARDING_FALLBACK = 'We couldn’t set up payouts. Please try again.';

/**
 * What the server wants to happen next. Three of these are distinguished by
 * WHERE the flow runs, not just what it is:
 *
 * - `onboarding_session` — setup, INSIDE the app via Stripe's embedded
 *   component. The normal path, and the reason this union changed shape.
 * - `onboarding_required` — the same setup as a hosted link, in a browser.
 *   Only ever returned if the session mint failed; kept so a Stripe hiccup
 *   degrades to worse UX rather than to a spotter who cannot be paid.
 * - `update_available` — changing details on an account that already works.
 *   Stays hosted because Stripe's Account Management component is not
 *   supported on React Native.
 * - `already_enabled` — nothing to do, and so no credential of any kind.
 */
export type ConnectOnboardingResult =
  | { status: 'already_enabled' }
  /** Our own form has not run yet. Minting a session first would shut the
   *  window in which we are allowed to submit details at all. */
  | { status: 'details_required' }
  | { status: 'onboarding_session'; clientSecret: string }
  | { status: 'onboarding_required'; url: string }
  | { status: 'update_available'; url: string };

/**
 * What a spotter types into our own form.
 *
 * PII: this object exists for the length of one request. It is never put into
 * state that outlives the screen, never persisted, and never logged — see
 * `submitPayoutDetails`.
 */
export interface PayoutDetails {
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  dob: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
  /** 6 digits; the form may show it spaced, this carries it raw. */
  sortCode: string;
  /** 8 digits. */
  accountNumber: string;
}

/** A spotter's payee account as the database knows it. */
export interface PayoutAccount {
  stripeAccountId: string;
  /** They finished Stripe's FORM. Not the same as being payable. */
  onboardingComplete: boolean;
  /** Stripe says money can reach them. The only flag that matters to a payout. */
  payoutsEnabled: boolean;
}

/**
 * Ask for a hosted onboarding link (creating the Express account if needed).
 *
 * SECURITY: sends NO body. The account is always the caller's, resolved from
 * their JWT server-side — `connect-onboarding` is explicit that "a payee id
 * that arrived over the wire is a payee id someone could change". This is the
 * payouts equivalent of never sending an amount, and it is pinned by a test.
 */
export async function startConnectOnboarding(
  options: { skipPrefill?: boolean } = {},
): Promise<ConnectOnboardingResult> {
  log.debug('connect-onboarding invoke', { skipPrefill: Boolean(options.skipPrefill) });
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    url?: string;
    clientSecret?: string;
  }>('connect-onboarding', options.skipPrefill ? { body: { skipPrefill: true } } : undefined);

  if (error) {
    const failure = await parseFunctionError(
      error,
      PAYOUT_ONBOARDING_ERROR_MESSAGES,
      ONBOARDING_FALLBACK,
    );
    log.warn('connect-onboarding failed', { code: failure.code });
    throw failure;
  }

  if (data?.status === 'already_enabled') {
    log.info('payout onboarding already complete');
    return { status: 'already_enabled' };
  }

  if (data?.status === 'details_required') {
    log.info('payout details not yet submitted');
    return { status: 'details_required' };
  }

  // The in-app path. Never log the secret — it authorises the embedded
  // component against someone's identity documents.
  if (data?.status === 'onboarding_session' && data.clientSecret) {
    log.info('payout onboarding session ready');
    return { status: 'onboarding_session', clientSecret: data.clientSecret };
  }

  // Both link shapes REQUIRE a url; a link-less one would leave the screen
  // waiting for a browser that never opens.
  if (
    (data?.status === 'onboarding_required' || data?.status === 'update_available') &&
    data.url
  ) {
    log.info('payout onboarding link ready', { status: data.status });
    return { status: data.status, url: data.url };
  }

  // Never log `data` — a hosted link is a bearer URL into someone's identity
  // documents, and a malformed body may still contain one.
  log.error('connect-onboarding returned an unexpected shape');
  throw new PaymentError(ONBOARDING_FALLBACK, 'BAD_SHAPE');
}

const DETAILS_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to set up payouts.',
  INVALID_DETAILS: 'Please check your details and try again.',
  DETAILS_REJECTED: 'Stripe couldn’t accept those details. Please check them and try again.',
  LOOKUP_FAILED: 'We couldn’t save your details. Please try again.',
  STRIPE_ERROR: 'We couldn’t save your details. Please try again.',
  LEDGER_ERROR: 'Your details are saved. Please check back shortly.',
};

const DETAILS_FALLBACK = 'We couldn’t save your details. Please try again.';

/**
 * Send the details a spotter typed into our own form straight to Stripe.
 *
 * PII: the ONLY call in the app carrying a sort code and account number. They
 * go over HTTPS to our Edge Function, on to Stripe, and are gone. Nothing here
 * logs the argument — not a field, not a length, not a masked tail. A partial
 * account number in a log is still an account number in a log, and there is a
 * test asserting this stays true.
 *
 * SECURITY: no account id is sent. The payee is resolved from the caller's JWT
 * server-side, because this call decides where money eventually lands.
 */
export async function submitPayoutDetails(details: PayoutDetails): Promise<void> {
  log.debug('submit-payout-details invoke');
  const { error } = await supabase.functions.invoke('submit-payout-details', {
    body: details,
  });

  if (error) {
    const failure = await parseFunctionError(error, DETAILS_ERROR_MESSAGES, DETAILS_FALLBACK);
    // The code, and nothing else. The body that failed is not ours to repeat.
    log.warn('submit-payout-details failed', { code: failure.code });
    throw failure;
  }
  log.info('payout details submitted');
}

/**
 * Read my own payee account, or null if I have never started.
 *
 * `maybeSingle`, not `single`: having no row is the normal state for everyone
 * who has not set payouts up, which is almost everyone. Treating that as an
 * error would make the happy path throw.
 *
 * Readable client-side via the table's `select_own` RLS policy; the client can
 * never write it.
 */
export async function fetchMyPayoutAccount(userId: string): Promise<PayoutAccount | null> {
  const { data, error } = await supabase
    .from('stripe_connected_accounts')
    .select('stripe_account_id, onboarding_complete, payouts_enabled')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    log.warn('payout account load failed', { code: error.code });
    throw new PaymentError('We couldn’t load your payout details.', error.code ?? 'UNKNOWN');
  }
  if (!data) {
    return null;
  }
  return {
    stripeAccountId: data.stripe_account_id as string,
    onboardingComplete: Boolean(data.onboarding_complete),
    payoutsEnabled: Boolean(data.payouts_enabled),
  };
}

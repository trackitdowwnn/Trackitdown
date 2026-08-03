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
  | { status: 'onboarding_session'; clientSecret: string }
  | { status: 'onboarding_required'; url: string }
  | { status: 'update_available'; url: string };

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
export async function startConnectOnboarding(): Promise<ConnectOnboardingResult> {
  log.debug('connect-onboarding invoke');
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    url?: string;
    clientSecret?: string;
  }>('connect-onboarding');

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

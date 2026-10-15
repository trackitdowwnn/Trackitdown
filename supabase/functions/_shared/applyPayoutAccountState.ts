/**
 * WHAT:  applyPayoutAccountState — records what Stripe says about a spotter's
 *        payee account, and pays what they're owed the moment it FIRST becomes
 *        payable. syncPayoutAccountFromStripe — the same, starting from nothing
 *        but a Stripe account id (what a v2 event carries).
 * WHY:   2026-10-14. Accounts v2 announce "can now be paid" with v2 THIN
 *        events (`v2.core.account[configuration.recipient].capability_status_updated`,
 *        `v2.core.account[requirements].updated`), not the v1 `account.updated`
 *        the webhook listened for — Stripe's own guidance for v2 is not to rely
 *        on it. So the spotter's screen sat on "being checked" until something
 *        happened to ask Stripe directly. Now the webhook asks on those events,
 *        and sync-payout-account asks when the screen opens; both land HERE, so
 *        "record it, then release if newly payable" exists exactly once.
 *
 *        The release is injected, not imported: the money core pulls in the
 *        collusion gate and the ledger, and this stays drivable by a fake in
 *        Jest (supabase/tests/applyPayoutAccountState.test.ts). Callers pass
 *        `releaseAllPendingFor` — idempotent, collusion-gated, never throws.
 *
 * MONEY: release only on the false → true edge, and only after the row says
 *        so. A failed write releases nothing: the next event or check retries.
 *        An account id we never recorded is ignored — matching an event to a
 *        spotter by anything else risks paying a stranger.
 * LINKS: ./payoutAccountState.ts (the read); ./releasePayout.ts;
 *        ../stripe-webhook/index.ts; ../sync-payout-account/index.ts;
 *        migrations 20261013130000 (upsert never un-submits).
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

import { readPayoutAccountState, type PayoutAccountState } from './payoutAccountState.ts';

/** Our row for a payee account, as last recorded. */
export interface RecordedPayoutAccount {
  profileId: string;
  accountId: string;
  onboardingComplete: boolean;
  payoutsEnabled: boolean;
}

export type ApplyResult =
  | { ok: true; changed: boolean; becamePayable: boolean }
  | { ok: false; error: string };

/**
 * Record Stripe's answer if it differs from our row, then — if the account has
 * just become payable — send whatever its spotter is already owed.
 */
export async function applyPayoutAccountState(
  admin: SupabaseClient,
  recorded: RecordedPayoutAccount,
  fresh: PayoutAccountState,
  release: (profileId: string) => Promise<void>,
): Promise<ApplyResult> {
  const changed =
    fresh.payoutsEnabled !== recorded.payoutsEnabled ||
    (fresh.detailsSubmitted && !recorded.onboardingComplete);

  if (changed) {
    const { error } = await admin.rpc('upsert_connected_account', {
      p_profile_id: recorded.profileId,
      p_stripe_account_id: recorded.accountId,
      // Never undone here or in the RPC: our own steps ARE the submission for
      // a v2 account, whatever v1's flag says (20261013130000).
      p_onboarding_complete: recorded.onboardingComplete || fresh.detailsSubmitted,
      p_payouts_enabled: fresh.payoutsEnabled,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    // Flags only — never a name, never a bank detail.
    console.log('[payments] payout account state recorded', {
      accountId: recorded.accountId,
      payoutsEnabled: fresh.payoutsEnabled,
    });
  }

  // "Paid into account ending 5678" (2026-10-15, PR7): Stripe's default bank,
  // kept current wherever it was changed. Best effort — a label must never
  // fail the record above or hold up a release below — and the RPC writes
  // only when it differs. The digits are never logged.
  if (fresh.bankLast4) {
    try {
      const { error } = await admin.rpc('record_bank_last4', {
        p_stripe_account_id: recorded.accountId,
        p_last4: fresh.bankLast4,
      });
      if (error) throw new Error(error.message);
    } catch {
      console.warn('[payments] bank last4 record failed', { accountId: recorded.accountId });
    }
  }

  const becamePayable = fresh.payoutsEnabled && !recorded.payoutsEnabled;
  if (becamePayable) {
    await release(recorded.profileId);
  }
  return { ok: true, changed, becamePayable };
}

/** Our row for a Stripe account id, or null if we never recorded it. Throws on a read error. */
export async function findPayoutAccountByStripeId(
  admin: SupabaseClient,
  accountId: string,
): Promise<RecordedPayoutAccount | null> {
  const { data, error } = await admin
    .from('stripe_connected_accounts')
    .select('profile_id, onboarding_complete, payouts_enabled')
    .eq('stripe_account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`payout account lookup failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return {
    profileId: data.profile_id as string,
    accountId,
    onboardingComplete: Boolean(data.onboarding_complete),
    payoutsEnabled: Boolean(data.payouts_enabled),
  };
}

export type SyncFromStripeResult =
  | { outcome: 'applied'; changed: boolean; becamePayable: boolean }
  | { outcome: 'unknown_account' }
  | { outcome: 'unreadable' };

/**
 * A v2 account event's handler: find our row, ask Stripe, apply. Throws on a
 * failed read or write of OUR side, so the webhook answers 500 and Stripe
 * redelivers. An unknown account is answered, not thrown — no retry will make
 * it ours. An unreadable Stripe is returned for the caller to decide: the
 * webhook retries it (a blip passes), a screen just shows what it showed.
 */
export async function syncPayoutAccountFromStripe(
  admin: SupabaseClient,
  stripe: Stripe,
  accountId: string,
  release: (profileId: string) => Promise<void>,
): Promise<SyncFromStripeResult> {
  const recorded = await findPayoutAccountByStripeId(admin, accountId);
  if (!recorded) {
    return { outcome: 'unknown_account' };
  }
  const fresh = await readPayoutAccountState(stripe, accountId);
  if (!fresh) {
    return { outcome: 'unreadable' };
  }
  const result = await applyPayoutAccountState(admin, recorded, fresh, release);
  if (!result.ok) {
    throw new Error(`payout account write failed: ${result.error}`);
  }
  return { outcome: 'applied', changed: result.changed, becamePayable: result.becamePayable };
}

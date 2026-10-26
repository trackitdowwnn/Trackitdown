/**
 * WHAT:  Stripe webhook receiver — the AUTHORITATIVE source of the payment state
 *        change. Verifies the Stripe signature, dedupes the event, and on
 *        payment_intent.succeeded advances the ledger row and the post
 *        draft -> ACTIVE (live-on-payment); on payment_intent.payment_failed
 *        marks the ledger row failed (post left as draft for retry); on
 *        charge.refunded reconciles the refund through reconcile_payment_refund,
 *        which decides from the ledger — the post's CURRENT reward closes the
 *        post (cancelled, or recovered_no_spotter on a claimed recovery) unless
 *        it ENDED at its term (a reward_end hold: the listing stays up as
 *        "Reward ended", 20261006130000), and a superseded payment (renewed,
 *        or a stray capture) never touches it. The
 *        exit functions and the sweep are authoritative; this reconciles them.
 *        charge.refund.updated with status failed emails the operator, and so
 *        do charge.dispute.created/closed and transfer.reversed (2026-10-16:
 *        the platform takes a chargeback's loss, never a spotter). v2 THIN
 *        account events (their own destination and secret, 2026-10-14) re-read
 *        a spotter's payee account and pay them if it just became payable —
 *        see handleThinEvent at the bottom. payout.* (from the connected-
 *        accounts endpoint and its own secret, 2026-10-14) records a spotter's
 *        payout to their bank, and a failed one pushes them once.
 *
 *        The succeeded branch serves BOTH pricing modes through ONE function,
 *        mark_post_payment_held, which reads the post: a NULL bounty is a free
 *        listing whose payments row already carries kind='listing_fee'
 *        (20260819100000). A fee lands in 'collected' (ADR-0018), a bounty in
 *        'held' (a stray lands 'superseded'), and both take a draft post live:
 *        a fee post must reach spotters exactly as an escrowed one does. When
 *        a capture CHANGES a live listing's reward, the reward it replaced is
 *        now 'superseded' — and this function refunds it straight away, after
 *        the event is recorded (_shared/afterCapture.ts, with the alerts and
 *        the owner's "your listing is live"; the sweep retries the refund).
 *
 *        Fees are never refunded: a fee is never 'held' or 'superseded', and
 *        reconcile_payment_refund leaves any other status unchanged, so a
 *        refund event for one is a no-op.
 * WHY:   The client success callback is NOT trusted to move money state — a
 *        cancelled app, a lying client, or a lost network must never leave
 *        escrow and the post out of sync. Stripe calls this endpoint directly;
 *        the signed payload (STRIPE_WEBHOOK_SECRET) proves it's really Stripe,
 *        and the event-id dedup + the idempotent SQL functions make redelivered
 *        or out-of-order events safe. Always answer 2xx once handled (or safely
 *        skipped) so Stripe stops retrying; only signature/parse failures 4xx.
 * LINKS: supabase/functions/_shared/clients.ts;
 *        supabase/migrations/20260726100000_post_payment.sql
 *          (claim_stripe_event, mark_post_payment_held, mark_post_payment_failed);
 *        supabase/migrations/20260730100000_live_on_payment.sql (redefines
 *          mark_post_payment_held: draft -> ACTIVE);
 *        supabase/migrations/20260819100000_a_listing_can_be_free.sql
 *          (payments.kind, and record_post_payment_intent serving both prices);
 *        docs/decisions/ADR-0014-no-bounty-listings.md;
 *        supabase/migrations/20261005110000_a_reward_can_be_replaced.sql
 *          (reconcile_payment_refund — the charge.refunded branch; renewal and
 *          strays in mark_post_payment_held);
 *        supabase/functions/_shared/opsAlert.ts;
 *        docs/decisions/ADR-0002-stripe-connect.md (webhooks: verify + dedupe +
 *          idempotent); supabase/functions/README.md (registering the endpoint).
 */

import type Stripe from 'npm:stripe@22.4.0';

import {
  createServiceRoleClient,
  createStripeClient,
  requireEnv,
  stripeCryptoProvider,
} from '../_shared/clients.ts';
import { followUpCapture } from '../_shared/afterCapture.ts';
import { syncPayoutAccountFromStripe } from '../_shared/applyPayoutAccountState.ts';
import { releaseAllPendingFor } from '../_shared/releasePayout.ts';
import { sendOpsAlert } from '../_shared/opsAlert.ts';
import { notifyUsers } from '../_shared/push.ts';

/** True when this deployment's Stripe key is a LIVE one — every event must
 *  match it (sk_live_ / rk_live_ vs the test keys). */
const LIVE_KEY = /^(sk|rk)_live_/.test(Deno.env.get('STRIPE_SECRET_KEY') ?? '');

// NOTE: no CORS / preflight — Stripe calls this server-to-server, not a browser.
// The endpoint takes the RAW body (signature is computed over the exact bytes),
// so this must never be invoked through supabase.functions.invoke (which JSON-
// encodes). It is registered directly as a Stripe webhook endpoint URL.
Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = request.headers.get('Stripe-Signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  const stripe = createStripeClient();
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');

  // Verify the signature over the RAW request body. constructEventAsync +
  // the SubtleCrypto provider is the Deno-compatible verification path.
  //
  // TWO v1 SECRETS (2026-10-14): a v1 endpoint listens to "Your account" OR
  // "Connected accounts", never both, so the connected-account events —
  // payout.* from spotters' accounts, and v1 account.updated — come from a
  // second endpoint with its own secret (STRIPE_CONNECT_WEBHOOK_SECRET,
  // optional: unset, everything is as before).
  const rawBody = await request.text();
  const v1Secrets = [webhookSecret, Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(
    (secret): secret is string => Boolean(secret),
  );
  let verified: Stripe.Event | null = null;
  let verifyError: unknown = null;
  for (const secret of v1Secrets) {
    try {
      verified = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        secret,
        undefined,
        stripeCryptoProvider,
      );
      break;
    } catch (err) {
      verifyError = err;
    }
  }
  if (!verified) {
    const err = verifyError;
    // Not a v1 event under either v1 secret. It may be a v2 THIN event from the
    // event destination, which signs with its own secret (2026-10-14) — tried
    // only when that secret is configured, so without it nothing changes.
    const thinSecret = Deno.env.get('STRIPE_THIN_WEBHOOK_SECRET');
    if (thinSecret) {
      let notification: ThinEventNotification | null = null;
      try {
        notification = await stripe.parseEventNotificationAsync(
          rawBody,
          signature,
          thinSecret,
          undefined,
          stripeCryptoProvider,
        );
      } catch {
        notification = null;
      }
      if (notification) {
        return handleThinEvent(stripe, notification);
      }
    }
    // A bad signature is the one case we reject — it isn't really Stripe.
    console.error('[payments] webhook signature verification failed', (err as Error).message);
    return new Response('Invalid signature', { status: 400 });
  }
  const event: Stripe.Event = verified;

  // SAFETY (audit hardening, 2026-10-26): an event from the OTHER mode than
  // this deployment's key — a sandbox endpoint secret left configured after
  // the company-account move, say — is acknowledged and never applied.
  if (event.livemode !== LIVE_KEY) {
    console.warn('[payments] webhook event from the other mode ignored', {
      type: event.type,
      livemode: event.livemode,
    });
    return new Response(JSON.stringify({ received: true, ignored: 'mode' }), { status: 200 });
  }

  const admin = createServiceRoleClient();

  // Dedup — PROCESS FIRST, RECORD AFTER. The event id is written to
  // stripe_webhook_events ONLY after the state change has committed, so a
  // recorded id always means "already fully applied" and skipping it is safe.
  // A crash mid-processing therefore leaves NO record, and Stripe's retry
  // reprocesses cleanly (the mark_* functions are idempotent + never-regress) —
  // the money transition can never be silently swallowed by a premature claim.
  const { data: existing, error: lookupError } = await admin
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (lookupError) {
    // Couldn't reach the dedup ledger — 500 so Stripe retries later.
    console.error('[payments] dedup lookup failed', lookupError.message);
    return new Response('Dedup failed', { status: 500 });
  }
  if (existing) {
    return new Response(JSON.stringify({ received: true, deduped: true }), { status: 200 });
  }

  // Set when this event took a post live, so spotter alerts can be dispatched
  // AFTER the money state is fully recorded (see the bottom of this function).
  let wentLiveIntentId: string | null = null;
  // Set when this event recorded a FAILED payout to a spotter's bank, so its
  // one push goes out after the event is recorded (bottom of this function).
  let failedPayout: { accountId: string; payoutId: string } | null = null;

  // Route the handled event types to the idempotent money-state functions.
  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      // ⚠️ mark_post_payment_HELD, not mark_post_payment_succeeded. This called
      // the latter between 2026-08-21 14:22 and 2026-08-22, and that function
      // exists only in 20260820110000 — a migration this project has never
      // applied. Every payment_intent.succeeded in that window therefore threw
      // here: the card was charged and the post stayed in draft. Nothing about
      // the pricing mode caused it; BOUNTY payments broke too.
      //
      // Production dispatches in SQL instead: mark_post_payment_held reads the
      // post, and a NULL bounty is a free listing whose payments row already
      // carries kind='listing_fee' (20260819100000). One call, both modes,
      // idempotent and never-regress.
      const { error } = await admin.rpc('mark_post_payment_held', {
        p_payment_intent_id: intent.id,
      });
      if (error) throw error;
      console.log('[payments] charge captured', { paymentIntentId: intent.id });
      // Correct for BOTH kinds: a fee post goes draft -> active exactly as an
      // escrowed one does, so it must reach spotters the same way.
      wentLiveIntentId = intent.id;
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { error } = await admin.rpc('mark_post_payment_failed', {
        p_payment_intent_id: intent.id,
      });
      if (error) throw error;
      console.log('[payments] escrow charge failed', { paymentIntentId: intent.id });
    } else if (event.type === 'charge.refunded') {
      // Belt-and-braces confirmation of a reward refund. The exit functions and
      // the sweep are authoritative (they issue the refund and record it); this
      // reconciles the SAME state idempotently if that request died after the
      // refund was issued.
      //
      // ⚠️ THROUGH reconcile_payment_refund, NOT mark_post_payment_refunded
      // (2026-10-05). The old call cancelled the post for ANY refunded charge.
      // Once a reward can be renewed, a post has had more than one payment, and
      // the refund of the OLD one (or a redelivery of that event) would take the
      // live, renewed listing down. reconcile decides from the ledger: a
      // superseded payment is recorded with the post untouched; only the post's
      // current held reward can close it.
      const charge = event.data.object as Stripe.Charge;
      const intentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;
      // The refund sub-list may not be expanded in the event; amount_refunded is
      // always present. Prefer the inline refund id, else look it up by intent so
      // the reconcile path still records WHICH refund (this only fires if the
      // primary deactivate-post path died after issuing the refund).
      let refundId = charge.refunds?.data?.[0]?.id ?? null;
      if (intentId && !refundId) {
        try {
          const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 1 });
          refundId = refunds.data[0]?.id ?? null;
        } catch (err) {
          console.warn('[payments] refund id lookup failed', (err as Error).message);
        }
      }
      if (intentId) {
        const { data: outcome, error } = await admin.rpc('reconcile_payment_refund', {
          p_payment_intent_id: intentId,
          p_refund_id: refundId,
          p_refunded_amount_pence: charge.amount_refunded,
        });
        if (error) throw error;
        console.log('[payments] refund confirmed', { paymentIntentId: intentId, outcome });
        if (outcome === 'refunded_with_credited_sighting') {
          // Only a refund made by hand in the dashboard reaches this: the money
          // a credited spotter was owed went back to the owner. The ledger now
          // says so; the post is deliberately left in recovery_claimed because
          // no terminal state is true. A person settles it with the spotter.
          await sendOpsAlert('A credited recovery was refunded to the owner', [
            `PaymentIntent: ${intentId}`,
            '',
            'The sighting credited on this post is now unfunded, and the post stays in recovery_claimed.',
            'Tell the spotter what happened, and decide the post’s final state by hand. See docs/OPERATIONS.md (money deadlines).',
          ]);
        }
      }
    } else if (event.type === 'charge.refund.updated') {
      // A refund that FAILS after it was accepted (e.g. the card was closed and
      // the bank bounced it) puts the money back on the platform balance, where
      // the 90-day limit is still running and the ledger already says
      // `refunded`. Nothing can fix that automatically — a person must reach
      // the owner — so it is emailed to the operator. Only the ids: the event
      // body carries nothing else this needs.
      // ⚠️ Stripe only sends this if the endpoint subscribes to
      // charge.refund.updated (Dashboard → Developers → Webhooks).
      const refund = event.data.object as Stripe.Refund;
      if (refund.status === 'failed') {
        const intentId =
          typeof refund.payment_intent === 'string'
            ? refund.payment_intent
            : refund.payment_intent?.id ?? null;
        await sendOpsAlert('A refund failed — money is back on the platform balance', [
          `Refund: ${refund.id}`,
          `PaymentIntent: ${intentId ?? 'unknown'}`,
          `Failure reason: ${refund.failure_reason ?? 'not given'}`,
          '',
          'The ledger says refunded, but the money returned to the platform balance, where Stripe’s 90-day limit still runs.',
          'Contact the owner and return it another way, then note it on the payment. See docs/OPERATIONS.md (money deadlines).',
        ]);
      }
    } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      // A CHARGEBACK (2026-10-16). We are the merchant of record and carry the
      // losses, so Stripe takes the disputed amount and fee from the platform
      // balance, whether or not the reward has already been paid out. The owner's
      // decision: the platform takes the loss and contests it with evidence, and
      // NEVER claws money back from a spotter. So nothing moves here. A person
      // must answer the dispute before its deadline, and Stripe only tells us
      // through this event. Ids, state and dates only (sendOpsAlert's rule).
      const dispute = event.data.object as Stripe.Dispute;
      const intentId =
        typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id ?? null;
      let postId: string | null = null;
      let kind: string | null = null;
      if (intentId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(intentId);
          postId = intent.metadata?.post_id ?? null;
          kind = intent.metadata?.kind ?? null;
        } catch (err) {
          // The alert matters more than the post id; the dispute id finds it.
          console.warn('[payments] dispute intent lookup failed', (err as Error).message);
        }
      }
      const dueBy = dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
        : 'not given';
      if (event.type === 'charge.dispute.created') {
        await sendOpsAlert('A payment was disputed (chargeback)', [
          `Dispute: ${dispute.id}`,
          `PaymentIntent: ${intentId ?? 'unknown'}`,
          `Post: ${postId ?? 'unknown'} (${kind ?? 'unknown kind'})`,
          `Reason: ${dispute.reason}`,
          `Evidence due by: ${dueBy}`,
          '',
          'Stripe has already taken the disputed amount from the platform balance. Do not reverse the spotter’s payout.',
          'Submit evidence in the Stripe dashboard before the deadline. See docs/OPERATIONS.md §8, "A payment was disputed".',
        ]);
      } else {
        await sendOpsAlert(`A dispute closed: ${dispute.status}`, [
          `Dispute: ${dispute.id}`,
          `PaymentIntent: ${intentId ?? 'unknown'}`,
          `Post: ${postId ?? 'unknown'} (${kind ?? 'unknown kind'})`,
          `Outcome: ${dispute.status}`,
        ]);
      }
    } else if (event.type === 'transfer.reversed') {
      // A spotter's payout was taken back. Nothing here reverses transfers,
      // so this only happens by hand (OPERATIONS.md §8, "A lapse found a
      // transfer") or by Stripe. Either way the ledger still says `recovered`
      // and paid. A person must check that the two agree.
      const transfer = event.data.object as Stripe.Transfer;
      await sendOpsAlert('A spotter’s payout was reversed', [
        `Transfer: ${transfer.id}`,
        `Post: ${transfer.metadata?.post_id ?? 'unknown'}`,
        `Sighting: ${transfer.metadata?.sighting_id ?? 'unknown'}`,
        `Fully reversed: ${transfer.reversed ? 'yes' : 'no (partial)'}`,
        '',
        'The ledger still records this payout as sent. Check the post and the spotter, and settle it by hand.',
      ]);
    } else if (event.type === 'account.updated') {
      // A SPOTTER'S payee account changed — almost always them finishing, or
      // abandoning, Stripe's hosted onboarding.
      //
      // WHY THIS MATTERS MORE THAN IT LOOKS: `release-payout` refuses to
      // transfer unless `payouts_enabled` is true, and NOTHING ELSE EVER SETS
      // IT. Without this branch a spotter could complete onboarding perfectly
      // and still never be paid: `release-payout` would answer
      // `awaiting_payee` forever, and the owner would keep being told the
      // spotter still had to add their bank details — about someone who
      // already had. A silent, permanent failure that reads as their fault.
      //
      // Stripe is the authority on both flags, so they are COPIED, never
      // inferred. `details_submitted` only means the form was finished —
      // verification can still fail afterwards, and that is precisely the case
      // that must not look ready. `charges_enabled` is irrelevant here: we
      // never charge a connected account, we only transfer to one.
      //
      // ⚠️ RESOLVED BY THE ACCOUNT ID WE RECORDED, READ FRESH (2026-10-26,
      // security audit hardening). This used to take the profile from
      // account.metadata.profile_id and copy the event's own snapshot of the
      // flags: a delayed older delivery could set payouts_enabled back to true
      // after Stripe had turned it off (and release money on it), and the
      // upsert could re-point a profile's payout destination to whatever
      // account the metadata named. Now it is the same path as the v2 events
      // below — find OUR row by account id, ask Stripe for the account as it is
      // now, record it, and release on the false → true edge
      // (applyPayoutAccountState). Order and duplicates stop mattering, and a
      // webhook can never change which account a spotter is paid into: only
      // the onboarding functions, acting on the spotter's own JWT, record that.
      //
      // MONEY: the collusion gate runs INSIDE the release core, on this path
      // too, and it never throws — a release failure must not 500 this event.
      const account = event.data.object as Stripe.Account;
      const result = await syncPayoutAccountFromStripe(admin, stripe, account.id, (profileId) =>
        releaseAllPendingFor(admin, stripe, profileId),
      );
      if (result.outcome === 'unreadable') {
        // A Stripe blip — thrown so this event is answered 500 and redelivered.
        throw new Error('payout account unreadable');
      }
      if (result.outcome === 'unknown_account') {
        // Not one we recorded: every creator records the id before onboarding
        // can begin, so this is another integration or a test account. Never
        // guessed at — that would risk paying a stranger.
        console.warn('[payments] account.updated for an unrecorded account', {
          accountId: account.id,
        });
      } else {
        // Flags only — never a name, never the bank details Stripe just took.
        console.log('[payments] payee account updated', {
          accountId: account.id,
          changed: result.changed,
          becamePayable: result.becamePayable,
        });
      }
    } else if (event.type.startsWith('payout.') && event.account) {
      // THE LAST LEG (2026-10-14): Stripe's payout from a spotter's payee
      // account to their BANK — "arrives Tue" on the tracker, and a failure
      // (closed account, wrong details) asks them for new details instead of
      // leaving the money in a balance they cannot see. `event.account` is
      // set because these come from the CONNECTED-accounts endpoint. A record
      // only: no money moves here. record_payout_event ignores accounts we
      // never recorded and late, out-of-order deliveries.
      const payout = event.data.object as Stripe.Payout;
      const { data: recorded, error } = await admin.rpc('record_payout_event', {
        p_stripe_account_id: event.account,
        p_payout_id: payout.id,
        p_status: payout.status,
        p_amount_pence: payout.amount,
        // Stripe's arrival_date is a unix time at midnight UTC of the day.
        p_arrival_date: payout.arrival_date
          ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10)
          : null,
        p_created_at: new Date(payout.created * 1000).toISOString(),
        p_failure_code: payout.failure_code ?? null,
      });
      if (error) throw error;
      // Ids and a status only — never a bank detail or an amount.
      console.log('[payments] payout recorded', {
        accountId: event.account,
        status: payout.status,
        applied: Boolean(recorded?.applied),
      });
      if (recorded?.applied && recorded.failed) {
        failedPayout = { accountId: event.account, payoutId: payout.id };
      }
    }
    // Any other event type: no action, but still recorded below as processed.
  } catch (err) {
    // Processing failed and NOTHING was recorded — 500 so Stripe retries and
    // reprocesses (idempotent). No claim to release; the event is never dropped.
    console.error('[payments] webhook processing failed', (err as Error).message);
    return new Response('Processing failed', { status: 500 });
  }

  // Record the event as processed ONLY now that the state change has committed.
  const { error: recordError } = await admin.rpc('claim_stripe_event', {
    p_event_id: event.id,
  });
  if (recordError) {
    // The state change committed but recording it did not. 500 so Stripe retries;
    // the retry reprocesses (idempotent no-op) and records. Never a silent drop.
    console.error('[payments] recording processed event failed', recordError.message);
    return new Response('Record failed', { status: 500 });
  }

  // --- What follows a capture --------------------------------------------------
  // Spotters alerted, a replaced reward refunded, the owner told it is live —
  // in _shared/afterCapture.ts since 2026-10-14, because sync-post-payment
  // records captures too and must have exactly the same consequences.
  // Deliberately LAST: the money transition and its dedup record have already
  // committed, so nothing there can affect them. NEVER RETHROWS, every step is
  // idempotent (a Stripe retry re-runs it harmlessly), and each runs off the
  // response path — a fan-out slower than Stripe's delivery timeout would make
  // Stripe record a settled payment as a failed delivery.
  if (wentLiveIntentId) {
    await followUpCapture(admin, stripe, wentLiveIntentId);
  }

  // --- A bank refused a spotter's payout (2026-10-14) --------------------------
  // One push per failed payout, claimed against the payout id, so a replayed
  // event or a second payout.* about the same failure sends nothing more. Same
  // posture as the alerts above: after the event is recorded, never rethrown —
  // the record is what matters; Payouts shows the failure either way.
  if (failedPayout) {
    try {
      const { data: claim, error } = await admin.rpc('claim_payout_failed_notification', {
        p_stripe_account_id: failedPayout.accountId,
        p_payout_id: failedPayout.payoutId,
      });
      if (error) {
        console.error('[notifications] payout_failed claim failed', error.message);
      } else if (claim?.claimed) {
        await notifyUsers(admin, [claim.user_id as string], {
          kind: 'payout_failed',
          title: claim.title as string,
          body: claim.body as string,
          data: { type: 'payout_failed' },
          collapseKey: `payout_failed:${failedPayout.payoutId}`,
        });
      }
    } catch (err) {
      console.error('[notifications] payout_failed push failed', (err as Error).message);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

/** The part of a v2 thin event this endpoint reads: what happened, and to what. */
type ThinEventNotification = {
  id: string;
  type: string;
  related_object?: { id: string; type: string } | null;
};

/**
 * A v2 THIN event (2026-10-14) — only an id, a type and the object it is
 * about. Accounts v2 announce "can now be paid" this way
 * (`v2.core.account[configuration.recipient].capability_status_updated`,
 * `v2.core.account[requirements].updated`), and the v1 account.updated above
 * is not to be relied on for them. Without this, a spotter's account became
 * payable and nothing here heard it: the screen said "being checked" and the
 * reward they were owed waited for them to reopen it.
 *
 * Any v2 account event triggers the same thing: read the account from Stripe
 * and apply it (applyPayoutAccountState — record, then release on the
 * false → true edge, collusion gate inside). Reading rather than trusting the
 * event makes order and duplicates harmless. Same dedup discipline as v1:
 * process first, record the id after.
 */
async function handleThinEvent(
  stripe: Stripe,
  notification: ThinEventNotification,
): Promise<Response> {
  // The same mode check as v1 events (audit hardening, 2026-10-26).
  const livemode = (notification as { livemode?: unknown }).livemode;
  if (typeof livemode === 'boolean' && livemode !== LIVE_KEY) {
    console.warn('[payments] thin event from the other mode ignored', { type: notification.type });
    return new Response(JSON.stringify({ received: true, ignored: 'mode' }), { status: 200 });
  }

  const admin = createServiceRoleClient();

  const { data: existing, error: lookupError } = await admin
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', notification.id)
    .maybeSingle();
  if (lookupError) {
    console.error('[payments] dedup lookup failed', lookupError.message);
    return new Response('Dedup failed', { status: 500 });
  }
  if (existing) {
    return new Response(JSON.stringify({ received: true, deduped: true }), { status: 200 });
  }

  const accountId = notification.related_object?.id;
  if (notification.type.startsWith('v2.core.account') && accountId?.startsWith('acct_')) {
    try {
      const result = await syncPayoutAccountFromStripe(admin, stripe, accountId, (profileId) =>
        releaseAllPendingFor(admin, stripe, profileId),
      );
      if (result.outcome === 'unreadable') {
        // A Stripe blip — 500 so the event comes back and is read again.
        console.error('[payments] v2 account event: account unreadable', { accountId });
        return new Response('Account unreadable', { status: 500 });
      }
      if (result.outcome === 'unknown_account') {
        // Not one we recorded (another integration, or a test account whose
        // row was cleared). Never guessed at — that would risk a stranger.
        console.warn('[payments] v2 account event for an unrecorded account', { accountId });
      } else {
        console.log('[payments] v2 account event applied', {
          type: notification.type,
          accountId,
          changed: result.changed,
          becamePayable: result.becamePayable,
        });
      }
    } catch (err) {
      console.error('[payments] v2 account event processing failed', (err as Error).message);
      return new Response('Processing failed', { status: 500 });
    }
  }
  // Any other thin event type: no action, but recorded as processed.

  const { error: recordError } = await admin.rpc('claim_stripe_event', {
    p_event_id: notification.id,
  });
  if (recordError) {
    console.error('[payments] recording processed event failed', recordError.message);
    return new Response('Record failed', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

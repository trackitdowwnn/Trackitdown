/**
 * WHAT:  Stripe webhook receiver — the AUTHORITATIVE source of the payment state
 *        change. Verifies the Stripe signature, dedupes the event, and on
 *        payment_intent.succeeded advances the ledger row and the post
 *        draft -> ACTIVE (live-on-payment); on payment_intent.payment_failed
 *        marks the ledger row failed (post left as draft for retry); on
 *        charge.refunded confirms the bounty refund (payment -> refunded, post ->
 *        cancelled) — the deactivate-post function is authoritative, this
 *        reconciles it.
 *
 *        The succeeded branch serves BOTH pricing modes through ONE function,
 *        mark_post_payment_held, which reads the post: a NULL bounty is a free
 *        listing whose payments row already carries kind='listing_fee'
 *        (20260819100000). Both reach 'held' and both take the post live —
 *        a fee post must reach spotters exactly as an escrowed one does.
 *
 *        ⚠️ A FEE IN 'held' IS SEPARATED FROM ESCROW BY kind ALONE, and only
 *        the Edge Functions apply that filter (refundEscrow, releasePayout,
 *        release-held-refunds). Lose it in any one of them and a £5 fee becomes
 *        refundable money on an hourly cron. charge.refunded stays bounty-only:
 *        a fee is never refunded, so no refund event can exist for one, and
 *        mark_post_payment_refunded's status guard makes a stray one a no-op.
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
 *        supabase/migrations/20260729100000_post_refund_cancel.sql
 *          (mark_post_payment_refunded — the charge.refunded branch);
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
import { releaseAllPendingFor } from '../_shared/releasePayout.ts';

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
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      stripeCryptoProvider,
    );
  } catch (err) {
    // A bad signature is the one case we reject — it isn't really Stripe.
    console.error('[payments] webhook signature verification failed', (err as Error).message);
    return new Response('Invalid signature', { status: 400 });
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
      // Belt-and-braces confirmation of a bounty refund. The deactivate-post
      // Edge Function is authoritative (it issues the refund synchronously and
      // records the transition); this reconciles the SAME state idempotently if
      // that request died after the refund was issued. mark_post_payment_refunded
      // is guarded/never-regress, so a duplicate here is a safe no-op.
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
        const { error } = await admin.rpc('mark_post_payment_refunded', {
          p_payment_intent_id: intentId,
          p_refund_id: refundId,
          p_refunded_amount_pence: charge.amount_refunded,
        });
        if (error) throw error;
        console.log('[payments] refund confirmed', { paymentIntentId: intentId });
      }
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
      const account = event.data.object as Stripe.Account;
      const profileId = account.metadata?.profile_id;
      if (!profileId) {
        // Not one of ours, or made outside the onboarding function. Ignored
        // rather than guessed at — matching on anything else risks writing a
        // payee row against the wrong person, and that is a payment to a
        // stranger.
        console.warn('[payments] account.updated without profile_id', {
          accountId: account.id,
        });
      } else {
        const { error } = await admin.rpc('upsert_connected_account', {
          p_profile_id: profileId,
          p_stripe_account_id: account.id,
          p_onboarding_complete: Boolean(account.details_submitted),
          p_payouts_enabled: Boolean(account.payouts_enabled),
        });
        if (error) throw error;
        // Flags only — never a name, never the bank details Stripe just took.
        console.log('[payments] payee account updated', {
          accountId: account.id,
          payoutsEnabled: Boolean(account.payouts_enabled),
        });

        // AUTO-RELEASE (2026-08-04): the moment a payee becomes payable, send
        // whatever they are already owed — this is what makes "you'll be paid
        // automatically" true instead of a promise about a tap the owner never
        // knew to make. Fired on payable regardless of transition direction:
        // the core is a no-op unless a recovery_claimed post with a credited
        // sighting exists, and the per-post idempotency key makes racing the
        // owner's manual tap safe.
        //
        // MONEY: the collusion gate runs INSIDE the core, on this path too.
        // Never throws — an auto-release failure must not 500 this event and
        // force Stripe to replay it; the flags above are already recorded, and
        // the owner's manual retry remains the recovery path.
        if (account.payouts_enabled) {
          await releaseAllPendingFor(admin, stripe, profileId);
        }
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

  // --- Spotter alerts (features/notifications) --------------------------------
  // A paid post is LIVE-ON-PAYMENT, and this is the moment spotters should hear
  // about it. Deliberately LAST: the money transition and its dedup record have
  // already committed, so nothing below can affect them.
  //
  // NEVER RETHROWS. An alert failure must not turn a settled payment into a
  // Stripe retry — the money is the point, the push is a nudge. And because
  // this handler processes-first-records-after, a retry re-runs everything:
  // notify-spotters claims posts.alerts_sent_at itself, so a re-run finds the
  // post already claimed and sends nothing. That claim is what let us wire this
  // up WITHOUT modifying mark_post_payment_held.
  if (wentLiveIntentId) {
    try {
      const { data: payment } = await admin
        .from('payments')
        .select('post_id')
        .eq('stripe_payment_intent_id', wentLiveIntentId)
        .maybeSingle();
      if (payment?.post_id) {
        // NOT awaited. notify-spotters awaits the whole chunked Expo fan-out
        // (100 tokens per request), so awaiting it here would put unbounded
        // latency on the money path for a nudge — and a fan-out slower than
        // Stripe's delivery timeout makes Stripe record a SETTLED payment as
        // a failed delivery and retry it. The retry is safe (dedupe above +
        // the alerts_sent_at claim), but repeated timeouts degrade endpoint
        // health. Fire-and-forget matches what this function's own comment
        // and supabase/functions/README.md already claim it does.
        const dispatch = admin.functions
          .invoke('notify-spotters', { body: { postId: payment.post_id } })
          .then(({ error }) => {
            if (error) console.error('[notifications] alert dispatch failed', error.message);
          })
          .catch((err) =>
            console.error('[notifications] alert dispatch failed', (err as Error).message),
          );

        // A bare un-awaited promise can be killed when the isolate returns its
        // response — possibly before the request is even sent. waitUntil is
        // Supabase's documented way to keep it alive past the response. Where
        // it isn't available we fall back to awaiting: slower, but a lost
        // alert is worse than a slow webhook, and the claim makes a Stripe
        // retry harmless either way.
        const runtime = (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } })
          .EdgeRuntime;
        if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(dispatch);
        else await dispatch;
      }
    } catch (err) {
      console.error('[notifications] alert dispatch failed', (err as Error).message);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

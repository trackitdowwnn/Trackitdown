/**
 * WHAT:  Stripe webhook receiver — the AUTHORITATIVE source of the escrow state
 *        change. Verifies the Stripe signature, dedupes the event, and on
 *        payment_intent.succeeded flips the ledger row to 'held' and the post
 *        draft -> ACTIVE (live-on-payment); on payment_intent.payment_failed
 *        marks the ledger row failed (post left as draft for retry); on
 *        charge.refunded confirms the bounty refund (payment -> refunded, post ->
 *        cancelled) — the deactivate-post function is authoritative, this
 *        reconciles it.
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
 *        supabase/migrations/20260729100000_post_refund_cancel.sql
 *          (mark_post_payment_refunded — the charge.refunded branch);
 *        docs/decisions/ADR-0002-stripe-connect.md (webhooks: verify + dedupe +
 *          idempotent); supabase/functions/README.md (registering the endpoint).
 */

import type Stripe from 'npm:stripe@17.5.0';

import {
  createServiceRoleClient,
  createStripeClient,
  requireEnv,
  stripeCryptoProvider,
} from '../_shared/clients.ts';

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
      const { error } = await admin.rpc('mark_post_payment_held', {
        p_payment_intent_id: intent.id,
      });
      if (error) throw error;
      console.log('[payments] escrow held', { paymentIntentId: intent.id });
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

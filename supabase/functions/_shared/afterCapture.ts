/**
 * WHAT:  followUpCapture — everything that follows a recorded capture, after
 *        the money state is committed: spotters alerted, a replaced reward
 *        refunded, and (2026-10-14) the owner told their listing is live.
 * WHY:   Two paths now record a capture: the payment_intent.succeeded webhook,
 *        and sync-post-payment — the app asking the server to check with
 *        Stripe when the webhook is slow (PR6 of the payments plan). A capture
 *        recorded by either must have exactly the same consequences, so they
 *        live here once, moved verbatim from the webhook.
 *
 *        EVERY STEP IS IDEMPOTENT, which is what makes two callers safe:
 *        notify-spotters claims posts.alerts_sent_at; refundSupersededForPost
 *        refunds under a per-payment key; claim_listing_live_notification
 *        claims posts.live_notified_at, and only for a post's first capture.
 *        NEVER THROWS: the money is already recorded; these are its
 *        consequences, and the hourly sweep retries the refund.
 *
 *        OFF THE RESPONSE PATH: each runs under EdgeRuntime.waitUntil where
 *        available — a fan-out slower than Stripe's delivery timeout would make
 *        Stripe redeliver a settled event — and is awaited where it is not.
 * LINKS: ../stripe-webhook/index.ts; ../sync-post-payment/index.ts;
 *        ./refundEscrow.ts; ./push.ts;
 *        migrations 20261014120000 (claim_listing_live_notification).
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

import { notifyUsers } from './push.ts';
import { refundSupersededForPost } from './refundEscrow.ts';

/** Keep `work` alive past the response where the runtime allows; else await it. */
async function offThePath(work: Promise<unknown>): Promise<void> {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(work);
  else await work;
}

export async function followUpCapture(
  admin: SupabaseClient,
  stripe: Stripe,
  intentId: string,
): Promise<void> {
  let postId: string | null = null;
  try {
    const { data: payment } = await admin
      .from('payments')
      .select('post_id')
      .eq('stripe_payment_intent_id', intentId)
      .maybeSingle();
    postId = (payment?.post_id as string | undefined) ?? null;
  } catch (err) {
    console.error('[payments] capture follow-up lookup failed', (err as Error).message);
    return;
  }
  if (!postId) return;
  const post = postId;

  // --- Spotter alerts --------------------------------------------------------
  // A paid post is LIVE-ON-PAYMENT, and this is the moment spotters hear about
  // it. NOT awaited inline: notify-spotters awaits the whole chunked Expo
  // fan-out, and that latency must never sit on the money path.
  await offThePath(
    admin.functions
      .invoke('notify-spotters', { body: { postId: post } })
      .then(({ error }) => {
        if (error) console.error('[notifications] alert dispatch failed', error.message);
      })
      .catch((err) => console.error('[notifications] alert dispatch failed', (err as Error).message)),
  );

  // --- The replaced reward goes home (2026-10-05) ----------------------------
  // A capture that changed a live listing's reward left the old payment
  // `superseded`: owed back to the owner. Refunded now rather than at the next
  // hourly sweep, which remains the retry under the same per-payment key.
  await offThePath(
    (async () => {
      try {
        const refunded = await refundSupersededForPost(admin, stripe, post);
        if (refunded > 0) {
          console.log('[payments] replaced reward refunded', { postId: post, refunded });
        }
      } catch (err) {
        console.error('[payments] replaced reward refund failed', (err as Error).message);
      }
    })(),
  );

  // --- The owner hears it went live (2026-10-14) -----------------------------
  // Only for the post's FIRST capture, once (the claim decides both) — a
  // renewal is not a go-live.
  await offThePath(
    (async () => {
      try {
        const { data: claim, error } = await admin.rpc('claim_listing_live_notification', {
          p_payment_intent_id: intentId,
        });
        if (error) {
          console.error('[notifications] listing_live claim failed', error.message);
          return;
        }
        if (!claim?.claimed) return;
        await notifyUsers(admin, [claim.user_id as string], {
          kind: 'listing_live',
          title: claim.title as string,
          body: claim.body as string,
          data: { type: 'listing_live', postId: claim.post_id as string },
          collapseKey: `listing_live:${claim.post_id as string}`,
        });
      } catch (err) {
        console.error('[notifications] listing_live push failed', (err as Error).message);
      }
    })(),
  );
}

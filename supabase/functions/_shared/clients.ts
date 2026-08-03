/**
 * WHAT:  Constructors for the two backend clients the payment Edge Functions
 *        use — the Stripe SDK (wired to Deno's fetch + SubtleCrypto so it runs
 *        on the Edge runtime) and a Supabase SERVICE-ROLE client that bypasses
 *        RLS to call the money-state SECURITY DEFINER functions.
 * WHY:   Both clients read secrets from the Edge Function environment
 *        (`supabase secrets set` / the platform-injected SUPABASE_* vars), never
 *        from anything bundled into the app. Centralising construction keeps the
 *        secret names in one audited place and guarantees the Stripe client is
 *        always built with the Deno-compatible crypto provider used for webhook
 *        signature verification.
 * LINKS: supabase/functions/create-payment-intent/index.ts;
 *        supabase/functions/stripe-webhook/index.ts;
 *        supabase/functions/README.md (which secrets to set);
 *        docs/SECURITY_AND_TRUST.md §4 (service-role key is server-only).
 */

// Fully-qualified npm: specifiers (not bare imports) so the Supabase deploy
// bundler resolves them without relying on an import map.
import Stripe from 'npm:stripe@22.4.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/** Read a required secret or throw — a missing money secret must fail loudly
 *  at request time, never silently no-op. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required secret: ${name}`);
  }
  return value;
}

/**
 * The Stripe SDK configured for the Deno Edge runtime: the fetch HTTP client
 * (Deno has no Node http) and a pinned API version so behaviour can't shift
 * under us. Reads STRIPE_SECRET_KEY (sk_test_… / sk_live_…) from Edge secrets.
 *
 * UPGRADED 17.5.0 → 22.4.0 on 2026-08-03 (ADR-0010 needs the V2.Core
 * namespace, present from stripe-node 20.2; 22.x is the maintained line — the
 * v21 line died after two patches, and both pin the same API version). The
 * escrow call surface was checked per-site against every changelog in between:
 * nothing we call changed shape. The one behavioural change in range —
 * partial-capture/cancel no longer auto-creating a Refund — does not touch us:
 * our only cancellation is a stale DRAFT intent with no charge to refund.
 *
 * The fetch client + SubtleCrypto pair below is technically the default on the
 * SDK's deno build, but stays EXPLICIT: if module resolution ever falls
 * through to the Node build, these options are what keeps signature
 * verification working.
 */
export function createStripeClient(): Stripe {
  return new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    // The version this SDK's types describe. Passing an older pin "works" but
    // makes every response type a lie; move the WEBHOOK ENDPOINT's version in
    // the Stripe dashboard deliberately and separately — that one governs
    // event payload shapes, not this.
    apiVersion: '2026-03-25.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** The Web Crypto provider Stripe uses to verify webhook signatures on Deno
 *  (Node's synchronous crypto isn't available — constructEventAsync needs this). */
export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();

/**
 * A Supabase client authenticated with the SERVICE-ROLE key. It bypasses RLS,
 * so it is the ONLY thing permitted to call the money-state functions
 * (record_post_payment_intent / mark_post_payment_held / …) and read the
 * payments ledger. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected into
 * every Edge Function by the platform. Never expose this client to a request
 * body's data — it has full database access.
 */
export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

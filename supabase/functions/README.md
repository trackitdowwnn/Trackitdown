# Edge Functions — Stripe bounty escrow

These are the first Supabase Edge Functions in the repo. They power the
**bounty escrow charge** for the post-a-car wizard:

| Function | Called by | Job |
| --- | --- | --- |
| `create-payment-intent` | the app (`supabase.functions.invoke`) | verify the caller owns the draft post, read the bounty **from the DB**, create a Stripe PaymentIntent (captured immediately = escrow), record the ledger row, return the client secret |
| `deactivate-post` | the app (`supabase.functions.invoke`) | verify the caller owns a **paid** post (`active`/`pending_verification`), find the held escrow, refund the bounty **minus the non-recoverable card fee** (fee read from Stripe), and flip the post `→ cancelled` (payment `held → refunded`) |
| `stripe-webhook` | **Stripe**, server-to-server | verify the signature, dedupe the event, and on `payment_intent.succeeded` flip the post `draft → pending_verification`, on `charge.refunded` confirm the refund (`→ cancelled`) — the authoritative / reconciling state change |

Shared code lives in `_shared/` (`clients.ts`, `http.ts`); the money-state SQL
functions they call are in `supabase/migrations/20260726100000_post_payment.sql`
(charge) and `supabase/migrations/20260729100000_post_refund_cancel.sql` (refund).

> **Security model.** The publishable key (`pk_...`) is public and bundled in the
> app — it can only open the PaymentSheet. The **secret key** (`sk_...`) and the
> **webhook signing secret** (`whsec_...`) are Edge Function secrets — they live
> ONLY in Supabase, never in the repo, `.env`, or app code. The charge amount is
> read server-side from `posts.bounty_amount_pence`; the client never sends it.

---

## One-time setup (you run these — Claude can't set secrets or deploy)

### 1. Create a Stripe **test-mode** account
- Sign up / sign in at <https://dashboard.stripe.com> and stay in **Test mode**.
- Copy the two API keys from **Developers → API keys**:
  - Publishable key `pk_test_...`
  - Secret key `sk_test_...`

### 2. Put the publishable key in the app
In your local `.env` (never committed):
```
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 3. Set the Edge Function secrets
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically; you
set the two Stripe secrets:
```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET is set in step 5, after you know the endpoint's whsec_.
```

### 4. Deploy the functions
```bash
npx supabase functions deploy create-payment-intent
npx supabase functions deploy deactivate-post
npx supabase functions deploy stripe-webhook --no-verify-jwt
```
`stripe-webhook` uses `--no-verify-jwt` because **Stripe** calls it (not a
signed-in user); it authenticates via the Stripe signature instead, which the
function verifies itself. `create-payment-intent` and `deactivate-post` keep JWT
verification on (they act on behalf of the signed-in owner).

### 5. Register the webhook endpoint
In **Developers → Webhooks → Add endpoint**:
- URL: `https://<your-project-ref>.functions.supabase.co/stripe-webhook`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, and
  `charge.refunded` (the refund confirmation)
- Copy the endpoint's **Signing secret** (`whsec_...`) and set it:
```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```
(Re-deploy `stripe-webhook` after setting it if it was already deployed.)

### 6. Rebuild the app (native module)
`@stripe/stripe-react-native` is a native module with an Expo config plugin
(`app.config.ts`), so it needs a **new dev build** — it is not hot-reloadable:
```bash
npx expo run:android   # or run:ios
```

---

## Local testing with the Stripe CLI

Forward live test events to a locally-served function so you can watch the whole
loop without deploying:
```bash
# Terminal 1 — serve functions locally against your linked project's secrets
npx supabase functions serve

# Terminal 2 — forward Stripe test webhooks to the local stripe-webhook
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
```
`stripe listen` prints a `whsec_...` for the CLI session — set that as
`STRIPE_WEBHOOK_SECRET` for the local `functions serve` process.

Then in the app (dev build): post a car and pay with a Stripe **test card**:
- `4242 4242 4242 4242` — succeeds → the webhook flips the post to
  `pending_verification`.
- `4000 0000 0000 0002` — declined → the draft and the wizard stay intact; the
  owner can retry with no duplicate draft.

To test a **refund**: on a paid post, deactivate it from the post detail — the
`deactivate-post` function refunds the bounty minus the card fee and flips the
post to `cancelled`; the refund shows in the Stripe dashboard.

Verify the DB side with `npm run test:db` (runs
`supabase/tests/post_payment_verification.sql` and
`supabase/tests/refund_cancel_verification.sql` against a local reset).

---

## Notes
- All amounts are integer pence; GBP is fixed (UK-only per the roadmap).
- Escrow model per `docs/decisions/ADR-0002-stripe-connect.md`: **separate
  charges and transfers**, capture immediately to the platform balance. There is
  **no** destination charge / `application_fee` here — the 95/5 payout is a
  separate, later `release-payout` function.
- The webhook is idempotent and deduped (`stripe_webhook_events`), so Stripe's
  retries and out-of-order deliveries are safe.

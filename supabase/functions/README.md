# Edge Functions — bounty escrow + push notifications

## Money

| Function | Called by | Job |
| --- | --- | --- |
| `create-payment-intent` | the app (`supabase.functions.invoke`) | verify the caller owns the draft post, read the bounty **from the DB**, create a Stripe PaymentIntent (captured immediately = escrow), record the ledger row, return the client secret |
| `deactivate-post` | the app (`supabase.functions.invoke`) | verify the caller owns a **paid** post (`active`/`pending_verification`), find the held escrow, refund the bounty **minus the non-recoverable card fee** (fee read from Stripe), and flip the post `→ cancelled` (payment `held → refunded`) |
| `refund-recovery` | the app, after `claim_recovery` returns `refund` | the no-spotter ending: refund the bounty and close the post `→ recovered_no_spotter` |
| `release-payout` | the app, after `claim_recovery` returns `payout` | the credited ending: transfer 95% to the spotter (ADR-0002 transfer math; one transfer per post, forever) and close the post `→ recovered`. Answers `awaiting_payee` — **not an error** — until they have onboarded |
| `connect-onboarding` | the app, from the payouts surface | create the spotter's Express account if they have none, and return a fresh hosted link — onboarding, or `account_update` if they are already payable. Records the account as **not payable**; only the webhook may say otherwise |
| `connect-return` | **Stripe's browser**, after hosted onboarding | an HTTPS page that forwards to `trackitdown://payouts?onboarding=…`. Exists because Account Links accept **http/https only** — a custom scheme is rejected with "Not a valid URL". Deployed `--no-verify-jwt`: Stripe's browser has no session |
| `stripe-webhook` | **Stripe**, server-to-server | verify the signature, dedupe the event, and on `payment_intent.succeeded` flip the post `draft → active` (LIVE-ON-PAYMENT, 2026-07-30) then fire-and-forget the spotter alerts; on `charge.refunded` confirm the refund (`→ cancelled`); on **`account.updated`** copy Stripe's `payouts_enabled` onto the payee row — the ONLY thing that ever makes a spotter payable |

⚠️ **`account.updated` must be enabled on the Stripe webhook endpoint.** It is
not one of the defaults you get for a payments-only integration. Without it a
spotter can finish onboarding and never become payable, `release-payout` answers
`awaiting_payee` forever, and the owner is told the spotter still needs to add
bank details they have already given. Nothing errors; the money simply never
moves.

## Notifications

| Function | Called by | Job |
| --- | --- | --- |
| `notify-spotters` | `stripe-webhook`, **service-role only** | claim the post (`posts.alerts_sent_at`), match enabled `alert_zones` with `ST_DWithin`, apply the 3-per-rolling-24h cap, fan out one push |
| `notify-sighting` | the app, after `create_sighting` | tell the post's owner. `claim_sighting_notification` verifies the caller really is that sighting's spotter |
| `notify-message` | the app, after `send_message` | tell the other participant. Sender first name + post context only — **content never transits push** |
| `process-push-receipts` | `notify-spotters`, fire-and-forget | drain Expo receipts ≥15 min old and prune `DeviceNotRegistered` tokens |

`notify-spotters` and `process-push-receipts` compare the bearer against
`SUPABASE_SERVICE_ROLE_KEY` rather than resolving it to a user: an
authenticated caller must never be able to trigger a fan-out to every spotter
in a 50-mile radius, or delete device tokens.

**The push copy is built in SQL**, not here — that puts its privacy properties
(no plate, no coordinates, no message content, always the don't-approach
clause) under `npm run test:db`, instead of needing a second, Deno test stack.

Shared code lives in `_shared/` (`clients.ts`, `http.ts`, `push.ts` — the ONE
send utility every notification type uses). The money-state SQL functions are
in `supabase/migrations/20260726100000_post_payment.sql` (charge) and
`20260729100000_post_refund_cancel.sql` (refund); the notification ones in
`20260802100000_push_infrastructure.sql`, `20260802130000_alert_matching.sql`
and `20260802140000_notification_claims.sql`.

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

## Notification setup (you run these — Claude can't set secrets or deploy)

### Expo access token
Enable **Enhanced Security for Push Notifications** on expo.dev, then:
```bash
npx supabase secrets set EXPO_ACCESS_TOKEN=...
```
Optional until you enable it — `_shared/push.ts` sends the header only when the
secret exists, so setting it early is harmless and forgetting it after enabling
security fails every send with `UNAUTHORIZED`.

### Deploy
```bash
npx supabase functions deploy notify-spotters
npx supabase functions deploy notify-sighting
npx supabase functions deploy notify-message
npx supabase functions deploy process-push-receipts
npx supabase functions deploy connect-onboarding
npx supabase functions deploy connect-return --no-verify-jwt   # Stripe's browser has no session
npx supabase functions deploy stripe-webhook --no-verify-jwt   # re-deploy: alerts + account.updated
```

**Then, in the Stripe dashboard**, add `account.updated` to the webhook
endpoint's event list. `connect-onboarding` and the payout are inert without it
(see the warning under Money above).
All four keep JWT verification on. `notify-sighting` / `notify-message` are
called by the signed-in app; `notify-spotters` / `process-push-receipts` are
service-to-service and check the bearer themselves.

### Android/iOS credentials
Push cannot be delivered at all until FCM (Android) / APNs (iOS) credentials
are uploaded — see `src/features/notifications/README.md`. Until then
`getExpoPushTokenAsync` rejects, the client logs one warning, and everything
else works normally.

---

## Notes
- All amounts are integer pence; GBP is fixed (UK-only per the roadmap).
- Escrow model per `docs/decisions/ADR-0002-stripe-connect.md`: **separate
  charges and transfers**, capture immediately to the platform balance. There is
  **no** destination charge / `application_fee` here — the 95/5 payout is a
  separate, later `release-payout` function.
- The webhook is idempotent and deduped (`stripe_webhook_events`), so Stripe's
  retries and out-of-order deliveries are safe.

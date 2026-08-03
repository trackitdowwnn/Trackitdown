# payments — the money, both ends of it

WHAT: the owner's side (charge a bounty into escrow, refund it) and the
spotter's side (a Stripe Connect account for the bounty to land in). No screens
existed here until 2026-08-03; it was a Stripe SDK wrapper and two error maps.

Primary actors: **owner** (pays), **spotter** (is paid). The client never
computes an amount, never decides who is payable, and never holds a secret.

**Screens** — `PayoutsScreen` (route `src/app/payouts.tsx`).
**Hooks** — `useBountyPayment` (presents the PaymentSheet), `useDeactivatePost`
(refund + take down), `usePayoutAccount` (the payee state machine).
**Api** — `paymentsApi.ts` (escrow), `payoutsApi.ts` (Connect),
`functionError.ts` (the one error class + the `{ error, code }` parser both use).
**Provider** — `BountyPaymentProvider`, mounted by the two posting routes.

## The two halves

**Escrow (owner).** `create-payment-intent` → PaymentSheet → `stripe-webhook`
flips `draft → active` on `payment_intent.succeeded`. The client sends a post id
and nothing else; the server reads the bounty from the database. Refunds go
through `deactivate-post` (owner cancels) or `refund-recovery` (found it
themselves), both minus the non-recoverable card fee.

**Payout (spotter).** `connect-onboarding` creates an Express account and hands
back a hosted link; Stripe's `account.updated` webhook writes
`payouts_enabled`; `release-payout` transfers 95% on a credited recovery and the
5% remainder simply stays (ADR-0002 — transfer math, never an
`application_fee_amount`).

**Why KYC is asked for late.** A spotter has no Stripe account until they want
one. DOMAIN says to ask at the first credited sighting, not at signup — bank
details and a date of birth are a lot to demand from someone who has just
downloaded a car-spotting app. So `release-payout` answering `awaiting_payee`
is the NORMAL first outcome, not a failure, and the bounty waits in escrow.

## Things that will bite you

- **`payouts_enabled` has exactly one writer**: the `account.updated` branch of
  `stripe-webhook`. Not the onboarding function, which deliberately records a
  new account as *not* payable — returning from Stripe's flow does not mean
  verification passed, and a spotter who merely *looks* payable makes
  `release-payout` fail at the transfer instead of waiting politely.
  ⚠️ `account.updated` must be enabled on the Stripe webhook endpoint by hand;
  it is not a default for a payments-only integration, and without it the whole
  payout path fails silently.
- **`openAuthSessionAsync` is not the same on both platforms.** On iOS the auth
  session claims the `trackitdown:` scheme, so the redirect never reaches the
  router and the app does not navigate. On Android the deep link fires *and*
  the promise resolves — and because the polyfill races AppState against a
  Linking listener, a successful return often arrives as `{ type: 'dismiss' }`.
  If the OS killed the app behind the browser, only the route sees anything.
  So: never branch on the result type, treat the return as a hint, and settle
  through one idempotent path that re-reads the account. See `PayoutsScreen`.
- **The redirect passed to the browser is the bare prefix**
  `trackitdown://payouts` — Android matches with `startsWith`, so including the
  query string silently fails to match the expiry redirect and hangs the
  session. And never `Linking.createURL`: in a dev client it yields
  `exp+trackitdown://`, which cannot match the server's hardcoded literal.
  **This flow cannot complete in Expo Go.**
- **"Just finished" and "gave up half way" look identical** for a few seconds,
  because the webhook writes `details_submitted` and `payouts_enabled` in one
  upsert. `usePayoutAccount`'s settling window exists solely so the screen does
  not tell someone who has just done everything to pick up where they left off.
  It is bounded (2s/4s/8s, armed only by a return) and there is a test asserting
  it terminates — keep that test.
- **Never log a hosted link.** An Account Link is a bearer URL into someone's
  identity documents. Log the account id and the outcome, nothing else.

## Not here

Bounty splitting (single winner, v1), top-ups, and any client-side amount
arithmetic. `release-payout` has no client caller of its own — the recovery
flow in `features/vehicles` calls it, because that is where the owner decides.

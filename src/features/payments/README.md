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
- **THE PREFILL WINDOW — the most important thing on this page.** Stripe lets a
  platform submit bank details and identity fields for an Express account
  itself: *"you can update all information **until you create an Account Link or
  Account Session**, after which some properties can no longer be updated."*
  That window is why `PayoutDetailsForm` can exist at all, and it **shuts
  permanently and silently** on the first session. So `connect-onboarding`
  answers `details_required` and refuses to mint one until our form has run.
  Anything that mints a session earlier — a stray call, a "warm it up" ping —
  destroys the feature for that account forever, with no error.
  - Bank details go as a **raw dictionary**, never a token. A `btok_` from
    `createToken({type:'BankAccount'})` may only be attached where
    `controller.requirement_collection` is `application`; Express is not.
  - **We never store them.** They transit `submit-payout-details` to Stripe and
    are gone. Not a column, not a log, not a masked tail — there is a test in
    `payoutsApi.test.ts` asserting they never reach a log call.
- **Setup is in-app; changing details is not.** `ConnectAccountOnboarding`
  (Stripe's own RN component, GA in SDK 0.69.0) handles what our form could not
  via an **Account Session**. Stripe has no React Native component for managing
  an account that already works, so "Update bank details" still opens a browser —
  as does the hosted-link fallback if a session cannot be minted.
- ⛔ **The floor, so it is not re-litigated.** Stripe's verification screen and
  its sign-in popup cannot be removed on Express:
  `external_account_collection: false` and
  `disable_stripe_user_authentication: true` are *only* legal where the platform
  is the KYC-responsible party. Becoming that party means re-onboarding every
  existing spotter into new accounts (dashboard type is immutable), holding
  passport scans under UK GDPR, a six-monthly regulatory re-review forever, a
  lawyer-reviewed ToS change, and a UK duty to notify rejected accounts "without
  delay". And **risk-review responses can never be made through the API under
  any configuration** — nobody reaches 100% native. Our form gets the 80% that
  is free; the rest is a compliance function, not a design task.
- ⛔ **Never put Stripe's hosted onboarding in a WebView.** It looks like the
  obvious way to make the update path in-app too, and Stripe forbids it in as
  many words: *"Stripe-hosted onboarding is only supported in web browsers. You
  can't use it in embedded web views inside mobile or desktop applications."*
  The embedded component is the supported route; a WebView around the hosted
  flow is a ToS violation.
- **`openAuthSessionAsync` is not the same on both platforms** — still true for
  the two browser paths above. On iOS the auth session claims the
  `trackitdown:` scheme, so the redirect never reaches the router and the app
  does not navigate. On Android the deep link fires *and* the promise resolves —
  and because the polyfill races AppState against a Linking listener, a
  successful return often arrives as `{ type: 'dismiss' }`. If the OS killed the
  app behind the browser, only the route sees anything. So: never branch on the
  result type, treat the return as a hint, and settle through one idempotent
  path that re-reads the account. See `PayoutsScreen`.
- **`onExit` proves nothing either.** The embedded component closing is exactly
  as weak a signal as the browser redirect was — someone can back out half way.
  It calls `settleReturn()` for the same reason and through the same path.
- **The redirect passed to the browser is the bare prefix**
  `trackitdown://payouts` — Android matches with `startsWith`, so including the
  query string silently fails to match the expiry redirect and hangs the
  session. And never `Linking.createURL`: in a dev client it yields
  `exp+trackitdown://`, which cannot match. **This flow cannot complete in
  Expo Go.**
- **Stripe never redirects to the app directly.** Account Links accept
  **http/https only** — a custom scheme is rejected outright with "Not a valid
  URL", which cost an afternoon on 2026-08-03 because the account was created
  successfully and only the *link* failed, so it read as a Stripe setup problem.
  `return_url`/`refresh_url` therefore point at the `connect-return` Edge
  Function, an HTTPS page that immediately forwards to the app scheme. Universal
  links would remove the hop but need a verified domain, and ours is still a
  placeholder.
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

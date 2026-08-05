# ADR-0002 — Stripe Connect: account config & charge pattern

**Status:** accepted; onboarding half superseded · **Date:** 2026-07-07 ·
Refines ADR-0001

> **Onboarding decisions superseded by
> [ADR-0010](./ADR-0010-whitelabel-payouts.md)** (2026-08-03): new payee
> accounts move to Accounts v2 `recipient` configuration with no Stripe
> dashboard and platform-owned collection in our own UI. The charge-pattern
> half of this ADR — separate charges and transfers, immediate capture, 5% by
> transfer math — **stands unchanged** and ADR-0010 builds on it.

## Context

Bounties are **held in escrow for days–weeks** (until the car is
recovered), the **winning spotter is unknown at charge time** (and has no
Stripe account yet), exactly **one** spotter is paid per recovery, and the
bounty is **refunded** if no spotter is credited. We must pick a Connect
account configuration and charge pattern that fits hold-and-release with a
late-bound recipient. This refines ADR-0001's "5% application fee" note.

## Decision

- **Accounts v2 connected accounts** (not the legacy `type: "express"`).
  Configure spotters with explicit fields:
  - Dashboard: **Express** (`dashboard: "express"`) — lightweight payout view.
  - Fee collection: **platform** (`fees_collector: "application"`).
  - Negative-balance liability: **platform** (`losses_collector: "application"`)
    — required with Express, and lets Stripe reverse a spotter's transfer if
    a bounty is disputed later.

  > **As built (2026-08-03).** `connect-onboarding` expresses these three
  > choices through the **v1 controller properties**
  > (`controller.stripe_dashboard.type: 'express'`,
  > `controller.fees.payer: 'application'`,
  > `controller.losses.payments: 'application'`) rather than the v2 field names
  > above. The v2 Accounts API needs a newer pinned `apiVersion` and stripe SDK
  > than `_shared/clients.ts` carries (17.5.0 / 2024-06-20), and bumping the SDK
  > underneath the whole escrow path in order to create one account was not a
  > trade worth making. The semantics are identical; only the spelling differs.
  > Revisit alongside any SDK upgrade — and note Stripe rejects a request that
  > sends both `type` and `controller`.
- **Charge pattern: separate charges and transfers** — NOT destination
  charges. Destination charges transfer immediately and cannot hold; here we
  must hold funds and the recipient may not exist at charge time.
- **Escrow hold:** capture the owner's PaymentIntent **immediately** to the
  platform balance. Do **not** use a manual-capture authorization hold — those
  expire in ~7 days, far shorter than a recovery window. Funds sit in the
  platform balance until transferred or refunded.
- **5% fee via transfer math**, NOT `application_fee_amount` (that field is
  only for destination/direct charges). On recovery, transfer
  `round(bounty_pence × 0.95)` to the spotter; the 5% remainder stays.
- **Onboarding:** ~~Stripe-hosted onboarding via **Account Links** (the RN app
  opens the hosted flow; Connect embedded components are web-only)~~. Prompt at
  the first credited sighting, and create the spotter's connected account
  lazily at that point.

  > **Corrected 2026-08-03 — "embedded components are web-only" is no longer
  > true, and that one parenthetical is what produced a browser-bouncing
  > onboarding flow.** `@stripe/stripe-react-native` ships a first-party
  > `ConnectAccountOnboarding` (private preview 0.59.0, **GA 0.69.0**); Stripe
  > documents React Native alongside Web/iOS/Android. Setup now runs **inside
  > the app** via an **Account Session** (`accountSessions.create`, available on
  > the pinned 17.5.0 / 2024-06-20 — no server SDK bump). Required the RN SDK
  > above Expo SDK 57's pin, plus `react-native-webview` as an optional peer.
  >
  > Two boundaries found while doing it, both worth not rediscovering:
  > - **Never put hosted onboarding in your own WebView.** Stripe forbids it:
  >   *"Stripe-hosted onboarding is only supported in web browsers. You can't
  >   use it in embedded web views inside mobile or desktop applications."*
  > - **Account Links still matter.** They remain the only route for CHANGING a
  >   payable account's details (Stripe's Account Management component is not
  >   supported on React Native), and the server falls back to them if minting a
  >   session fails. `connect-return` exists for them, and stays.
  >
  > Unchanged: Express means `requirement_collection: 'stripe'`, so a
  > Stripe-branded sign-in step is unavoidable — it just happens in-app now.

  > **Extended 2026-08-03 — collect what we can ourselves.** Stripe permits the
  > platform to submit bank details and identity fields for an Express account
  > **until the first Account Link or Account Session exists**, and never again
  > after. `submit-payout-details` uses that window from a native form; the
  > session mint is gated behind `stripe_connected_accounts.details_submitted_at`
  > so nothing can close it before the form is shown. Bank details go as a **raw
  > dictionary** — a `btok_` bank-account token may only be attached where
  > `requirement_collection` is `application` — and are never stored or logged.
  >
  > **The floor, checked and recorded so it is not re-litigated:**
  > `external_account_collection: false` and
  > `disable_stripe_user_authentication: true` are only legal for the
  > KYC-responsible party, so Stripe's verification screen and sign-in popup
  > stay. Risk-review responses **cannot be made through the API under any
  > account configuration**, so no integration is ever fully native. Taking the
  > responsible-party route would mean re-onboarding every existing spotter into
  > new accounts (dashboard type is immutable), holding passport scans under UK
  > GDPR, a six-monthly regulatory re-review, a lawyer-reviewed ToS change, and
  > a UK "without delay" rejection-notification duty. **Rejected: that is a
  > compliance function, not a feature.**

## Consequences

- **Supersedes the "Connect application fee" wording** in ADR-0001 and
  `DOMAIN.md` — the mechanism is transfer math under separate charges and
  transfers. `DOMAIN.md` §"Bounty rules" should be reworded to match.
- The platform pays Stripe processing fees on the full bounty; a refund does
  **not** return those fees, so the platform absorbs them on no-spotter
  recoveries — disclose these non-recoverable costs at posting (already
  required by `DOMAIN.md`). 5% margin is thin; verify £50 min nets positive on
  international cards.
- `release-payout` Edge Function validates state transitions and does the
  transfer math server-side; all amounts integer pence (`// MONEY:` tested).
- Webhooks must cover transfer/reversal events and `account.updated`
  (capability + payouts readiness), verify signatures, dedupe by event id,
  and be idempotent.
- Revisit if v2 introduces multi-spotter splitting — separate transfers
  already supports paying several connected accounts from one charge.

# ADR-0002 — Stripe Connect: account config & charge pattern

**Status:** accepted · **Date:** 2026-07-07 · Refines ADR-0001

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
- **Onboarding:** Stripe-hosted onboarding via **Account Links** (the RN app
  opens the hosted flow; Connect embedded components are web-only). Prompt at
  the first credited sighting, and create the spotter's connected account
  lazily at that point.

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

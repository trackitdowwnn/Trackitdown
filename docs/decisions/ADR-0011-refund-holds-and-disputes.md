# ADR-0011 — Refund holds, exit attestation, and spotter disputes

**Status:** accepted · **Date:** 2026-08-05 · Implements DOMAIN.md's Disputes
section, which had been written as intent with nothing behind it

## Context

The question that triggered this ("what stops an owner waiting out 30 days and
taking the refund while the spotter goes unpaid?") turned out to have a worse
answer than the asker feared. There is no 30-day anything — no scheduler
existed in the system at all — but there were two one-tap exits that refunded
the bounty (minus only the card fee) with **zero sighting checks**:
`deactivate-post` never queried sightings, and "I found it another way"'s only
guard was circular (it refused refunds on a *credited* sighting, which only
the owner can create). The spotter was never notified, had no history surface,
and no recourse. Meanwhile a complete evidence trail — immutable photos with
capture-time GPS, timestamps, retained read-only chat — persisted with nothing
consuming it.

Decisions taken with the owner (2026-08-04): attestation AND a refund hold;
trigger = uncredited sightings from the last 14 days; 72-hour dispute window;
release via a Supabase Cron sweep; resolution by hand in v1.

## Decision

1. **One trigger definition.** `recent_uncredited_sightings(post_id)` in SQL:
   status unverified/helpful, created within 14 days. The client pre-flight
   (`exit_check`), both exit Edge Functions, and the hold creator all call it.
   Two definitions of "recent" would disagree about whose refund waits.
2. **The hold is a side table (`refund_holds`), not payment columns.**
   `payments` mirrors Stripe fact-states, and during a hold the money
   genuinely IS still `held`. "Released" is deliberately NOT stored — it is
   derived from `payments.status`, giving one source of truth and a sweep
   that is idempotent by construction. No post-status enum churn either: a
   held deactivate sits on `cancelled` (delisted immediately — the listing
   coming down is the owner's unconditionally; only the money waits), a held
   recovery on `recovery_claimed` (which means exactly "claim recorded, money
   not moved").
3. **Attestation is recorded evidence**: who confirmed, when, which exit, and
   the exact sighting ids they were shown. `create_refund_hold` recomputes
   the set under the post lock and raises ATTESTATION_STALE if reality grew
   past what the owner saw. Its idempotency answer comes BEFORE its status
   checks — the hold itself changes the post's status, so a retry after a
   dropped response must not be told POST_NOT_REFUNDABLE (the test suite
   caught this).
4. **Disputes are per sighting, once, no-oracle.** Several spotters may each
   file; the single-winner rule is enforced at resolution, not filing. Every
   refusal `open_dispute` can make — not yours, window closed, money moved,
   already filed — is the identical DISPUTE_NOT_AVAILABLE.
5. **Resolution is a person in v1** (`resolve_sighting_dispute`, service
   role, run by hand — the `payout_reviews` pattern). Upheld credits the
   sighting directly, because `claim_recovery` cannot (it accepts `active`
   only and the post is closed) — mirroring its guards (single-winner index
   as structural backstop, counter increment, no self-credit) and returning
   the post to `recovery_claimed`, where the EXISTING release-payout core
   (collusion gate, `post-payout-{id}` idempotency, `mark_recovery_paid`)
   pays the spotter with zero changes. Only a post with a hold can be
   resurrected — this function must never turn an ordinary old cancelled
   post back into a live recovery.
6. **The clock finally has a worker.** `release-held-refunds` (hourly Supabase
   Cron, `x-cron-secret` header, deployed --no-verify-jwt, safely invocable
   by hand) refunds expired undisputed holds under the SAME per-path
   idempotency key the immediate exit would have used, retries upheld payouts
   behind the payable-webhook, and sends outcome pushes behind conditional
   claims. Open AND upheld disputes block Phase 1.
7. **Three new push kinds.** `closed_uncredited` IS the feature — without it
   the control protects nobody. `dispute_upheld`/`dispute_rejected` exist
   because hand-run resolution has no client in the loop: without the upheld
   push a winner never learns and the money strands; without the rejected one
   they hang forever. No owner `refund_sent` push — they initiated, were told
   the date, and their bank statement confirms. Dispute payloads carry the
   SIGHTING id: the post is invisible to the spotter once closed.
8. **`delete-account` blocks on money in motion**, not post status alone: a
   held-deactivate post (status `cancelled`, payment `held`) passed the old
   status check and the erasure would have died mid-flight on payments'
   ON DELETE RESTRICT.

## Consequences

- Honest owners with no recent sightings feel NOTHING — the gate answers
  refund_now and the flow is byte-identical to before.
- Honest owners WITH recent sightings wait 72 hours for their refund and tap
  one extra confirmation. That is the price of the spotter's protection, and
  the copy states it before the tap, with the real date.
- A dishonest owner now faces: an explicit recorded lie, notified spotters
  with an evidence trail a person will read, and a delayed refund. Not
  perfect — a spotter who ignores the push loses the window — but the
  one-tap silent exit is gone.
- The founder acquires a review duty (reading sighting trails within 72
  hours of a dispute) and a runbook line in supabase/functions/README.md.
  At v1 volume this is minutes per week; a moderator page stays on ROADMAP.
- Supabase Cron is new infrastructure the project deliberately avoided until
  now. It also unblocks the deferred receipt drain and retention purge.

## Rejected alternatives

- **Attestation only** — pure deterrence; a determined liar walks away
  same-day and the spotter never knows.
- **Hold on ANY uncredited sighting** — a months-old sighting on a
  long-running post would hold an honest owner's refund hostage.
- **Auto-crediting on dispute** — money moved by an unreviewed claim swaps
  one fraud surface for another (spotters disputing everything).
- **Storing "released" on the hold** — a second source of truth about money
  state, guaranteed to drift from payments.status eventually.

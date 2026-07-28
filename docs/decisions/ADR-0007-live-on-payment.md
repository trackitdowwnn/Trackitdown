# ADR-0007 — Live on payment (retiring verification-before-visibility)

**Status:** accepted · **Date:** 2026-07-30 (recorded retrospectively 2026-07-27
session, when the gap was found)

## Context

The original model was **verification-before-visibility**, listed in ROADMAP's
decision log and stated in SECURITY_AND_TRUST.md §2 as *"No post is publicly
visible before ownership verification passes… the primary control against
someone using the platform to track a person rather than recover a car."* An
owner uploaded a V5C, a moderator checked ownership, and only then did the post
go public (`draft → pending_verification → active`).

Two things broke that model in practice:

- **The clock.** A stolen car's recovery odds fall away by the hour. A blocking
  human review spends exactly the window that matters most — and the queue is
  slowest at night and at weekends, when cars are actually taken.
- **The queue never existed.** No moderator tooling was ever built: no admin
  routes, screens or roles. The "primary control" was documented but not
  operable, so posts were gated on a review nobody could perform.

Options considered:

- **A — keep the gate and build the moderator queue.** Honest to the written
  model, but it is a whole product surface (auth, roles, audit log, SLAs), and
  even done well it still costs the critical hours.
- **B — live on payment (chosen).** A paid post goes straight to `active`.
  Safety moves from a blocking pre-check to reactive controls.
- **C — auto-approve with sampled review.** Publishes fast and preserves some
  check, but still needs the moderator queue to be worth anything, so it is B
  plus unbuilt infrastructure.

## Decision

Adopt **B**. `mark_post_payment_held` advances `draft → active` directly
(`20260730100000_live_on_payment.sql`). V5C collection is removed from the
posting flow. `pending_verification`, the `verification_documents` table, the
private bucket and `update_post_verification` all remain in the schema but are
dormant — nothing enters that state or writes those.

What replaces the gate:

- **Accountability, not anonymity** — every post is a real account with a card
  on file and £50–£5,000 in escrow. Abuse is traceable and costly.
- **Escrow forfeiture** — a post taken down is `cancelled` and refunded, so a
  bad-faith poster ties up real money and gains nothing.
- **Report → flag → takedown** — `post_flags` + `flag_post` capture durable,
  attributable reports; takedown reuses the deactivate/refund path. Deliberately
  **no auto-hide on N reports**: that would invite griefers to bury a victim's
  real post during the window that matters.

## Consequences

- **Accepted risk, stated plainly:** nothing verifies that the poster owns the
  car. This is a real reduction in the anti-stalking posture, not a neutral
  swap. It is recorded as an OPEN GAP in SECURITY_AND_TRUST.md §2 rather than
  quietly dropped.
- The plate-uniqueness backstop weakened twice over: plate capture was also
  removed from the wizard (2026-07-24), leaving `create_post`'s `PLATE_IN_USE`
  check dormant. The **garage** (2026-07-27) partially re-arms it by supplying a
  plate from a saved car.
- Re-introducing an ownership check — for high bounties, repeat posters, or at
  garage-save time — remains available, but depends on the moderator queue
  existing first. The garage deliberately did **not** take it on: pre-verifying
  a saved car buys no time now that posts publish instantly.
- Documentation debt this ADR settles: SECURITY_AND_TRUST.md §2 and ROADMAP.md
  both asserted the retired model for a week after the code changed. The lesson
  is that removing a *control* needs the same ceremony as adding a feature.

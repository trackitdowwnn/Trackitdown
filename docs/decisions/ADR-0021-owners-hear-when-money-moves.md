# ADR-0021: Owners hear when their money moves

**Status:** ACCEPTED · **Date:** 2026-09-25 · Reverses ADR-0011 §7 (no owner
"refund sent" push). Amends ADR-0018's "nothing renders a payment status" and
adds two kinds to the ADR-0012 registry. Decided by the owner in the 2026-09-25
escrow UX review.

## Context

ADR-0011 §7 decided that owners get no push when their refund is sent. At the
time the refund always followed an action the owner took on screen, so a toast
seemed enough. Two things have changed since:

- **Most money now moves while the owner is not looking.** A refund held for
  the 72-hour dispute window is released by the hourly sweep, three days after
  the owner closed the listing. A reward is most often released by the
  `account.updated` webhook, days after the owner credited a spotter, when that
  spotter finally finishes payout setup. No toast can cover either moment,
  because the owner is not in the app when it happens.
- **The owner's side had no money signal at all.** A listing's status badge
  said "Recovered" or "Cancelled" whatever the money did. The owner found out
  when their card statement changed, or not at all.

There was also a reliability gap on the spotter's side. The `credited` push
("You've earned £X") is fired from the owner's phone at the moment of credit.
If that app dies at the wrong moment, the spotter is never told.

## Decision

**Two owner pushes, both in the `money` preference category (mutable).**

| Kind | Title | Body | When |
|---|---|---|---|
| `refund_sent` | "£413.50 refunded" | "For your Black BMW. It usually reaches your card within 5–10 working days." | An escrow refund lands |
| `reward_delivered` | "£400.00 sent to your spotter" | "The reward for your Black BMW is on its way to them." | The reward transfer goes out |

- **Amounts are the recorded ones.** A refund push shows `refunded_amount_pence`,
  net of the card fee. A reward push shows `transfer_amount_pence`. Neither is
  an estimate.
- **The owner is told nothing about the spotter**, not even a first name.
  They chose the spotter and know who it is, and a name in a push crosses
  third-party infrastructure for no gain.
- **Both route to the listing**, where the owner's money status shows the same
  fact with its date.
- **Claim-then-copy in SQL** (`claim_refund_sent_notification`,
  `claim_reward_delivered_notification`), with one-shot markers on `payments`.
  The markers are backfilled on every already-settled row, so no past move is
  announced as news.
- **Senders:** every path that settles money calls one of these, and the
  hourly sweep's Phase 2c catches a crash between the two:
  - `deactivate-post`, `refund-recovery`, the hold sweep's Phase 1 and the
    `charge.refunded` webhook for refunds;
  - `releasePayoutForPost` for rewards (the manual release, the webhook's
    auto-release, the create-account path and upheld disputes).

**A safety net for the spotter's credited push.** The sweep scans for credited
sightings whose `credited_notified_at` is still NULL and sends through the same
`claim_credited_notification`. Historical credits were backfilled as announced.
Moving the push server-side at the moment of credit was considered and
rejected: it would add a hop on the most important tap in the app for a failure
the sweep already catches within the hour.

## Consequences

- Owners learn about their money at the moment it moves, including the moments
  that happen days later.
- The `money` preference switch is renamed from "Payouts" to "Money", because it
  now carries an owner's news as well as a spotter's.
- Two more kinds to keep in step across the SQL constraints, the client
  registry and the Jest agreement tests, which fail if they drift.
- An owner who closes a listing and never reads their notifications is still
  told only once. The pushes are news, not reminders.

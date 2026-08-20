# ADR-0014 — No-bounty listings and the fixed platform fee

**Status:** accepted · **Date:** 2026-08-20 · Extends ADR-0002's charge pattern
with a second pricing mode; amends DOMAIN.md's "Bounty rules"

## Context

Until now, posting required a bounty of **£50 minimum**. That is the price of
admission for someone whose car has just been stolen — at the exact moment they
are least able to commit money, and in the first hours that decide whether the
car is found at all (ADR-0007, live-on-payment). An owner who cannot or will not
put £50 into escrow simply does not post, so the crowd never hears about the car
and the platform earns nothing from them either.

The platform's only revenue model was 5% of a bounty (ADR-0002, transfer math).
No bounty meant no revenue, which is why "just let them post free" was never on
the table: posting free is also posting **anonymously enough to be cheap to
abuse**, and the card-on-file is the main deterrent DOMAIN.md's anti-abuse
section leans on now that pre-publish review is gone.

Decisions taken with the owner (2026-08-20): **£4.99**, non-refundable, no cash
reward for the spotter, and the listing is fully visible on every discovery
surface.

## Decision

1. **A post's pricing mode is not a flag — it is which of two money columns is
   populated.**
   ```sql
   bounty_amount_pence  integer null   -- £50–£5,000, or NULL
   listing_fee_pence    integer null   -- 499, or NULL
   check (num_nonnulls(bounty_amount_pence, listing_fee_pence) = 1)
   ```
   There is no `pricing_mode` enum, because a separate flag can drift out of
   sync with the money it describes. The invariant is checked by the database on
   every row rather than promised by the functions above it.

2. **NULL, never 0.** A zero bounty flows silently through every formatter and
   renders "£0 bounty" on cards, map pins and push copy. A NULL makes the type
   checker and zod stop at each read site and force a decision. This is the
   whole reason the column is nullable, and it is why `?? 0` is banned
   downstream — including in the two files where such a coercion already existed
   (`myPostsApi`, `watchlistApi`), both of which were printing "£0 bounty" on
   watchlist tombstones before this change.

3. **The fee is £4.99, stamped server-side, and snapshotted.** One authoritative
   definition, `current_listing_fee_pence()`, mirroring how `payout_split()`
   owns the 95/5 split. `create_post` copies it onto the post; charge-time
   validation compares against **that snapshot**, never against the function, so
   changing the price never re-prices an existing draft. The client never sends
   a fee — the price is not the client's to name (SECURITY_AND_TRUST §4).

4. **A listing fee is captured to `collected`, a new terminal `payment_status` —
   it never enters `held`.** This is the load-bearing choice of the whole ADR.
   Every refund and payout query in the codebase selects `status = 'held'`, so a
   fee row is invisible to all of them **by construction** rather than by
   remembering to add a filter to each. A `kind` column alone would have relied
   on that memory, on the money path, forever. `kind` exists too, but only so a
   row is discriminable while still `requires_payment`.

5. **The two paths cannot cross, in both directions.** `record_post_payment_intent`
   refuses a fee-priced post and `record_listing_fee_intent` refuses a
   bounty-priced one; `mark_post_payment_held` refuses a `listing_fee` row and
   `mark_listing_fee_collected` refuses a `bounty_escrow` one. The asymmetry
   worth naming: a fee wrongly marked `held` becomes refundable money that never
   should be, but an escrowed **bounty** wrongly marked `collected` disappears
   from every refund path — the owner's £50–£5,000 silently kept. The second is
   far worse, and is why the guard runs on the capture side too.

6. **The spotter's reward is credit and reputation, not cash.** The owner still
   credits one sighting; `recoveries_credited` still increments. No transfer, no
   Connect onboarding gate, no `release-payout` call. The listing says so up
   front, and the post-detail explainer says it plainly rather than leaving a
   spotter to hope.

7. **A fee post closes TERMINALLY on claim.** `claim_recovery` lands it on
   `recovered` / `recovered_no_spotter` directly and returns `nextStep: 'done'`,
   instead of the `recovery_claimed` waypoint. That waypoint exists only because
   a money leg follows; with no money leg the post would park there forever
   waiting on a payout that never comes — which also permanently blocks the
   owner from deleting their account (DOMAIN.md, "Account deletion").

8. **The fee is NOT refundable, and a fee listing sits outside the
   refund-hold/dispute machinery.** Taking a fee listing down is
   `cancel_fee_listing`: delist, move no money, create no hold, open no dispute
   window. ADR-0011's machinery exists to stop an owner denying a spotter the
   **bounty they earned**; with no bounty there is nothing to deny, and running
   the 72-hour hold anyway would delay a takedown for three days to protect
   nothing. Non-refundability is disclosed on the pricing step, before any money
   moves — the flow has no checkout screen, so that step is the only
   pre-payment surface there is.

9. **Fully visible on every discovery surface, with two ranking carve-outs.**
   A no-reward listing appears in the feed, on the map, in search and in spotter
   alerts exactly as a bounty listing does. But:
   - **Minimum-bounty alerts never match it.** `NULL >= n` is unknown, so this
     holds for free — which is precisely why it is asserted in the suite: a
     well-meaning `coalesce(bounty, 0)` added later would silently make every
     no-reward post match every alert.
   - **"Highest bounties nearby" excludes it.** Postgres sorts NULLs **first**
     under `DESC`, so without a filter these would head a carousel named for the
     thing they lack. Filtered rather than `nulls last`, so the section's ten
     slots go to ten real bounties.

## Consequences

- **Revenue per no-reward listing is thin and must be watched.** £4.99 less UK
  card fees (~1.5% + 20p) nets about £4.72, and materially less on
  international cards. It is deliberately priced as an access fee rather than a
  margin; if the mix shifts heavily toward no-reward listings, the price is the
  lever, and it now moves in one place.
- **Two pricing modes is a permanent fork in every money path.** Every future
  change to the charge, refund or payout code must answer "and for a fee
  listing?" The `collected`-never-`held` design means the honest default answer
  is "it does not apply", but the question has to be asked.
- **`payment_status` gained a value and enums cannot lose one.** `collected` is
  a one-way door, accepted over a lookup table (which would have rewritten the
  whole ledger's status column for one new state).
- **No cash reward changes what a spotter is owed, and the copy must keep
  saying so.** The risk is a spotter reporting a sighting believing a payout is
  coming. The listing card, the sticky bar and the explainer all name it; that
  consistency is a maintenance obligation, not a one-off.
- **Deferred deliberately:** an optional post-hoc tip from owner to spotter (a
  whole second payment flow — new charge, transfer and Connect gate), and any
  variable or promotional listing price. Revisit both on beta data.
- Supersedes nothing. ADR-0002's charge pattern (separate charges and transfers,
  immediate capture) is unchanged for bounty posts, and the 11 checks in
  `post_payment_verification.sql` pass untouched — that, not this paragraph, is
  the evidence the escrow path was not disturbed.

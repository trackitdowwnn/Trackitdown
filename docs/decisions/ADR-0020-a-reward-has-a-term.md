# ADR-0020 — A reward has a term

**Status:** ACCEPTED · **Date:** 2026-10-05 · Supersedes ADR-0019 point 1
("no cron may move strangers' money on a timer"), for one case only, and the
matching rule in `DOMAIN.md` ("there is still no passive expiry")

## Context

Stripe lead support, 2026-10-05:

> Funds Segregation does not remove the applicable 90-day holding-period
> restriction … Holding funds beyond 90 days is generally not permitted …
> If this occurs persistently, Stripe may take action to offboard the account.

A reward is charged when the listing goes live and, until now, sat on the
platform balance until the owner ended the listing or a recovery paid it out.
For a car that stays missing, that is indefinitely. The 90-day limit therefore
applies to the most ordinary listing we have, and losing the Stripe account
would end the product.

Two earlier decisions stand in the way:
- **ADR-0019** chose to *ask* abandoned owners rather than expire anything,
  and made "no cron may move strangers' money on a timer" a rule.
- **DOMAIN.md** says every refund is a human act.

Both were right about what they protected: a spotter's claim must never be
lost to a clock, and a timer must never decide who is paid. They did not
anticipate a hard ceiling on how long we may hold money at all.

**Stripe confirmed the design, 2026-10-06** (support, by email), after we
described the funds flow:

> … your platform's funds flow is fully compliant with Stripe's funds holding
> period policy. … Your approach of treating renewals as new payments with the
> previous charge refunded is the correct approach. This effectively resets
> the clock on each new listing term …

Their reasoning assumed money leaves "within 60 days". Our rare longer cases
were not put to them: a 72-hour sightings hold, an open dispute, a credited
spotter who never onboards (refunded at day 80), and pre-term rewards capped
at day 80. All of them stay under the hard line at capture + 85 days (point 6
below). Two questions are still open with Stripe: does the 90 days run from
the charge or from when the funds become available, and are those cases
explicitly fine?

## Decision

**A reward lasts 60 days. The listing itself has no term.**

1. **The term.** Every reward runs for 60 days from capture
   (`payments.term_ends_at`, stamped by `mark_post_payment_held`). Renewing,
   or changing the amount, is a new charge with its own 60 days. The previous
   reward is then refunded minus the card fee (PR2's change path).
2. **Told, then reminded.** The Terms say all of this. Owners are reminded
   10 days and 3 days before the end (`claim_reward_reminders`, through the
   unmutable `reward_ending` kind). The listing shows a reward banner, which
   is the door to renewing; the pushes only point at it.
3. **At the end, the reward goes home.** If it isn't renewed, the reward is
   refunded to the owner automatically, minus the card fee (PR5), and the
   listing stays live with "Reward ended" (PR4). The owner can add a reward
   again at any time.
4. **Spotters keep every protection.** The automatic refund goes through
   ADR-0011's machinery:
   - **recent sightings:** recent uncredited sightings (14 days) start a
     72-hour hold, and those spotters are told and may dispute;
   - **disputes:** an open or upheld dispute blocks the refund;
   - **claims:** nothing changes while any claim is open.

   In addition, a reward can't be **lowered** while recent uncredited
   sightings exist. That rule is checked again at capture, so it can't be got
   round by holding a payment back.
5. **Rewards held before this shipped** get one notice
   (`claim_reward_term_notices`). Their term is
   `least(capture + 80 days, greatest(capture + 60 days, notice + 14 days))`,
   floored at notice + 3 days and never past capture + 85 days. That means at
   least 14 days' notice where the 90-day limit allows it, never shorter than
   a new reward, and never a date already gone. Those owners paid under Terms
   with no term, so the payment is marked `legacy_term` and **its
   end-of-term refund** is made in full; the expiry alone reads the marker.
   Their other refunds (cancelling, a recovery, a renewal) are unchanged.
   That was the owner's decision.
   Every term, new or legacy, runs to the **end of its named London day**
   (`reward_term_end`): "ends on 4 December" means all of 4 December.
7. **Notices are switched on, not deployed on.** The sweep sends notices and
   reminders only when `REWARD_TERM_NOTICES_ENABLED=true`. They promise the
   expiry (PR5) and point at the updated app's Renew button, so the switch
   goes on once both are live.
6. **The hard line is capture + 85 days for the TERM; capture + 88 with its
   window.** The oldest legacy term can end at capture + 85, and its spotters
   still get their full 72 hours (a promise in their push and the Terms), so
   the latest refund is capture + 88 — under Stripe's 90. A sighting during
   the window extends it only while it would still end by capture + 88. Only a
   dispute can hold money longer, and a person is resolving it then. 60 days plus a 72-hour hold leaves
   room. Anything older than 75 days is emailed to the operator daily
   (`claim_money_deadline_alerts`), whatever the reason it's still held.

**What this supersedes, exactly.** ADR-0019 point 1 becomes:

> A timer may return an owner's own reward to that owner, on a date they were
> told in advance, through the ADR-0011 hold. A timer may never pay a
> stranger, never keep money, and never close a listing.

The rest of ADR-0019 stands. The "still missing?" ask still moves no money
and changes no status. `posts.expires_at` stays dormant: the term belongs to
the payment, not the post.

## Considered and not chosen

- **Charge only on success.** Save the card and charge it at recovery. This
  removes holding altogether, but loses the "the reward is already paid"
  guarantee spotters rely on, and a card can be declined at the one moment
  that matters. The owner chose the term instead (2026-10-05).
- **Expire the listing with the reward.** Simpler, but a car that is still
  missing would lose its listing, its sightings and its alerts. The owner
  chose to keep the listing live.
- **A 90-day term.** It leaves no room for a 72-hour hold or a dispute before
  the ceiling. 60 days is also Stripe's own refund recommendation.

## Consequences

- Renewal costs the owner the card fee on the old payment. That is disclosed
  on the change screen before they pay, and is the same rule as every exit
  the owner chooses.
- The expiry (PR5) must ship before the first term ends. A legacy term can
  end as soon as **14 days after its notice**, and sooner for a reward older
  than about 66 days: 3 days at the floor, and capture + 85 days at the
  latest. The notices therefore wait behind the switch until PR5 is ready.
  The 75-day operator alert is the backstop either way.
- The ledger can now hold several payments per post over time. One held
  payment per post is enforced by an index; refunds are keyed per payment.
  See `20261005110000`.
- **The expiry (PR5, `20261006130000`).** The sweep's `claim_reward_expiries`
  claims each reward past its term (live listing, no claim on the money, no
  renewal started in the last hour, and not past a day after the term), fixes its refund basis on the payment
  (a legacy reward: in full), and raises a **system hold**. That hold is 72
  hours over the recent sightings' spotters (told, and able to dispute), or
  due at once with none. The refund is recorded by
  `mark_reward_ended_refunded`: the listing stays up, its bounty clears and
  "Reward ended" is stamped. Refund holds became **one per payment** for
  this; a settled hold is history, not a claim, so a lapsed listing can take
  a reward again. An owner exit during the window upgrades the system hold,
  still delists, and keeps the spotters' window. A stale "found it another
  way" is finished as that recovery refund at the end of the term. Behind
  `REWARD_EXPIRY_ENABLED`, turned on with the notices (docs/OPERATIONS.md §8).
- **A credited reward has a deadline (2026-10-07,
  `20261007100000_a_credited_reward_has_a_deadline.sql`).** A credited
  spotter, or a dispute winner, who never sets up payouts has until
  `payout_deadline`: the end of day 80 after capture, or 7 days after the
  credit (`sightings.credited_at`, not the post's recovery time: a dispute can
  be upheld long after the owner's claim) if later, never past capture + 85.
  They are reminded 7 and 2 days before. Past it, the sweep re-reads the
  payee from Stripe, tries the payout once more, then refunds the owner
  **in full** (a missed payout is not the owner's doing, so no card fee) and
  closes the post as `recovered_no_spotter`. The credit stays on the spotter's
  record. `begin_payout` and `claim_payout_lapse` share the post lock, so a
  transfer and a lapse refund can never both start, and the sweep checks Stripe
  for a transfer before refunding. A claimed lapse is resumed by every run
  until it is refunded, or parked if Stripe shows a transfer. A payout review
  short of approved stops the clock. Behind `PAYOUT_DEADLINE_ENABLED`
  (docs/OPERATIONS.md §8). The 75-day operator email still fires as the
  backstop.
- **A deadline names its last day (2026-10-07,
  `20261007120000_a_deadline_names_its_last_day.sql`).** Every term end and
  payout deadline is stored as the midnight AFTER its last day
  (`reward_term_end`), but every push and the app printed that midnight's
  date: one day late, so "ends on 7 December" really ended at 00:00 on the
  7th. The server's `last_day_text` and the app's `formatLastDay` now name the
  last WHOLE day: the calendar day before the one the end falls on, by the
  same rule on both sides. For an end the capture + 85 hard line cuts partway
  through a day, that is the day before it, so nobody is told a day that
  isn't wholly theirs. The banner's renewal line now says "60 days from the
  day you renew", not "another 60 days". Found before any term ended or the
  payout deadline was switched on, so nothing moved on a wrong day.

## Links

- Migrations: `supabase/migrations/20261005110000_a_reward_can_be_replaced.sql`,
  `20261005130000_a_reward_can_be_changed.sql`,
  `20261005140000_a_reward_has_a_term.sql`.
- `src/features/legal/lib/legalContent.ts` (the Terms).
- `src/features/payments/components/RewardTermBanner.tsx`,
  `src/features/payments/screens/ChangeRewardScreen.tsx`.
- `docs/decisions/ADR-0011-refund-holds-and-disputes.md`,
  `docs/decisions/ADR-0019-the-abandoned-post.md`, `docs/OPERATIONS.md` §8.

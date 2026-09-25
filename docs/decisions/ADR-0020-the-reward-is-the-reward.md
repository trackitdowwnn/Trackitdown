# ADR-0020 — The reward is the reward: the service fee goes on top

**Status:** ACCEPTED · **Date:** 2026-09-25 · Amends ADR-0002's transfer math
and DOMAIN.md's "Listing pricing" and "Bounty rules". Decided by the owner in
the 2026-09-25 escrow UX review.

## Context

Until now a reward listing worked like this: the owner offered £500, was
charged £500, and on a spotter-led recovery the platform transferred 95%
(£475) to the spotter and kept 5% (ADR-0002, `payout_split`).

Every surface a spotter sees says something else:

- The card and the listing show **"£500 reward"**.
- After reporting, `ReportSightingScreen` says **"you'll receive the £500
  reward"**.
- The credited push then says **"You've earned £475"**.

The 95% appears only in the Terms. So the product promises one number and pays
another, and the spotter first learns the difference at the best moment the
app has — the moment it tells them they helped get a car back. There were two
honest fixes:

1. Show spotters the net figure everywhere ("£475 reward"). This is copy-only,
   but the owner and the spotter then see different numbers for the same reward,
   and the owner's "£500" reads as £25 lost to someone else's cut.
2. **Put the fee on top.** The owner pays £525; the spotter receives the £500
   they were shown.

## Decision

**Option 2. The reward is what the spotter receives; the service fee is added
on top and paid by the owner.**

| | Before (fee inside) | After (fee on top) |
|---|---|---|
| Owner offers | £500 | £500 |
| Owner is charged | £500 | **£525** |
| Spotter receives | £475 | **£500** |
| Platform keeps (spotter-led recovery) | £25 | £25 |
| Refund (no spotter, or cancelled) | £500 − card fee | **£525 − card fee** |

The rules:

- **Fee = floor(5% of the reward),** in integer pence: `(reward * 5) / 100` in
  Postgres integer division, `Math.floor(reward * 5 / 100)` in TypeScript. It
  never charges more than 5%, and every whole-pound reward (all the slider can
  produce) is exact. `charge = reward + fee`, exactly.
- **Bounds apply to the reward.** £10–£5,000 is still the reward range and still
  the fraud ceiling, so the charge ranges from £10.50 to £5,250.
- **A refund returns the whole charge minus Stripe's actual card fee.** The
  platform earns its 5% only on a spotter-led recovery, as before; a refund
  returns the service fee too.
- **The split is stored on the payment row when it is charged** (`pricing`,
  `reward_pence`, `service_fee_pence`) and never recomputed at payout.
  `payments_split_check` pins each pricing's arithmetic, and
  `mark_recovery_paid` refuses a transfer that differs from the stored reward.
- **Legacy rows keep their rule.** Every escrow row charged before 2026-09-25 is
  `fee_inside` and pays 95/5. All of them are Stripe test-mode money; no live
  payment has ever been taken.
- **The £5 listing fee (ADR-0014) is unchanged** and recorded as `flat_fee`.

## How it ships

- `record_post_payment_intent` now expects `reward + fee` for a reward listing
  and refuses the bare reward with `BOUNTY_MISMATCH`.
- `create-payment-intent` charges `reward + fee` (`_shared/serviceFee.ts`) and
  **requires the app to send `pricing: 'fee_on_top'`.** That field is not a
  choice — the server derives the price — but it proves the build showed the
  owner the fee-on-top total. An older build showed the bare reward, so it is
  refused with `UPGRADE_REQUIRED` rather than charged 5% more than it displayed.
  No legacy charge path is kept: on 2026-09-25 nobody but the owner has a build,
  so the cost of refusing is one OTA update.
- The server change and the client that displays "Reward / Service fee / You
  pay" ship in one PR. **Deploy order matters:** migrations and functions
  FIRST (`deploy.yml` does this on merge), THEN the OTA. The new app compares
  the server's priced total with what it showed and refuses the sheet on a
  difference, and the old function returns no total at all — so an OTA that
  lands before the functions would refuse every reward payment.
- **Hardened in review, before merge:**
  - `payments_split_check` fails closed on NULLs.
  - A new escrow charge without a pricing is refused rather than filled as 95/5.
  - A recorded split, and a settlement date once stamped, can never be rewritten.
  - A pending charge row is reused only for the SAME intent. It matched on the
    amount before, which could leave a paid intent unrecorded.
  - `create-payment-intent` asks Stripe whether any earlier attempt has already
    been paid (`PAYMENT_ALREADY_TAKEN`) before it opens another. It refuses to
    proceed if it cannot cancel a stale intent.
  - The app re-saves a draft's reward before a retry only when it changed. A
    reward/£5-fee switch after the draft exists is refused in words.

## Consequences

- **Good:** the spotter-facing number is true everywhere, with no copy
  gymnastics. The owner's cost is explicit at the one moment they decide it.
  The platform's revenue on a recovery is unchanged.
- **The owner pays 5% more for the same advertised reward.** This is the real
  trade: the fee is now visible and theirs, rather than hidden inside the
  spotter's share.
- **Thin margin at the floor.** A £10 reward earns 50p against a card fee of
  roughly 36p (UK card) to 54p (international), before Connect payout costs.
  This is accepted: the floor exists for access, not margin (ADR-0014's
  argument), and the fee is a percentage by design.
- **The Terms must change** (95/5 → fee on top). The wording is updated in the
  app, and the legal review before live mode must cover it.
- **`payout_split` survives only as the `fee_inside` rule.** No payout path
  calls it; the verification suites use it as the reference for legacy rows.

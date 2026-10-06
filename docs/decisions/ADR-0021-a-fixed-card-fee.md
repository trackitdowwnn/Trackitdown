# ADR-0021 — A refund keeps a fixed card fee

**Status:** ACCEPTED · **Date:** 2026-10-06 · Amends ADR-0002's refund rule
("bounty minus the non-recoverable Stripe fee")

## Context

When a reward comes back to its owner (they cancel, find the car themselves,
or the 60-day term ends), the refund has always been the reward minus the card
processing fee. Until now that fee was **Stripe's actual fee for that charge**,
read from its balance transaction at refund time.

That fee varies by card. Standard UK cards cost 1.5% + 20p; premium, EU and
international cards cost more. So no screen could tell an owner, before they
paid, exactly what they would get back. Every quote said "about £196.80" and
"about £3.20", which is honest but not reassuring. These are screens where
someone whose car was stolen is deciding how much money to put up.

The owner asked for money and refund wording to be reassuring and free of
hedges like "about".

## Decision

**The card fee a refund keeps is a fixed 1.5% of the reward plus 20p**
(Stripe's standard UK card rate). It is exactly what the app quotes before
payment, and exactly what the refund withholds. Whatever a card costs beyond
it, Trackitdown absorbs.

- **One formula, two copies, pinned together.** `cardFeePence` in
  `supabase/functions/_shared/refundEscrow.ts` decides the refund;
  `cardFeePence` / `refundPence` in `src/shared/lib/money.ts` quote it.
  `supabase/tests/refundEscrow.test.ts` checks they agree for every reward
  amount.
- **Stripe's per-charge fee is no longer read.** The refund is a pure function
  of the ledger row, so every path and every retry under the payment's
  idempotency key asks Stripe for the same amount.
- **Unchanged:** stray captures are still refunded in full
  (`refund_fee_absorbed`). The 95/5 payout split is unaffected.
- **Not yet implemented — PR5's job:** the Terms promise a `legacy_term`
  reward's END-OF-TERM refund in full. Nothing refunds at end of term until
  PR5's expiry ships, and `refundPayment` never reads `legacy_term`. PR5 must
  make "absorbed" a fact on the payment row *before* any refund can start
  (e.g. the expiry claim sets `refund_fee_absorbed = true` in the same
  transaction that takes the payment out of reach of deactivate and recover),
  so the amount stays a function of the payment alone under its idempotency
  key. `REWARD_TERM_NOTICES_ENABLED` stays off until then.
- **Copy:** every pre-payment and pre-refund quote states exact figures —
  "£196.80 goes back to your card. Only the £3.20 card fee is kept." The Terms
  name the fee ("1.5% of the bounty plus 20p") and promise the quoted amount
  is the amount refunded.

## Consequences

- **Cost:** on a premium, EU or international card, Trackitdown pays the
  difference between Stripe's fee and the fixed fee on every refund. At UK
  launch volumes this is small; revisit if non-UK cards become common.
- **Never worse for an owner:** a standard UK card cost exactly this before,
  and a dearer card no longer costs the owner more. So the Terms change is in
  the owner's favour and needs no advance notice.
- **Deploy order:** the server change must be LIVE before the app update that
  states exact figures and the new Terms. Merge → confirm the deploy run moved
  every function's version → only then publish the OTA (and confirm it with
  `eas update:list`). The other way round, owners on dearer cards would get
  less than the Terms now promise.
- **Deploy edges, once:** a refund already in flight at deploy time, retried
  under the same idempotency key with the new amount, is refused by Stripe
  (`stripe_error`, retried by the sweep). A later request issues a refund only
  if no earlier one already moved the money: `refundPayment` lists existing
  refunds before creating one, and Stripe caps a charge's refundable amount,
  so nothing is refunded twice. A refund made under the old rule on a dearer
  card and recorded after the deploy logs one spurious "[ops] ALERT partial
  refund" (it is below the new fixed figure); check and ignore.
- **Pricing assumption:** the fixed fee is Stripe's standard UK card rate.
  Confirm in the Stripe Dashboard that the account is on standard pricing;
  on custom or interchange-plus pricing the fixed fee could exceed the real
  cost, and "never worse for an owner" would need revisiting.

## Links

- `supabase/functions/_shared/refundEscrow.ts` (`cardFeePence`, `refundAmountPence`)
- `src/shared/lib/money.ts` (`cardFeePence`, `refundPence`)
- `src/features/legal/lib/legalContent.ts` (the Terms' refund paragraph)
- `docs/decisions/ADR-0020-a-reward-has-a-term.md`

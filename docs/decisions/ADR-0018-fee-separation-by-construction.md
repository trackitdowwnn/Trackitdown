# ADR-0018 — A listing fee that refund queries cannot see

**Status:** PROPOSED — needs an owner decision before any migration touches
`payments` · **Date:** 2026-09-02 · Buys back the property ADR-0014 recorded
losing, and closes the whole-app review's finding #13

## Context

ADR-0014 shipped a second pricing mode — a fixed £5 listing fee instead of an
escrowed bounty — and its own correction section is unusually blunt about what
the shipped version cost:

> | how a fee is kept out of refunds | **structurally** — it never reaches
> `held`, which every refund query selects on | **by predicate** — every
> selector must filter `kind = 'bounty_escrow'` |
>
> **The last row is a real loss and is recorded as one.** … If this is ever
> revisited, that is the property worth buying back.

It also records what the loss already cost: those filters "were missing until
2026-08-22 — `a_listing_can_be_free` says they would land 'in the same change'
and they never did, so a £5 fee would have been refunded by an hourly cron."
Four days, real money, an automated process.

### The count is now five, and two are SQL

The ADR says "three Edge Functions". That is out of date:

| # | Site | What it protects |
|---|---|---|
| 1 | `_shared/refundEscrow.ts:82` | the refund itself |
| 2 | `_shared/releasePayout.ts:171` | the 95/5 transfer |
| 3 | `release-held-refunds/index.ts:182` | the **hourly cron** — unattended |
| 4 | `20260822100000_a_fee_listing_can_come_down.sql:91` | the deactivation guard |
| 5 | `20260902110000_credited_no_reward_notification.sql:168` | the credited push copy |

⚠️ **I added #5 this morning**, closing a different finding. Without it, a £5 fee
row reads as a bounty and the spotter is told *"You've earned £4.75"* on a
listing that carries no reward. That is not a criticism of the change — the
filter is correct — it is the evidence that matters: **the pattern is
spreading, not holding.** Every future feature that reads `payments` inherits a
rule it must remember, and the failure mode is silent in all five places.

## The proposal

Give a captured fee its own terminal status, so it never enters the state every
money query selects on.

**Today:** `payment_status` is `requires_payment → held → released | refunded |
failed`. A fee is captured to `held` and stays there forever, indistinguishable
from escrow except by `kind`.

**Proposed:** add `collected` — captured, ours, terminal, never refundable and
never payable. `mark_post_payment_held` branches on `kind` at the one moment the
charge succeeds, and nothing else changes shape.

Then:

- `refundEscrow` selects `status = 'held'` — **a fee is not in that set.**
- `releasePayout` selects `status = 'held'` — same.
- The hourly sweep joins `payments.status = 'held'` — same.
- `claim_credited_notification` reads `status in ('held','released')` — same.
- The deactivation guard asks "is there escrow on this post" — `held` alone
  answers it.

The `kind` filters become redundant rather than load-bearing. That is the whole
point: **a rule enforced by the shape of the data cannot be forgotten by the
next person to write a query.**

## What this does NOT change

- No money moves. `collected` is where a fee already effectively sits; the
  status name catches up with the fact.
- No client change. Nothing renders a payment status.
- ADR-0002's separate-charges-and-transfers model is untouched. This is a
  vocabulary change inside our own ledger.

## The three questions that need deciding

### Q1. Do the five `kind` filters stay or go?

- **(a) Keep them all.** *Recommended.* Belt and braces: the structural property
  is the guarantee, the predicate is the second lock, and removing five correct
  filters in the same change that alters money states doubles what a mistake
  could cost. They stop being load-bearing without stopping being true.
- **(b) Remove them.** Cleaner, and it makes the new property obvious to a
  reader. But it means the migration is the *only* thing standing between a fee
  and a refund query on the day it lands.

⚠️ Under (a) the filters must be re-commented, or the next reader deletes them
as dead weight and quietly re-creates the gap.

### Q2. What happens to fee rows already sitting in `held`?

Production has live fee payments in `held` today.

- **(a) Migrate them to `collected` in the same migration.** *Recommended.* One
  `update … where kind = 'listing_fee' and status = 'held'`. It is the only way
  the property is actually true afterwards — leaving them behind means the new
  guarantee holds for future fees and not for existing ones, which is the worst
  of both.
- **(b) Leave them; only new fees get `collected`.** Avoids touching existing
  money rows, but the filters remain genuinely load-bearing for the old ones
  forever, and nobody will remember which is which.

⚠️ Whichever is chosen, this is the one step that writes to real payment rows.
It should run in its own migration with the row count asserted before and after.

### Q3. Does `collected` need a refund path at all?

The Terms now say plainly that the fee is not refundable — *"not if you cancel,
not if you recover the vehicle another way, and not if nobody ever reports a
sighting"* (2026-09-01).

- **(a) No path. Terminal.** *Recommended.* It matches what we tell users, and a
  refund route that exists "just in case" is a route an accident can take.
- **(b) A hand-run refund for goodwill cases.** Realistic — people will ask —
  but it belongs in the Stripe dashboard, not in our code, precisely so it can
  never happen automatically.

## Risk, stated plainly

This touches the ledger that records whose money is whose, on a live system.

- The migration is one `alter type … add value` plus one `update`. Both are
  simple; the risk is not complexity, it is that the blast radius is money.
- `alter type … add value` **cannot run inside a transaction block** in older
  Postgres and cannot be rolled back once committed. The enum addition and the
  data update therefore want to be two migrations, in that order.
- The SQL suites already cover refunds, payouts and the fee's non-refundability
  (`refund_cancel_verification`, `refund_hold_verification`,
  `credited_notification_verification`). Those are the regression net, and CI
  runs them against a throwaway database on every PR — so this should go through
  a PR rather than a direct push to `main`, unlike most of this week's work.

## Recommended set

**Q1 (a) keep the filters · Q2 (a) migrate existing rows · Q3 (a) terminal.**

The narrowest version that actually buys the property back, changing one enum,
one branch, and one set of existing rows — and leaving every existing guard in
place while it does.

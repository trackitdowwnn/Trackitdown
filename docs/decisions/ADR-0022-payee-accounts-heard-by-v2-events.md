# ADR-0022 — A payee account is heard through v2 events, and checked when a screen asks

**Status:** ACCEPTED · **Date:** 2026-10-14 · Follows ADR-0010 (v2 recipient
payee accounts) · Implemented by PRs #179–#185 (the low-friction payments plan)

## Context

ADR-0010 moved new spotters onto **Accounts v2** recipient accounts made from
tokens. The code that learns "this spotter can now be paid" did not move with
it: `payouts_enabled` was written by the v1 `account.updated` webhook, plus one
check when Payouts opened.

On a device in test mode (2026-10-13/14), a spotter's account was approved
within seconds, and the screen sat on "being checked" until they left and came
back. Research against Stripe's documentation found why:

- v2 accounts announce capability changes with **v2 thin events**
  (`v2.core.account[configuration.recipient].capability_status_updated`,
  `v2.core.account[requirements].updated`), and Stripe's guidance for v2 is
  not to rely on v1 `account.updated`.
- For v2 accounts representing connected accounts, **v2 events use the "Your
  account" scope while v1 events use "Connected accounts"**, even for the same
  account (Stripe, *Use the Accounts v2 API in your existing integration*).
- Thin events carry only an id and a type, and are signed with their own
  destination's secret.

## Decision

1. **`stripe-webhook` accepts v2 thin events** from their own event
   destination ("Your account" scope), verified with `STRIPE_THIN_WEBHOOK_SECRET`
   after the v1 secrets fail. Any v2 account event re-reads the account from
   Stripe and applies it; the event's contents are never trusted, so order
   and duplicates are harmless. Dedup and process-first-record-after are as
   for v1.
2. **One step records and pays.** `_shared/applyPayoutAccountState.ts` writes
   Stripe's answer through `upsert_connected_account` and releases what the
   spotter is owed only on the not-payable → payable edge, and only after the
   write succeeded. The webhook and `sync-payout-account` both use it. An
   account id we never recorded is ignored.
3. **The screen also asks, bounded.** While Payouts says "being checked" it
   calls `sync-payout-account` every 10s, at most 12 times per visit, and again
   when the in-app ID check closes. The webhook is the fast path; the screen
   is the backstop.
4. **Who is waiting on whom is part of the answer.** `readPayoutAccountState`
   reports `needsAction` (a requirement awaiting the user and due now, other
   than the bank and the profile we meet ourselves), and the app says "We need
   one more thing from you" instead of "being checked".
5. **Connected-account v1 events** (`payout.*`, and `account.updated` for
   legacy Express accounts) come from a second v1 endpoint scoped to
   "Connected accounts", verified with `STRIPE_CONNECT_WEBHOOK_SECRET`.

## Consequences

- Three Stripe endpoints, three secrets, one function URL — set up by hand
  (`supabase/functions/README.md` steps 5, 5b, 5c). Any secret left unset
  leaves the behaviour exactly as before it existed.
- `payouts_enabled` now has several writers, all of which read Stripe first;
  none infers it. `payments/README.md` lists them.
- The same pattern was applied to the side that pays: `sync-post-payment`
  checks a post's payment with Stripe when the confirmation screen has waited
  a few seconds, and `_shared/afterCapture.ts` gives a capture recorded by
  either path the same consequences.

## Not chosen

- **Polling alone.** Simple, but it only works while the screen is open; a
  spotter approved overnight would have been paid only when they next looked.
- **Trusting the thin event's payload.** It has none worth trusting — and
  re-reading the account is what makes a reordered or replayed event safe.
- **Global Payouts / third-party payouts** for one-off spotters. Lighter
  onboarding, but the platform would be paying out held owner funds itself;
  that needs UK payments legal advice first.

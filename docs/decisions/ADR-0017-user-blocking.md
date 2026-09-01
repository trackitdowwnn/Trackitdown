# ADR-0017 — User blocking

**Status:** PROPOSED — needs an owner decision on §3 before any code ·
**Date:** 2026-09-01 · Closes the last of ROADMAP's `[~] Flagging … + user
blocking`, and the one item the whole-app review calls a **submission blocker**

## Context

Apple's guideline 1.2 expects an app carrying user-generated content **and**
private messaging to give a user two things: a way to report, and a way to
block. Trackitdown has the first — `flag_post`, `flag_message`, and the `flags`
table behind them — and nothing at all of the second. Zero references to a block
table, RPC or UI exist anywhere in `src/` or `supabase/`.

That is a store rejection, not a nicety. It is also the only Tier 0 item that is
real engineering rather than a domain purchase.

**What makes this harder here than in an ordinary social app** is that the two
parties are not peers exchanging opinions. One has had their car stolen. The
other is claiming, or may later claim, money for finding it. A block is normally
a pure safety primitive with no side effects worth arguing about; here every
plausible design trades safety against either someone's vehicle or someone's
bounty. That tension is the whole of this document.

### Where two accounts actually meet

There are only four places, which is what makes this tractable:

| Surface | Function | Who meets whom |
|---|---|---|
| Opening a thread | `open_thread`, `open_thread_for_sighting` | owner ↔ spotter, gated on a sighting existing |
| Messaging | `send_message`, `get_inbox`, `get_thread_peer` | thread participants |
| Reporting a sighting | `create_sighting` | spotter → owner's post |
| Reading sightings | `get_post_sightings`, `get_public_sighting_entries` | owner reads spotters |

`open_thread` already resolves `v_owner` and `v_spotter` before its gates run
(20260829120000), so a block check has an obvious seam. There is no other path
by which one user reaches another: profiles are not browsable, and the sighting
payload deliberately carries no owner identity.

## Decision — the parts that are not in question

**1. A block is a row, not a state machine.** `public.user_blocks (blocker_id,
blocked_id, created_at)`, primary key on the pair, both FKs cascading on profile
deletion. No status column, no soft delete: unblocking is a `delete`.

**2. Enforcement is server-side, in SECURITY DEFINER functions.** Not RLS —
the relationship is between two rows in `profiles`, and every surface above
already goes through a definer function that knows both parties. A client-side
filter would be theatre; RLS on `threads` would not cover `create_sighting`.

**3. Blocking is not flagging and must not be conflated.** A flag asks us to
look at something. A block asks for nothing and tells us nothing — it is not
evidence, it is not a moderation queue, and it must never be surfaced to the
blocked person, because on a stolen-car app "that person blocked you" is itself
information about who they are.

**4. Symmetric in effect, one-directional in record.** One row means neither
party can reach the other. A block that only stopped inbound contact would let
the blocker keep messaging someone who wanted them gone.

**5. Silent to the blocked party.** No push, no error naming a block. Refusals
reuse the existing single-token pattern — a blocked `open_thread` returns the
same `NOT_PARTICIPANT` a stranger gets, so the endpoint cannot be used as an
oracle for "has this person blocked me". Same reasoning as
`my_dispute_context`'s single refusal token.

## §3 — The three questions that need an owner decision

Each has a defensible answer both ways, and each has consequences that are not
recoverable by a later migration.

### Q1. What happens to an OPEN thread when someone blocks?

The thread only exists because a sighting was filed on a live theft.

- **(a) Freeze read-only** — history stays, nobody can send. *Recommended.*
  The owner keeps whatever the spotter already told them about their car, which
  may be the only lead they have. The blocker gets what they asked for: no
  further contact.
- **(b) Hide from both inboxes** — cleanest "gone" semantics, and the one users
  expect from social apps. But it can delete an active investigation's only
  communication channel because one party got annoyed.
- **(c) Hide for the blocker, keep for the blocked** — asymmetric, and it means
  the blocked person can keep reading a thread the blocker thinks is closed.

⚠️ Note (b) is the only one that also destroys the owner's copy. That is a real
outcome for someone whose car is missing.

### Q2. Does a block hide the blocker's SIGHTINGS from the blocked owner?

- **(a) No — sightings stay visible.** *Recommended.* A sighting is evidence
  about the owner's own vehicle, not a social interaction. Hiding it means an
  owner can lose a lead on their stolen car because the spotter blocked them.
  ⚠️ **And it is not only evidence: `refund_holds.sighting_ids` names specific
  sightings, and `recent_uncredited_sightings` drives whether a refund is held
  at all.** A block that hid sightings would silently change money outcomes —
  the owner could be refunded because a sighting vanished from a query.
- **(b) Yes — hide them.** Stronger privacy for the spotter, and closer to what
  "block" means elsewhere. But it hands either party a lever on the other's
  money, and it would need `refund_holds` and the dispute machinery to be
  re-reasoned from scratch.

### Q3. Can a blocked spotter still report a NEW sighting on that owner's post?

- **(a) Yes, but no thread can open.** *Recommended.* The sighting is public-
  interest information about a stolen vehicle; the contact is what was refused.
  The owner sees the report and simply cannot message that spotter.
- **(b) No — `create_sighting` refuses.** Consistent and simple, but it lets an
  owner block a spotter and thereby remove them from their own case, and lets a
  spotter permanently opt out of helping one owner in a way that looks to them
  like the app is broken.

⚠️ (b) also creates an abuse path worth naming: an owner who wants to suppress
inconvenient sightings — say, ones that contradict a recovery claim they intend
to make — can block the spotters who filed them.

## Recommended set, in one line

**Q1 (a) freeze · Q2 (a) sightings stay · Q3 (a) reporting stays.**

Blocking then means exactly one thing — *no contact between these two accounts*
— and touches nothing that decides money or evidence. It is the narrowest design
that satisfies guideline 1.2, and the narrowest design is the one whose failure
modes we can enumerate.

The cost, stated plainly: **it is weaker than users will expect.** Someone who
blocks an owner will still see that owner's listing in the feed, and their
sighting stays attached to it. If that is unacceptable, the honest fix is a
separate feature (hiding a listing from a feed) rather than overloading block.

## Scope

**In:** the table, `block_user` / `unblock_user` / `list_my_blocks` RPCs, block
checks in the four surfaces above, a block action in the chat thread and on a
sighting, a "Blocked accounts" list in Settings with unblock, an SQL
verification suite, and DOMAIN.md + SECURITY_AND_TRUST.md sections.

**Out:** moderator visibility of blocks (there is no moderator UI at all),
block-on-report as a combined action, and any notion of blocking that reaches
beyond these two accounts.

## Consequences

- Four SECURITY DEFINER functions gain a check. Each is a money-adjacent or
  safety-adjacent path, so each needs its own assertion in the suite.
- `get_inbox` gains a filter, which is the one place a block becomes visible as
  an absence — a frozen thread that stops updating.
- ⚠️ **The refusal tokens must not widen.** Every one of these functions
  currently answers a stranger and a non-participant identically, and blocking
  must not add a distinguishable third answer.
- Unblocking restores contact but does not un-freeze history that was never
  destroyed — which is another argument for Q1 (a).

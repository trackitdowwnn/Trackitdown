# ADR-0017 — User blocking

**Status:** accepted — Q1(a) freeze, Q2(a) sightings stay, Q3(a) reporting stays
(owner decision, 2026-09-01) ·
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

**2. Enforcement is server-side, in BEFORE INSERT triggers on `threads` and
`messages`.** Not RLS (the relationship is between two rows in `profiles`, and
RLS on `threads` would not cover the message path), and — after a false start —
not a check inside `open_thread` and `send_message` either.

⚠️ **That false start is worth recording, because it nearly shipped.** The first
draft added four lines to `send_message`. But `create or replace function`
requires the *whole* body, so adding four lines meant hand-copying two hundred —
and the copy silently dropped the `pg_advisory_xact_lock` guarding the rate
limit, renamed `POST_CLOSED` to `THREAD_CLOSED` (which the client maps), and
returned a different payload shape than `chatApi` parses. None of that is
visible in review, because the diff reads as "a function was replaced".

Triggers state the rule as an invariant instead — *no thread and no message may
exist between blocked accounts* — with three advantages:

- No existing function body is touched, so nothing can be lost in a copy.
- **A future rewrite cannot drop it.** `open_thread` has already been replaced
  twice; an inline check would have to be carried forward by hand each time.
  That is the exact mechanism by which ADR-0014's `kind` filters went missing
  for four days and an hourly cron refunded platform fees.
- `open_thread` and `open_thread_for_sighting` are covered from one place.

It also lands the freeze correctly by accident of `open_thread`'s existing
shape: that function returns an existing thread *before* reaching its insert, so
a blocked pair keeps read access to history and simply cannot create anything
new — which is exactly Q1 (a), and matches the comment already there saying
"returning an existing thread is ungated so history stays reachable".

**3. Blocking is not flagging and must not be conflated.** A flag asks us to
look at something. A block asks for nothing and tells us nothing — it is not
evidence, it is not a moderation queue, and it must never be surfaced to the
blocked person, because on a stolen-car app "that person blocked you" is itself
information about who they are.

**4. Symmetric in effect, one-directional in record.** One row means neither
party can reach the other. A block that only stopped inbound contact would let
the blocker keep messaging someone who wanted them gone.

**5. Never announced, never attributed — but not perfectly concealed, and the
difference matters.** No push, no notification, no error naming a block, and no
endpoint that confirms one on demand: refusals reuse the existing single-token
pattern, so a blocked `open_thread` returns the same `NOT_PARTICIPANT` a
stranger gets (the `my_dispute_context` reasoning).

⚠️ **An earlier draft of this ADR claimed the blocked party "cannot tell a block
from the other person simply having stopped replying". That is false, and it was
worth catching before it became a promise.** The freeze disables their composer,
and a disabled composer is not silence — anyone who tries to reply can see that
something changed. The guarantee is narrower and should be stated as what it is:

- We never **announce** a block. Nothing pushes, nothing appears in a feed.
- We never **attribute** one. `get_thread_peer` returns a bare boolean; it does
  not say who blocked whom, so neither party learns it from us. A frozen thread
  is equally consistent with either side having blocked.
- We never **confirm** one to a probe. Every refusal is the token a stranger
  gets, so blocking cannot be tested for against an arbitrary account.

What we cannot do is hide from someone that *a* block exists between them and a
specific person they already know. The alternative — leaving the composer live
and failing the send — is worse on both counts: it reveals the same thing a
moment later, and it does so by wasting the message they just typed.

## §3 — The three questions, and how they were decided

**Decided 2026-09-01: the recommended set — (a), (a), (a).** The alternatives are
kept below because each was live, and because the reasoning for refusing them is
the reasoning that keeps blocking narrow.

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

# ADR-0019 — The abandoned post: ask, don't expire

**Status:** PROPOSED · **Date:** 2026-09-02 · Closes the whole-app review's
finding #14 and the older of the two holes in the 2026-08-05 loop trace

## Context

The loop trace found two places where the loop does not close. One was fixed the
next day. This is the other, and it has sat open for four weeks:

> **THE ABANDONED POST.** Nothing in the system requires an owner to ever
> finish. A post sits `active` indefinitely (nothing sets `expired`), escrow
> sits `held` indefinitely, and a spotter who filed a real sighting has no
> recourse — because `create_refund_hold`, and therefore the whole dispute
> mechanism, is only ever called by `deactivate-post` and `refund-recovery`,
> which are both OWNER-INITIATED closures. An owner who recovers their car
> off-platform and never opens the app again strands a spotter's effort and
> real money, permanently and quietly.

Three things are true at once and they pull against each other:

1. **No cron may move strangers' money on a timer.** Passive expiry was cut
   deliberately and that decision stands (`DOMAIN.md:654`: *"There is still no
   passive expiry: nothing refunds by waiting. Every refund is a human act."*).
2. **Cutting every liveness mechanism was not the same decision**, and the
   roadmap says so directly. Nothing asks the owner anything, ever.
3. **The post shows an `expires_at` that will never happen.** `create_post`
   stamps +90 days and `get_post_detail` surfaces it (review finding #18). The
   app currently tells the owner a date on which nothing occurs.

## The proposal

**Ask the owner. Do not expire the post, and do not move any money.**

A post that has been `active` and unconfirmed for 14 days earns one question:

> **Is your Blue Ford Fiesta still missing?**
> *Still missing* · *I've found it*

- **Still missing** → resets the clock. Nothing else happens.
- **I've found it** → the existing recovery flow, unchanged. Still a human act,
  still the owner's, still the only thing that moves escrow.
- **Silence** → we ask again in 7 days, up to three times, then stop asking.

That is the whole of phase 1. One push kind, one sender in the sweep that
already runs hourly, one owner RPC, and — the part the review taught us — **an
in-app door, not just a push.**

### The door is not optional

Finding #15 was `/sighting-dispute` being reachable only by push: a spotter who
declined notifications could never contest a denial. Repeating that here would
be worse, because the audience is *by definition* the person who has stopped
opening the app.

So the ask lands in three places, and the push is the least of them:

| Surface | What it shows |
|---|---|
| Push (`still_missing`) | the question, tapping through to the post |
| Post detail, owner view | a banner with both buttons, while an ask is open |
| My posts | a `NudgeRow` above the list, tapping through to the post |

The banner is the source of truth; the push is a reminder that it exists.

> **Amended during the build.** This table first said *"the same two buttons on
> the My posts row"*. The row is the shared `VehicleCard`, so buttons there
> would have rippled into the feed, the watchlist and search — the design
> system's rule about shared components, applied to the one place it would have
> cost most. A `NudgeRow` above the list is the same door: the owner who has
> drifted away opens My posts, not a listing they have stopped thinking about.

## What this deliberately does NOT do

- **It does not refund.** Not after one silence, not after three.
- **It does not close, expire, or hide the post.** See "dormancy", below.
- **It does not give the spotter a lever.** Their sighting stands, their chat
  stays open, and the money stays escrowed. This is honest about what phase 1
  buys them: *fewer* abandoned posts, not recourse on the ones that remain.
- **It does not touch `post_status`.** Nothing forks, nothing is audited.

## Dormancy: analysed now, deferred on purpose

The roadmap's "only after repeated silence should anything close the post, and
even then closing it to new sightings is safer than refunding it" is the natural
phase 2. Recording the analysis here so it is not re-litigated from scratch:

**Option A — a new `post_status` value, `dormant`.** 95 sites in the migrations
select `status = 'active'`, so feed, search, alerts and matching would exclude a
dormant post **by construction, the moment the value exists.** That is the
property ADR-0018 was written to buy back for money, and it is the right instinct
here too. The cost is an audit of every one of those 95, because a handful mean
*"this case is live"* rather than *"this post is publicly listed"* — and they
break in the wrong direction:

- `send_message` raises `POST_CLOSED` on any non-active post, so dormancy would
  **freeze the chat** — severing the last channel to precisely the owner we are
  trying to reach.
- `plate_available` treats `active | pending_verification | recovery_claimed` as
  "taken", so a dormant post would **release the plate** of a car that is still
  missing.

**Option B — a `dormant_at` column and a predicate.** Cheap to write and wrong
in the way this codebase has already been burned: separation by predicate is
exactly finding #13's disease, and here it would be 95 places that each have to
remember, rather than five.

**The decision: neither, yet.** Phase 1 is what the roadmap actually calls the
cheap fix — *"one push kind and one sender"*. Dormancy is worth building when we
know how many owners go silent through all three asks, and as of 2026-08-30 we
can finally measure that: the telemetry sink is registered, so
`still_missing_asked` / `still_missing_confirmed` are answerable questions
instead of guesses. Building the 95-site audit before that number exists is
building for a population we have never counted.

If phase 2 happens, it is **Option A**, with the chat and plate-availability
sites explicitly widened to include `dormant`.

## `expires_at` (finding #18)

This ADR makes the 90-day stamp's dishonesty worse by contrast: the owner would
now get a real question on a real schedule, next to a date on which nothing has
ever happened. Two ways out, and this ADR does not pick one — it only refuses to
add a second false clock beside the first:

- stop surfacing `expires_at` until something acts on it, or
- let the liveness check own the concept and drop the column's UI entirely.

Either is a small change and both belong with #18, not here.

## Risk, stated plainly

- **We will push at people whose car is still missing.** Every 14 days, up to
  three times, on the worst subject in their life. The copy must carry that: no
  cheerfulness, no "just checking in!", and one tap to answer either way. Three
  asks is a cap, not a target — after the third we stop, permanently, and the
  banner stays as the quiet door.
- **The 14/7/3 numbers are a judgement, not a finding.** Nothing in the data
  supports them yet, which is the same reason dormancy is deferred. They live in
  one SQL constant block so a beta can move them without a schema change.
- **A confirmed post is not a verified one.** "Still missing" means the owner
  tapped a button, nothing more. It must not be shown to spotters as freshness
  or proof — it is an internal clock, and it stays internal.
- **The sweep gains a fourth non-money job.** `sweep_runs` already exists to
  make its silence audible (2026-09-02), and this adds its counter to the same
  summary — but the sweep is now load-bearing for four things and still has no
  alerting. That is review finding #10 and it stays open.

## Recommended set

1. Migration: `still_missing_asked_at`, `still_missing_confirmed_at`,
   `still_missing_ask_count` on `posts`; `claim_still_missing_checks()`
   (service-role, one-shot conditional-update claim, returns the audience);
   `confirm_still_missing(p_post_id)` (owner RPC, resets the clock).
2. `release-held-refunds`: one phase, best-effort, counted into the summary.
3. Push kind `still_missing` — kinds, payload, route, preference, centre-row.
4. The door: owner banner on post detail, a nudge above the My posts list.
5. A verification suite, wired into `test-db.sh` — *"a suite that is not in
   `test-db.sh` is not a test"* (ROADMAP, 2026-08-06, the day that lesson cost a
   double-push).

Not in the set: dormancy, any refund path, any `post_status` change, `expires_at`.

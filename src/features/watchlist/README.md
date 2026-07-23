# watchlist

Save stolen-car posts to keep an eye out for them — Airbnb-wishlist
mechanics translated to vigilance. One private list per user.

**Actor:** any signed-in user; for guests the toggle is a gated action
(`watch_post` context) whose intent continuation completes the watch after
login — a prime conversion moment, logged distinctly.

## The toggle

`WatchToggle` (feature component) — a Bookmark that fills with the Airbnb
pop (springBouncy scale + fill, light haptic, reduced-motion → plain swap).
Rendered in:

- `VehicleCard`'s reserved top-right photo slot (feed / compact / map
  variants — the map peek card inherits it via card reuse),
- Post detail's AppHeader, beside share.

Optimistic insert/delete: add → Toast "Added to your watchlist" with a
View action; remove → quiet; failure → revert + error Toast.

## The screen

A tab ("Watchlist", Bookmark icon, between Explore and Inbox — AppTabBar is
config-driven; My cars left the bar for a Profile push on 2026-07-23). Standard `VehicleCard` feed, most-recently-
watched first; removal is the toggle itself (no swipe convention exists in
the app). Resolved posts sit under a quiet **"No longer active"** section
with their StatusBadge for **30 days after the transition** — aligned with
DOMAIN.md's recovered-visibility window — then auto-drop. Expired/cancelled
posts (RLS-invisible to watchers) appear as **tombstones** via the RPC:
make/model/colour/status/date only. Watching a car and never learning it
was found is the failure mode this section exists to prevent.

Empty state: "Cars you're keeping an eye out for live here — tap the
bookmark on any post" + a button to Explore.

## Data & server

- `watchlist_items (user_id, post_id, created_at, pk(user_id, post_id))`;
  RLS own-rows-only, deny anon. Toggle = plain insert/delete (a watch is
  private user preference, not domain state — no RPC ceremony).
- `get_my_watchlist()` security-definer RPC: one round-trip, applies the
  visibility/tombstone/30-day rules server-side (the approved DOMAIN
  carve-out).
- SAFETY: a watch is the watcher's business — no owner-facing payload ever
  includes watcher rows, counts, or existence (absence-tested).

## Notifications (v1-thin)

In-app only: the "No longer active" section IS the recovered payoff. The
push ("Good news — the <colour> <make> you were watching was recovered")
is deferred to the notifications feature (no push infra exists yet — see
ROADMAP); its payload rule is recorded now: never includes watcher counts
or other watchers' existence. Sighting-activity pushes for watchers: out
(noise risk, ROADMAP note).

## Logging

`[watchlist]`: `watch_toggle { postId, watched, source: feed|detail|map }`,
`watch_gate_conversion`, `watchlist_view { count }`.

## Out of scope (v1)

Named/multiple/shared/collaborative lists, watch counts anywhere,
owner-visible watchers, sighting-activity pushes, push notifications,
swipe-to-remove.

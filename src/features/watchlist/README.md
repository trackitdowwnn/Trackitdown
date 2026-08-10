# watchlist

Save stolen-car posts to keep an eye out for them — Airbnb-wishlist
mechanics translated to vigilance, now including the wishlists themselves:
private, user-named **collections** so a spotter can file cars by where
they'd actually see them ("My commute", "Near work").

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

Optimistic insert/delete: add → Toast (`Saved to <list>`, or "Added to your
watchlist" when the target list's name isn't known) with a **Change** action;
remove → Toast (`Removed from your watchlist`) with an **Undo** action;
failure → revert + error Toast.

Undo re-adds through the same toggle, so it inherits the optimistic flip, the
per-post op chain and the failure revert. It declines to act if the post is
already watched again, so it can only ever restore, never re-remove. **Known
gap:** it re-files into the most-recently-used list rather than the one the
post was removed from — the client tracks watched *ids* only, so restoring the
original list needs `removeWatch` to report where it removed from.

**The heart never asks first.** It saves, then offers to change where. Making
the user choose a list before the save would put a decision in front of the
one interaction that has to be instant.

## Collections

- A saved post is in **at most one** collection. This is a filing system, not
  tags — which is also what keeps the change cheap: `collection_id` is an
  attribute, so the `(user_id, post_id)` primary key, the `watchedStore`
  (`Set<postId>`) and one-tap removal are all untouched.
- **"Saved"** is the implicit bucket: `collection_id IS NULL`, synthesised
  client-side, with no row anywhere. It cannot be renamed or deleted. Every
  watch made before collections existed is already null, which is why there
  was **no backfill** — on first launch everyone sees one tile holding
  everything they had. It hides only once it is empty *and* a named list
  exists.
- **Target list** (`lib/mruCollection.ts`): the next save goes to the list the
  user most recently filed into — read synchronously at tap time, persisted
  per user, re-derived for free from the newest watch on every load. Anything
  unexpected (unreadable storage, another user's value, a deleted list)
  resolves to Saved. **A save is never blocked by a filing problem:** if the
  target list is gone, `addWatch` retries once into Saved and reports where it
  actually landed.
- Cap **20** lists, names 1–40 chars, unique per user case-insensitively.
- **Deleting a list never deletes the cars in it** — the composite FK's
  `ON DELETE SET NULL (collection_id)` returns them to Saved, and the confirm
  copy says exactly that.

## Screens

- **CollectionsGridScreen** — the Watchlist tab: a two-column grid of tiles
  (cover, name, count). Counts and covers come from the same entries the tile
  opens onto, so a tile can't promise 12 and show 9. A names-only failure does
  **not** error the screen; the watchlist still renders.
- **CollectionScreen** (`/collection/[collectionId]`, `saved` for the implicit
  bucket) — one list: standard `VehicleCard` feed, most-recently-watched
  first; removal is the toggle itself (no swipe convention exists in the app).
  Named lists carry a ⋯ menu for Rename / Delete. Each card also has a quiet
  **Move** action — the toast's Change auto-dismisses, so without a permanent
  affordance a mis-filed car would be stranded. Move is deliberately absent
  from the feed, map and rails, where the card's one overlay slot is the
  bookmark.
- **CollectionPickerSheet** — mounted once at the app root (the toast outlives
  the card that raised it). Rows for Saved and each list with a check on the
  current one, plus "New list" which swaps the sheet body in place rather than
  stacking a second sheet. It opens on top of a completed save, so dismissing
  it is always a fine outcome.

Resolved posts sit under a quiet **"No longer active"** section with their
StatusBadge for **30 days after the transition** — aligned with DOMAIN.md's
recovered-visibility window — then auto-drop. Expired/cancelled posts
(RLS-invisible to watchers) appear as **tombstones** via the RPC:
make/model/colour/status/date only. A closed car keeps its `collection_id`, so
it stays in its own list rather than jumping back to Saved. Watching a car and
never learning it was found is the failure mode this section exists to prevent.

Empty state: "Cars you're keeping an eye out for live here — tap the
bookmark on any post" + a button to Explore. A brand-new account sees that,
not a grid of one empty tile.

## Data & server

- `watchlist_items (user_id, post_id, collection_id, created_at,
  pk(user_id, post_id))`; RLS own-rows-only, deny anon. Toggle = plain
  insert/delete (a watch is private user preference, not domain state — no RPC
  ceremony).
- `watchlist_collections (id, user_id, name, …, unique (user_id, id))`, with a
  **composite FK** `(user_id, collection_id)` so "a watch may only point at a
  list its own user owns" is declarative, not just policy. Reads are RLS-
  scoped; writes are RPC-only (`create_` / `rename_` / `delete_`), mirroring
  the garage.
- Moving a car is an `UPDATE`, never delete-then-insert: re-inserting is
  blocked once a post has closed, so the naive version would silently destroy
  the save on exactly the closed posts the tombstone section exists to
  preserve. The UPDATE grant is **column-limited to `collection_id`** — without
  that, `set post_id = <a draft I can't see>` would be a complete
  see-before-act bypass (asserted by CHECK 11).
- `get_my_watchlist()` security-definer RPC: one round-trip, applies the
  visibility/tombstone/30-day rules server-side (the approved DOMAIN
  carve-out). Collections are grouped from that single payload — no second
  round trip, and no second copy of the visibility rules to drift.
- SAFETY: a watch is the watcher's business — no owner-facing payload ever
  includes watcher rows, counts, or existence (absence-tested). Collections
  extend this: no surface exposes a list, its name, its contents or its
  existence to anyone but its owner.

## Notifications (v1-thin)

In-app only: the "No longer active" section IS the recovered payoff. The
push ("Good news — the <colour> <make> you were watching was recovered")
is deferred to the notifications feature (no push infra exists yet — see
ROADMAP); its payload rule is recorded now: never includes watcher counts
or other watchers' existence. Sighting-activity pushes for watchers: out
(noise risk, ROADMAP note).

## Logging

`[watchlist]`: `watch_toggle { postId, watched, source: feed|detail|map }`,
`watch_gate_conversion`, `collection_view { collectionId, count }`,
`collections_view`, `collection_create|rename|delete { collectionId }`,
`watch_move { postId, toId }`, `watch_collection_fallback { postId }`.
**Ids only — a list name is private free text and is never logged.**

## Out of scope

**Sharing and collaborators — permanently.** DOMAIN.md forbids exposing
watcher rows, counts or existence, and `watchlist_verification.sql` CHECK 8
asserts that absence; a shared wishlist would reverse it.

Also out: watch counts anywhere, owner-visible watchers, sighting-activity
pushes, push notifications, swipe-to-remove, more than one collection per post.

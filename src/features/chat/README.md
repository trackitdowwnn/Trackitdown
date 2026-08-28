# Chat — owner ↔ spotter messaging

**Actor:** both signed-in roles. **One sentence:** the sighting-gated
conversation between a post's owner and a spotter who reported on it —
opened from a sighting (never a cold DM), carried over Supabase Realtime,
living in the Inbox tab.

## The gating rule (server-enforced, // SAFETY)

A thread exists ONLY between a post's owner and a spotter with ≥1 sighting
on that post (DOMAIN.md Chat). ONE thread per (post, spotter) pair.
`open_thread` (SECURITY DEFINER) is the only creation path: it validates
the sighting relationship, is idempotent (returns the existing thread),
and atomically inserts the SYSTEM FIRST MESSAGE. RLS: threads and messages
readable/writable by the two participants ONLY — absence tests cover a
third signed-in user AND anon. There is no compose flow anywhere.

## Entry points (both parties)

- **Owner:** "Message ‹first name›" on a sighting row (PostSightingsScreen).
- **Spotter:** "Message the owner" on the report-success screen (and the
  future sighting-history screen).
- **Inbox tab:** existing threads only.
Both routes call the same `open_thread` and land in `/chat/[threadId]`.

## Screens

1. **InboxScreen** (fills the Inbox tab's member state; guest state exists)
   — Filter chips (ChoiceChips): All · Unread (live count) · My cars ·
   My sightings — Airbnb's category filters as our owner-side/spotter-side
   split, filtered CLIENT-side over the loaded payload (inboxModel; a chip
   never costs a round trip). Per-filter empty copy (an empty Unread is
   good news and reads like it); a truly EMPTY inbox keeps the plain
   invitation with no chips.
   — FlashList of Airbnb-style rows, GROUPED BY DAY (2026-08-28) under the
   same calendar labels the Notifications face uses, so one tab does not
   speak two vocabularies for "when".
   — The row leads with the CAR'S COVER PHOTO at 64pt (`sizes.inboxRowTile`),
   falling back to a `CarColourTile` in the car's own paint when the post has
   no photo. The POST's public photo, never anything of the other person's —
   the peer avatar is withheld by the API on purpose. Then first name +
   relative time, the one-line preview, and the context line ("About your
   Blue BMW · ‹PlateChip›" for owners / "Your sighting · Blue BMW" for
   spotters). Trailing: `UnreadBadge` — a dot at one unread, a count above,
   an empty reserved slot when read so the text column never changes width.
   Unread also bolds the name (family swap, so the row height cannot jump).
   — ⚠️ Until 2026-08-28 the row led with an initial-letter Avatar wearing the
   car as a 24pt corner badge. The photo took the leading slot because you
   cannot recognise a car at 24pt, which was the badge's whole job. See
   docs/design-refs/inbox/GAP_ANALYSIS.md.
   — Sorted by last activity, which the day grouping now DEPENDS on: a header
   opens only when the label changes, so out-of-order rows would repeat a day.
   Skeleton rows while loading, generated from the real row's own styles.
   No swipe actions — no swipe convention exists in the app, and the inbox
   doesn't introduce one (Airbnb's swipe-to-archive has nothing to archive
   into here: a thread closes with its post).

2. **ChatThreadScreen** (`/chat/[threadId]`, outside tabs)
   — Header: Avatar + first name. For the OWNER the name is tappable →
   PublicProfileSheet (the narrow first-name + reputation passport; its
   first wiring); for a SPOTTER it is plain text — owner identity is never
   exposed (DOMAIN.md). The data comes from the `get_thread_peer` RPC,
   which keeps the peer's uid SERVER-side (a uid in app code pivots via
   the permissive profiles select to display_name/avatar_path — security
   review H1); the sheet returns no avatar for the same reason. Only the
   sheet COMPONENT is deferred-imported, to avoid closing a require cycle
   (chat → profile → garage → vehicles → chat; same precedent as
   PostSightingsScreen).
   — Tappable post-context strip (thumbnail, make/model, shared
   StatusBadge for closed states / "Still missing" for active, an
   underlined View cue) → post detail.
   — Messages: bottom-start FlashList; our bubbles right (primary),
   theirs left (surfaceSubtle); GROUPED corners within a same-sender run
   (messageGroups.groupPos — runs break on sender change, day, time
   caption, system message); day separators + timestamps on >15-min gaps;
   system messages centred and quiet (never a fake bubble). New arrivals
   and optimistic sends fade in (motion.fast, ReduceMotion.System);
   confirmed sends replace their optimistic bubble WITHOUT animating (a
   double pop reads as a double send).
   — **Seen** (thread-level read receipt): one quiet "Seen" under the
   newest of MY messages the peer's marker covers
   (messageGroups.latestSeenOutboundId over useThreadPeer). Mutual,
   always on, no toggle (v1 call, 2026-07-28). Point-in-time by design:
   the marker means "last had the thread open", refreshed on focus, and
   the caption claims no more ("Seen", never "Seen at 14:32"). No new
   writes, no migration — the markers were always on the thread row.
   — **Quick replies** (lib/quickReplies): role-aware one-tap openers in a
   horizontal row above the composer, shown only while the input is EMPTY.
   Picking one FILLS the draft, editable — never auto-sent. Static curated
   sets; the // SAFETY register (no meeting/following/waiting/watching/
   approaching, however softly) is pinned by a lexicon test.
   — Input: multiline TextField + send button (enabled on content),
   keyboard-aware.
   — Long-press a message → "Report this message" → flags table.
   — **Closed-post lifecycle (DOMAIN):** when the post leaves 'active', a
   quiet banner states it ("This car was recovered — this conversation is
   now closed." / "This post has closed…") and the input + quick replies
   are removed. The server is the real gate: `send_message` raises
   POST_CLOSED.

## Data (migration `*_chat.sql`)

- **threads**: post_id, owner_id + spotter_id (the two fixed participants —
  two last-read columns beat a participants table), UNIQUE
  (post_id, spotter_id), last_message_at + last_message_preview
  (denormalised by send_message for cheap inbox rows),
  owner_last_read_at / spotter_last_read_at.
- **messages**: thread_id, sender_id (NULL for system), kind
  'system'|'user', content ≤2000, created_at. In the `supabase_realtime`
  publication; the SELECT RLS scopes the stream to participants.
- **flags** (minimal generic — moderation builds its queue on it later):
  reporter_id, target_type ('message' now; 'post'/'sighting'/'photo'
  reserved), target_id, bounded reason, UNIQUE per (reporter, target).
  Insert via RPC only; clients never read flags.
- **RPCs (SECURITY DEFINER, house error-token style):** `open_thread`
  (gating + idempotence + system first message), `send_message`
  (participant-pinned, POST_CLOSED after close, updates preview),
  `mark_thread_read`, `get_inbox` (rows + unread counts + the other
  party as first name/avatar ONLY), `flag_message` (participant-only,
  re-flag returns the existing flag).

## Realtime & sending

- Per-open-thread `postgres_changes` INSERT subscription on that thread's
  messages, subscribed on screen focus, removed on blur (no leaked
  channels).
- Sending is optimistic: pending bubble → confirmed on RPC success;
  failure marks the bubble with retry and NEVER drops the text.
- **Inbox updates: refetch-on-focus + pull-to-refresh (v1), not realtime.**
  v1 scale is a handful of threads; a global per-user channel is a
  leaked-subscription risk for marginal freshness gain, and the badge
  refreshes on every focus anyway. Revisit with the notifications feature.

## Unread & notifications

- Unread = messages newer than my last_read_at, not sent by me; per-thread
  counts from `get_inbox`; the sum drives the Inbox tab badge via the
  existing TabBadgeProvider.
- ⚠️ **The route no longer re-reads the hidden half** (2026-08-28). The inbox
  keeps BOTH faces mounted, so `useInbox` and `useNotificationCenter` each
  report their own half to `inboxBadge` and the aggregator sums them. The
  cost of that is two full RPCs per inbox focus instead of one plus a cheap
  count — acceptable at v1 scale, and worth revisiting with the feed.
- **notify-message push: SHIPPED** (2026-07-30). This section read "HONEST
  STUB — no push infra exists" until 2026-08-03, three days after it was
  built; a doc that says a shipped thing is missing costs more than one that
  says nothing. `supabase/functions/notify-message/` is deployed and invoked
  from `chatApi.ts:215` via `notifications/api/notifyApi.ts:55`. The specced
  contract held: payload = sender first name + post context ("New message
  about your Blue BMW"), and message content NEVER transits push
  (third-party infra; SECURITY_AND_TRUST §3 / LOGGING.md). Deep route
  `/chat/[threadId]` is live and gate-aware.
  - **Known weakness, not a stub:** the invoke is CLIENT-side and
    fire-and-forget, so an app killed in the window between `send_message`
    and the invoke notifies nobody. The message itself is never lost — it is
    in the thread. `notifyApi.ts:18` names the fix (a `pg_net` DB trigger);
    it is not built.

## Privacy & logging

`[chat]` tag: thread_opened, message_sent / message_send_failed (ids and
lengths only), thread_read, message_flagged. Message CONTENT never appears
in logs, breadcrumbs, or analytics. Participant exposure: first name +
avatar + reputation (existing boundary; never surname/email).

## Rules applied

DOMAIN Chat (sighting-gated, system safety first message, no cold DMs,
read-only after post close) · SECURITY_AND_TRUST §6 (deny-by-default RLS,
absence tests) + §3 (no content in push/logs).

## Out of scope

Photo/media messages, typing indicators, per-message read receipts (the
thread-level "Seen" above ships; per-message ticks would need per-message
writes the realtime model doesn't carry), message reactions (ROADMAP —
costed there: new table + RPC + RLS + a second realtime stream),
edit/delete, user blocking (Phase 4 — the flag action ships now), group
threads, in-chat bounty negotiation, inbox realtime, pagination beyond
latest-100 + load-older, swipe actions (no app-wide swipe convention).

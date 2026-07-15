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
   — FlashList of Airbnb-style rows: Avatar, first name, context line
   ("About your Blue BMW · ‹PlateChip›" for owners / "Your sighting ·
   Blue BMW" for spotters), one-line last-message preview, relative time,
   unread dot + bold title. Sorted by last activity. Skeleton rows while
   loading; EmptyState copy: "Conversations open when a spotter reports a
   sighting on your car — or when you report one."

2. **ChatThreadScreen** (`/chat/[threadId]`, outside tabs)
   — Header: Avatar + first name; tappable post-context strip (thumbnail,
   make/model, status) → post detail.
   — Messages: inverted FlashList; our bubbles right (primary-tinted
   surface), theirs left (surfaceSubtle); day separators + timestamps on
   >15-min gaps; system messages centred and quiet (never a fake bubble).
   — Input: multiline TextField + send button (enabled on content),
   keyboard-aware.
   — Long-press a message → "Report this message" → flags table.
   — **Closed-post lifecycle (DOMAIN):** when the post leaves 'active', a
   quiet banner states it ("This car was recovered — this conversation is
   now closed." / "This post has closed…") and the input is removed. The
   server is the real gate: `send_message` raises POST_CLOSED.

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
- **notify-message push: HONEST STUB** — no push infra exists (no
  expo-notifications, no token storage, no deployed Edge Functions; same
  posture as notify-owner-of-sighting). Contract specced now: payload =
  sender first name + post context ("New message about your Blue BMW") —
  message content NEVER transits push (third-party infra;
  SECURITY_AND_TRUST §3 / LOGGING.md). Deep route `/chat/[threadId]` is
  live and gate-aware for when it ships.

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

Photo/media messages, typing indicators, read receipts, edit/delete,
user blocking (Phase 4 — the flag action ships now), group threads,
in-chat bounty negotiation, inbox realtime, pagination beyond
latest-100 + load-older.

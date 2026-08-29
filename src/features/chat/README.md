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
   — Header: first name + the car (see the ⚠️ merge note below). For the
   OWNER a profile button opens the PublicProfileSheet (the narrow
   first-name + reputation passport); for a SPOTTER **the button is not
   rendered at all** — owner identity is never exposed (DOMAIN.md), and
   before 2026-08-29 the two sides showed a visually identical block that
   simply did nothing on one of them. The server is the enforcement either
   way: `get_thread_peer` returns `peer: null` unless the caller owns the
   post. The data comes from that RPC,
   which keeps the peer's uid SERVER-side (a uid in app code pivots via
   the permissive profiles select to display_name/avatar_path — security
   review H1); the sheet returns no avatar for the same reason. Only the
   sheet COMPONENT is deferred-imported, to avoid closing a require cycle
   (chat → profile → garage → vehicles → chat; same precedent as
   PostSightingsScreen).
   — ⚠️ **ONE HEADER ROW SINCE 2026-08-29** (`ThreadHeader`). The person
   header and the post-context strip were two rows of identity for one
   conversation, on a screen measured at 46% chrome with fewer than four
   bubbles visible once the keyboard was up. Now: back · the car's photo
   (44pt, `CarColourTile` when the post has none) · their first name ·
   "Blue BMW 3 Series · Still missing" · an owner-only profile button.
   The photo taps through to the post; the button opens the passport.
   The peer's ROLE WORD is no longer drawn — it lives in the
   accessibility label, being derivable (an owner only ever talks to
   spotters) where "Still missing" is not. 393.5pt of chrome → 249.5.
   See docs/design-refs/chat/GAP_ANALYSIS.md for the arithmetic.
   — Messages: bottom-start FlashList; our bubbles right (primary),
   theirs left (`surface` + a hairline — at `surfaceSubtle` an incoming
   bubble was 1.06:1 against the page and had no boundary at all);
   GROUPED corners within a same-sender run, and since 2026-08-29 the
   SPACING groups too (`blockPaddingTop`: 4 within a run, 12 between, 0
   under a separator — before that every bubble was 8pt from its
   neighbour whatever the grouping said, so the corners tightened and
   nothing drew closer);
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
   horizontal row above the composer, shown while the input is EMPTY **and
   before you have sent anything in this thread** (`shouldShowQuickReplies`,
   2026-08-29). An empty draft IS the resting state, so the row used to be
   permanent chrome — 52pt spent forever on four canned phrases. The file's
   own charter names the moment they are for ("first-reply-first"), and once
   you have spoken you have found your words. ⚠️ The predicate checks
   `kind === 'user'`, because threads opened before 2026-08-29 START with a
   SYSTEM safety message and counting it would hide the row for ever on every
   one of them. (New threads open empty, so the check protects history rather
   than the present — which is exactly when a check is easiest to delete by
   mistake.) Picking one FILLS the draft,
   editable — never auto-sent. Static curated sets; the // SAFETY register (no
   meeting/following/waiting/watching/approaching, however softly) is pinned by
   a lexicon test.
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

DOMAIN Chat (sighting-gated, no cold DMs, read-only after post close) ·
SECURITY_AND_TRUST **§1** — ⚠️ **amended 2026-08-29**: the SafetyNotice and
the automatic "Safety first…" system message were both removed from chat by
owner decision, and §1 was rewritten to match rather than left contradicting
the code. Threads opened before that date keep their stored system message;
nothing was deleted. The notice remains on the five non-chat surfaces, and
the quick-reply safety register is untouched · §6 (deny-by-default RLS,
absence tests) + §3 (no content in push/logs).

## Out of scope

Photo/media messages, typing indicators, per-message read receipts (the
thread-level "Seen" above ships; per-message ticks would need per-message
writes the realtime model doesn't carry), message reactions (ROADMAP —
costed there: new table + RPC + RLS + a second realtime stream),
edit/delete, user blocking (Phase 4 — the flag action ships now), group
threads, in-chat bounty negotiation, inbox realtime, pagination beyond
latest-100 + load-older, swipe actions (no app-wide swipe convention).

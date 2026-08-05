# ADR-0012 — The notification center and the persist-then-push rule

**Status:** accepted · **Date:** 2026-08-06 · Extends the notifications
feature (README there); the Inbox tab becomes two-faced (Messages |
Notifications)

## Context

Every push was fire-and-forget: a missed banner was gone forever, and the
~40% of users who deny push permission received NOTHING — including "you've
earned £190". Meanwhile eight notification kinds existed with no in-app
surface, one kind (`recovery`) had shipped payload/route/tests but NO sender
for a month, and the transfer that actually pays a spotter went out silently.

## Decision

1. **THE RULE (now in DOMAIN.md): persist first, then maybe push.** One
   utility — `notifyUsers()` in `_shared/push.ts` — writes a `notifications`
   row per recipient and then delegates to the push sender. The row is the
   durable half, the push the best-effort half, and each fails alone (an
   insert failure still pushes; a push failure still persists). Every sender
   except chat goes through it.
2. **Chat is the one exclusion.** The Messages segment IS chat's persistent
   surface; duplicating threads into the feed is noise. The considered
   "message row only when push is disabled" exception was rejected: it needs
   server-side knowledge of device permission state to build a duplicate of
   something one tap away.
   One honest edge (security review, on the record): the alert path's
   3-per-24h volume cap removes capped users BEFORE `notifyUsers` runs, so a
   capped alert produces neither push NOR row. Deliberate: the fourth alert
   of the day is dropped as an event, not merely quietened — a feed that
   fills with rows the cap judged too many defeats the cap.
3. **Rows are self-contained**: title/body denormalised at write time (what
   was true THEN — copy still built in the SQL claims), plus the EXACT typed
   push payload blob. The client renders and routes rows through
   `parsePushPayload` → `pushRouteFor` — the same tested machinery pushes
   use, so a row and its push can never land in different places. A row
   whose payload no longer parses marks read but navigates nowhere.
4. **Two senders were born with the center**: `recovery` (watchers finally
   told, via `claim_recovery_notifications` — audience from watchlist_items
   minus the owner, fired from all three recovery-completion paths) and
   `payout_sent` ("On its way — £X", amount from the RECORDED transfer,
   never recomputed, via `claim_payout_sent_notification` from the release
   core). Verification and post-expiring types from the original brief were
   dropped — those features do not exist (ADR-0007; no expiry mechanism).
5. **Read state is the user's.** Opening the segment never auto-marks-read;
   a tap marks one row; "Mark all as read" is the one bulk affordance; a
   push TAP marks its row by kind+payload match (push data is shared across
   recipients, so no per-user row id rides it). All marking via RPCs —
   clients hold no update grant.
6. **One badge, summed honestly**: an aggregator module
   (`inboxBadge.ts`) holds each feature's half; chat and the center each
   report through it and set the same `inbox` badge. Direction of imports:
   chat → notifications, never the reverse (require-cycle rule).
7. **Freshness = refetch-on-focus + pull-to-refresh** — chat's documented
   inbox trade-off, mirrored. No realtime channel.
8. **Retention 90 days** via pg_cron (`purge-old-notifications`, daily
   03:30): pure SQL, no Edge Function — the ADR-0011 cron infrastructure's
   second tenant. Matches SECURITY_AND_TRUST's existing 90-day posture.
9. **Look**: monochrome palette holds. Icon circles are neutral
   `surfaceSubtle`; the ICON carries meaning in the three semantic hues;
   the two needs-attention kinds (`credited`, `closed_uncredited`) keep a
   warning accent bar while UNREAD — unread-based, not resolution-based,
   because "don't let me miss this" doesn't need a resolution tracker.

## Consequences

- Push-less users become first-class: everything lands in-app.
- The feed makes silent-sender gaps VISIBLE — which is why the recovery
  sender had to ship with it rather than after it.
- `notifications` rows are a per-user activity log (ids + copy, no plates,
  no locations beyond what the copy already said) with a 90-day horizon;
  deletion cascades with the profile.
- Tap-through by kind (`notification_tap {kind}`) finally measures which
  notifications earn their existence, feeding volume-cap tuning.
- Out of scope, deliberately: per-type preferences (v2), inline actions,
  swipe-to-dismiss, email digests, realtime.

## Rejected alternatives

- **Realtime channel for the feed** — a leaked-subscription risk for
  marginal freshness, same call chat made.
- **Reusing `push_sends` as the feed** — it is a service-role rate-limit
  ledger (alert path only), unreadable by clients, with none of the copy.
- **Per-user row ids in push payloads** — would force per-recipient
  messages through the whole send pipeline to save one RPC.

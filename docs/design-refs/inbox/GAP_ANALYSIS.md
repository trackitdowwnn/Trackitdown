# Gap analysis — inbox

WHAT: Every divergence between the inbox tab as it stood on 2026-08-28 and
      ./REFERENCE_SPEC.md, with what was done about each.
WHY:  So the redesign can be checked rather than asserted, and so the things
      deliberately NOT done are recorded as decisions rather than oversights.
LINKS: ./REFERENCE_SPEC.md; src/app/(tabs)/inbox.tsx;
      src/features/chat/screens/InboxScreen.tsx;
      src/features/notifications/screens/NotificationCenterScreen.tsx.

| # | Gap | Ours (before) | Reference | Fix | Size | Impact | Done |
|---|---|---|---|---|---|---|---|
| 1 | The leading slot was spent on a letter | 48pt initial avatar + the car as a 24pt corner badge | The photograph leads, at full size | 64pt `inboxRowTile` car photo leads; person's identity moves to the name | M | **Highest** | ✅ |
| 2 | Rows without a cover photo led with nothing | `coverPhotoUrl` null → no badge at all | Always something to recognise it by | `CarColourTile` fallback — promoted to shared/ui, since chat may not import sightings | M | **High** | ✅ |
| 3 | The two faces had drifted apart | Different list padding (24 vs 8/8), different `centered`, a header row that vanished, mismatched skeletons | One tab reads as one place | One list rhythm, one `centered`, reserved header height, skeletons generated from the real rows | M | **Highest** | ✅ |
| 4 | Switching segments destroyed the other face | Ternary → unmount: scroll lost, refetch, entrance replayed every switch | Tabs hold their state | Both faces mounted, inactive one hidden at `opacity: 0` | M | **Highest** | ✅ |
| 5 | Needs-attention was colour alone | A 3pt warning stripe and nothing else | A LABEL saying what needs doing | Hollow warning ring + words, from a discriminated union so the next kind cannot compile without them | S | **High** | ✅ |
| 6 | The unread count was thrown away | `unreadCount` in the payload, an 8pt dot on screen | A count where there is one | `UnreadBadge`: dot at 1, count above, shared "9+" cap | S | Medium | ✅ |
| 7 | Messages had no time grouping | A flat list; Notifications grouped by day | Time-grouped, quietly labelled | `groupThreadsByDay` + the shared `DayHeader` | M | High | ✅ |
| 8 | ⚠️ Read rows were 20pt wider than unread ones | The dot was a conditional row child, so its 8pt + 12pt gap appeared and vanished | A straight column | `UnreadBadge` always occupies `badgePill` (16) | S | Medium | ✅ |
| 9 | Skeletons promised the wrong layout | 48pt circle vs a 64pt tile; 2 bars vs 3 lines; `gap: sm` vs `xs` | The row's own geometry | `ThreadRowSkeleton` / `NotificationRowSkeleton` share their row's `makeStyles` | M | High | ✅ |
| 10 | Empty and error states were padded to 48/side | Screen `centered` added 24 on top of the primitives' 24 | One gutter | Deleted the screens' padding (not `gutter="none"` — `ErrorState` has no such prop) | S | Medium | ✅ |
| 11 | The mark-all row jumped the list 52pt | Rendered only while `hasUnread` | Stable chrome | Row always renders; only its contents are conditional | S | Medium | ✅ |
| 12 | The conversation header had two left edges | Header 12, `PostContextStrip` 24, inside one surface | One gutter | 24 throughout, with the chevron optically inset | S | Medium | ✅ |
| 13 | A metadata failure rendered a bare header | Only `'missing'` was branched; `'error'` fell through | Every failure is recoverable | A `headerFallback` with "Conversation" + "Try again" | S | High | ✅ |
| 14 | Android's composer sat under the keyboard | `behavior={undefined}`, and SDK 57 edge-to-edge no longer resizes the window | The composer stays visible | `useAndroidKeyboardHeight` minus the safe-area inset | S | **High** | ✅ |

**The three that closed most of the gap: #1, #3, #4.**

## Deliberately not done

| # | Thing | Why not |
|---|---|---|
| A | Swipe-to-archive | **The concept does not exist.** A thread belongs to a post and closes with it; there is nowhere to archive to |
| B | An animated cross-fade between the two faces | `SurfaceTabs` deliberately refuses to animate its own underline ("the loudest thing on a list screen"); a fading list would contradict that, and would briefly show both lists at once |
| C | A shared `InboxRowSkeleton` | It would need a props soup (leading shape, line count, per-line widths, stacked flag) to serve two callers. Generating each from its own row's styles is stronger than sharing a component |
| D | Promoting the keep-alive `<Face>` wrapper | One consumer. ARCHITECTURE prefers feature-local until a second appears |
| E | `AppTabBar` adopting `UnreadBadge` | It has its own absolute anchor and a different a11y story. A follow-up, not a drive-by |
| F | Per-row read receipts | Needs a schema change; we have one thread-level `theirLastReadAt` and one "Seen" |

## Found by the ui-reviewer, after the first build

| # | Finding | Fix |
|---|---|---|
| 15 | **The mark-all fix still jumped, by its own padding.** Yoga measures `minHeight` against the border box, so `minHeight: touchTarget` gave 44 empty and 52 holding the pressable — an 8pt jump when data landed and another when the last unread cleared, and a different list start from the Messages face whenever everything was read | `minHeight: sizes.touchTarget + spacing.sm` (52). The comment's arithmetic had been right; the code never implemented it |
| 16 | **The 64pt notification tile was invisible.** `surfaceSubtle` on `background` is 1.08:1 light and 1.28:1 dark — far under the 3:1 graphic floor. The "tile matching the car photo" drew nothing; a glyph floated in space beside text | `borderWidth: 1` in `borderStrong`, the edge `CarColourTile` already argues for in the same words |
| 17 | **Pressing a row erased its own contents.** `rowPressed` filled with `surfaceSubtle` — the same token as the notification tile's fill AND as PlateChip's fill, so a press flattened the tile to zero contrast and stopped an owner's plate looking like a plate | `surfaceSubtlePressed` on both rows, which is what ChoiceChips and PlateChip already use for this |
| 18 | **The two rows shared a box but not a type ramp.** `label`/`caption` against `body`/`body`, so switching segments changed every text size, notification rows came out 10pt shorter, and the tile — not the text — drove their height, contradicting `inboxRowTile`'s own doc | Notification title → `body`, message → `body` at `textSecondary` |
| 19 | **The needs-attention label truncated at 200%**, which puts the ring back to carrying status alone — straight back to colour-only | Dropped `numberOfLines`; it wraps |
| 20 | **Tokens borrowed out of scope** — the attention ring used `progressDot` (a wizard header) and `timelineDotStroke` (timeline geometry); the thread skeleton used `avatarLg` for a message bubble | Minted `attentionRing`, `attentionRingStroke`, `skeletonBubble` |
| 21 | **The plate was invisible to a screen reader.** The row label was built from the context prefix alone while the chip rendered from `plate` — a sighted owner saw their registration, a VoiceOver user did not | `Plate ${spellPlate(plate)}.` appended to the row label, and pinned in a test |
| 22 | **Row height varied by ROLE**, so no single skeleton could match: owner rows carry a 26pt PlateChip where spotter rows carry an 18pt caption | `contextLine` reserves `PLATE_CHIP_HEIGHT` (exported from PlateChip, derived beside the styles it comes from) whether or not a chip is there |
| 23 | **`UnreadBadge`'s "reserved" slot was a `minWidth`**, so a dot measured 16 and a "9+" pill ~22 — the same ragged column, at a smaller amplitude | Fixed `width: sizes.unreadSlot` |
| 24 | **`CarColourTile` ignored its own new `size` prop when drawing the glyph**, so an inbox tile used the card's 32pt mark (50% of 64 vs 44% of 72), and retuning the card would have silently restyled the inbox | Added `glyphSize`, defaulted to `carTileGlyph`; the inbox passes `inboxRowGlyph` |
| 25 | **`UnreadBadge`'s header contradicted itself** on whether it is accessibility-hidden — a second consumer would have read the wrong half | Rewrote it to state the real contract: every consumer must be an accessible node carrying the count in its own label |

Also corrected: a dead `leadEmpty` style whose comment contradicted the line above it; a comment claiming `flexBasis: 0` where only `flexShrink` was set; and a claim in `MySightingsScreen` that the inbox aligns its day label to row TEXT — both align to the row's outer edge, reached from opposite directions.

## Second pass — the Notifications face gets the photograph too (2026-08-28)

The first pass left the two faces with the same box but different contents: a
conversation row led with the car's photograph, a notification row led with an
icon. That was not a design choice, it was a data limit — `notifications` holds
a title, a body and a payload of ids, and no image at all.

| # | Gap | Fix | Size | Impact |
|---|---|---|---|---|
| 26 | The Notifications face led with an icon where Messages led with a photograph — the two faces still did not look like one list | `image_url` on every feed row: the cover photo of the car the notification is about, in the same 64pt box, with the icon as fallback | L | **Highest** |

⚠️ **THIS ONE NEEDED THE DATABASE, and a client-side join would have failed
exactly where it mattered.** `post_photos` RLS lets a client read a photo only
while the parent post is `active`, or if it owns the post. The notifications
people care about — `credited`, `payout_sent`, `not_credited`, `recovery` —
arrive *after* the post is recovered, with the spotter reading them. Every one
of those rows would have come back pictureless, so the money notifications would
have been the only ones with no photo. Hence `get_notification_feed()`, a
SECURITY DEFINER read (`supabase/migrations/20260828120000_notification_feed_photo.sql`).

⚠️ **The photo is gated more narrowly than the row it sits on.** The feed rows
are scoped exactly as `notifications_select_own` already allowed. `image_url` is
non-null only when the caller owns the post, has a sighting on it, or it is
still active — the first and last are what `post_photos` RLS already permits,
and the middle one is the only widening. It is narrow by construction: a spotter
who reported on a post necessarily saw it while it was public.

⚠️ **A pictureless row is the ORDINARY case, not a failure.** Money kinds have
no car to show, and any post the caller has no standing on returns null. Both
shapes are the same 64pt box, so the list rhythm never changes — only what is
inside it.

## Consequences accepted, not fixed

⚠️ **Every inbox focus now costs two RPCs** instead of one full fetch plus a
cheap count. Both faces are mounted, so both hooks load. Fine at v1 scale
(both lists cap at 100 rows); revisit if the feed grows.

⚠️ **`center_view` changes meaning as of this release.** It used to fire on
mount, which was "the centre was opened"; mounting no longer implies being
looked at, so it now fires on the false→true edge of `active`. Numbers before
and after this date are not comparable. Left on mount it would have fired for
every user who opened the tab and never left Messages, which is worse.

⚠️ **The hidden face spends its entrance animation while invisible.** A
Messages-first user will never see the Notifications list animate in. That is
the flip side of not replaying it on every switch, and the trade was taken
deliberately.

⚠️ **`fetchUnreadNotificationsCount` has no consumers left** now the hidden-half
sync is gone. Kept as API surface rather than deleted, since the RPC still
exists server-side — but it is dead code and should not be assumed live.

⚠️ **`PlateChip`'s `hitSlop` (12) exceeds the row's 16pt vertical padding** once
the chip sits on a wrapped last line, so its touch area reaches within 4pt of
the neighbouring row. Pre-existing, not introduced here, and fixing it means a
per-row `hitSlop` override on a shared component. Flagged for its own look.

## Verify before trusting

1. **Both themes.** The lead tile is `surfaceSubtle` behind a photo; check a
   dark-mode row with no cover photo, where the colour tile's border is the only
   thing making it a tile.
2. **200% font scale**, both faces: the timestamp should drop under the title
   rather than crushing it, and an owner row's plate chip should wrap to its own
   line rather than squeezing the context prefix away.
3. **The Android keyboard**, on gesture nav AND 3-button nav. The
   `- insets.bottom` term is unverifiable in Jest and wrong in either direction
   is immediately visible.
4. **VoiceOver *and* TalkBack** on the inbox tab: the hidden face must be
   unreachable. `accessibilityElementsHidden` is iOS-only and
   `importantForAccessibility` is Android-only, so one missing prop leaves a
   whole invisible list readable on that platform and perfect-looking to a
   sighted reviewer.
5. **Switch segments with a scrolled list** — the position must survive, and
   neither list should re-animate.
6. **All states per face**: loading, error, empty, populated, signed out; plus a
   closed thread and a metadata failure.
7. **A row with a genuinely long preview** on a 375pt device — the photo lead
   costs the text column ~28pt, and 56 is the fallback if it reads badly.

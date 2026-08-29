# notifications

Two things that only work together: the **push infrastructure** every other
feature was waiting on, and its first real consumer — **alerts**, a
location and radius that tells a spotter when a car is reported stolen near
them. Without this the core loop has no way to reach anyone who isn't already
looking at the app.

**Actor:** spotter (any signed-in user). Guests can't hold a zone — it needs a
`user_id` — so the settings screen is a gated action (`alert_settings`
context). Owners are consumers too: sighting and message pushes reach them
through the same infrastructure.

## Alerts

Up to **5 named alerts** per user, each a point + a radius of 1–50 miles,
optionally narrowed by the car. When a post goes `active`, spotters whose alert
matches get one push.

Created and edited through a wizard that **opens by asking what to match on**
(`components/AlertMatcherPicker.tsx`) — three cards: an area, a specific car, a
minimum bounty. The ticks decide the rest: area → [car] → [bounty] → name, so
"anything near home" is two screens rather than four with two left untouched.
One phase, no intro, with a review — the shape `addVehicleFlow` uses, because
this is a calm settings task, but a review still earns its place: an alert is
invisible once saved, so this is the only chance to notice you set 1 mile
instead of 10.

- **The area card is LOCKED ON, not hidden.** `point` and `radius_m` are NOT
  NULL — alerts are always local, because a spotter cannot act on a car 200
  miles away. Showing it ticked-and-greyed with the reason states the rule
  once; hiding it would leave the user wondering where the location question
  came from on the next screen.
- ⚠️ **The picker is a screen BEFORE the wizard, not a step inside it.**
  `useWizardController` resets navigation whenever the flattened screen list
  changes identity, and its indices are positions into that list (see
  `navigation.ts`'s `reset` SAFETY note), so a step that added or removed later
  steps as you toggled it would bounce you back to itself — and a review-edit
  spur that changed the count would return to the wrong screen. Choosing first
  and memoising the built flow keeps it stable for the whole run.
- **What is saved is reduced through the ticks** (`lib/alertMatchers.ts`), not
  read straight off the answers. Tick "a specific car", pick a BMW, back out,
  untick it — the answers still hold the BMW, and the update is a full replace,
  so without the reduction the row would stay BMW-only while every screen said
  "any car". Editing derives the ticks back from the saved criteria, so it can
  add a criterion as well as remove one.
- **Recency rides with the bounty card** rather than earning a fourth: the
  product offers three things to match on, and "how recently it was seen" is a
  refinement of which reports are worth hearing about, not a separate axis.
- **Area is ONE step**, map and radius slider together. The circle scaling live
  as you drag is the payoff visual; splitting them would show a circle you
  cannot change, then a number with no picture.
- **It opens where you are, at 5 miles.** The centre is resolved before the map
  mounts (`hooks/useDefaultAlertCentre.ts`) from: device position → the saved
  Explore feed location → nothing, which leaves the picker's whole-UK view.
  Opening on the country made the first screen of the wizard useless — you had
  to pan or search before it meant anything.
  - **It never cold-prompts.** Permission is read silently
    (`checkDevicePermission`) and the position is only requested once that comes
    back granted, because `expoLocationServices.getCurrentPosition` requests
    permission internally. The picker's own "use my current location" button is
    the one-tap way in for anyone who hasn't granted it.
  - Resolved **while the matcher picker is on screen**, which is what makes it
    free: `LocationPicker` reads `initialLocation` once, on mount, so the
    coordinate must exist before the wizard renders. If the fix is slower than
    the user, the wizard holds a brief loader — with a hard timeout, because a
    GPS fix can hang without ever erroring.
  - Consequence, accepted deliberately: centring on you also **settles** the
    step, so Next unlocks without touching the map. That is the two-tap path
    this is for, and it stays safe because `approximate` defaults on and the
    server coarsens the stored point regardless.
- **The zoom follows the radius.** `LocationPicker`'s `fitRadiusMiles` re-frames
  the map whenever the radius changes, so the circle keeps a constant
  relationship to the frame instead of overflowing at 50 miles and vanishing at
  1. It re-frames around the map's *current* centre, so a pan survives; a manual
  pinch does not, which is the accepted cost of the circle always reading the
  same way. The maths is `shared/lib/mapRegion.ts` — shared, because
  `LocationPicker` is shared and cannot import from a feature.
  - The prop is **optional**, so the pickers in post-a-car and report-a-sighting
    still open at street zoom. Their behaviour is byte-identical, and
    `LocationPicker.test.tsx` guards it.
- **5 miles, not the feed's 20.** Browsing a wide area is free; being
  interrupted is not, and the map now opens framed on this radius, so a large
  default would open on a view too coarse to recognise anywhere in.
- **Approximate by default.** The toggle ("Use approximate area only") snaps
  the point to the 0.01° (~1 km) grid **before it is stored**, server-side, in
  `create_my_alert` / `update_my_alert`. The database never holds the exact
  point. A client-side snap would be a promise; this is a guarantee — which is
  also why there is no client write grant on the table.
- **Criteria are optional and independent** — make, model, colour, body type,
  minimum bounty, recency. All unset is "any car", which is exactly what a v1
  alert was. Matched case-insensitively, because posts store whatever the owner
  typed.
  - The pickers offer **canonical values only, no free typing**. A typed
    "beemer" would create an alert that silently matches nothing — worse than
    no alert, because the user believes they are covered.
  - **Known limit**: case-folding doesn't equate `VW` with `Volkswagen`, or
    `Golf` with `Golf GTI`. The honest fix is normalising
    `posts.make/model/colour` on write. Not done.
  - **Recency filters `last_seen_at`, not post age.** It correctly excludes
    reports of older thefts, but most reports are recent, so it narrows less
    than users may expect. The step says so rather than implying otherwise.
- **Disabled ≠ deleted.** Pausing keeps the alert. Nobody should lose the thing
  they took trouble to set because they wanted quiet for a week.
- Alerts and the Explore **feed location** stay separate settings (search-map
  README). A new alert starts from the saved feed location when the device has
  none to offer — a **prefill, not a link**: editing an alert never writes back
  to the feed, and moving the feed never moves an existing alert.

> **Correction to the v1 note.** The `20260802120000` header said dropping
> `alert_zones_one_per_user_uidx` "*is* the entire v2 multi-zone migration".
> That was wrong in two ways, both caught while doing it: that unique index was
> the **only** index on `user_id` (a plain btree had to replace it, or every
> list/RLS/match lookup loses its path), and `upsert_my_alert_zone` inferred
> its `on conflict (user_id)` target from it. Confident comments about future
> work are worth re-deriving.

## Payload

> "A blue BMW was reported stolen in Hemel Hempstead — don't approach."

- Make, colour and a **district-grain** locality only, from
  `posts.last_seen_locality`. Never `posts.last_seen_area`, which comes from
  the LocationPicker's raw address label and can be street-grain — a feed
  carousel showing it is one thing, broadcasting it to everyone within 50 miles
  is another.
- **Never** the plate, never coordinates, never a house number.
- The **don't-approach clause is not optional** (DOMAIN.md / SECURITY_AND_TRUST
  §1: every alert notification carries the safety line). The full
  `SafetyNotice` renders on the post detail the tap opens.
- The `data` payload is ids only, parsed through a `.strict()` zod schema, so a
  leaked field is a parse failure rather than a silent delivery.

The copy is built in **SQL**, inside `match_alert_zones`. That puts every
privacy property under `npm run test:db` — the runner the project already has —
instead of introducing a Deno test runner to assert "the plate isn't in there".

## Volume

At most **3 alert pushes per user per rolling 24 hours**, plus never twice for
the same post. Overflow is **dropped silently, not digested**: with no pg_cron a
digest would flush only when the next alert arrives, and a late stolen-car
alert is worth little. A dropped push also loses nothing permanent — the post
is in Explore and on the map regardless. Alert fatigue is the asymmetric risk: a
spotter who mutes the app is worth zero alerts forever.

## Screens

- **AlertsScreen** (`/alerts`) — the list. Each alert is a card led by its ZONE
  as a thumbnail (`AlertZoneThumb`), then its name, what it watches
  (`summariseAlert`), and "Paused" when it is. Pressing the card edits it; the
  pause switch stays on the row because pausing is the daily action; everything
  rarer — pause/resume, edit, and a destructive delete — is behind the "⋯"
  (`AlertActionsSheet`). "Create an alert" stays **tappable at the cap** and
  says why, per the garage's rule that a dead control explains nothing.
  Reached from **both** Profile rows ("Alert location & radius" and
  "Notifications" are one setting in the user's head) and from the alert-area
  sheet.
  It owns the **per-user** concerns that don't belong on any single alert: the
  notification permission, as one compact `AlertPermissionBanner`. An alert
  can't fix a phone-level block, and asking five times would be absurd.
  **The list stays usable when notifications are off at OS level** — you can
  manage alerts, they just won't fire, and the banner says so.

  ⚠️ **The thumbnail is never load-bearing.** `AlertZoneGlyph` — a drawn point
  and radius in tokens — is the bottom layer of every tile and the map fades in
  over it, so a missing API key, Expo Go, offline, web and the `SHOW_MAP` kill
  switch all resolve to the same correct picture. The same glyph is the empty
  state's illustration, which makes the empty screen a preview of a full one.
  Redesigned 2026-08-27; see `docs/design-refs/alerts/`.
  Honest states: loading, error, signed out, empty, and at-cap.
- **AlertWizardScreen** (`/alerts/new`, `/alerts/[alertId]`) — one flow for
  create AND edit, the pattern `AddVehicleScreen` uses. In edit mode it holds a
  loader until the alert arrives: `update_my_alert` is a FULL REPLACE, so
  mounting the wizard blank and re-seeding underneath the user would offer to
  erase their criteria.
- **AlertNudgeSheet** — the one-time offer of an alert area, for members with
  none. Mounted at the app root and **earned, not scheduled**: it fires as
  someone LEAVES their third listing **opened from the home feed**, because
  three listings browsed is the
  cheapest honest signal that they are watching cars near them, and the exit is
  the moment that costs them nothing (the same rule as the garage's exit sheet
  — see `features/garage/README.md`). A timer was considered and rejected: a
  clock doesn't know whether you're mid-scroll or reading a listing.

  ⚠️ **Only a feed tap counts** (2026-08-22). Every post view used to, so an
  owner working through their own listings in My Posts raised an offer reading
  "want to know when a car goes missing near you?" — at someone whose car had
  just been stolen. The signal the offer rests on is BROWSING; managing your own
  theft is not that, and neither is arriving from a chat, a watchlist collection
  or a recovery flow. The home feed marks its taps with `?from=feed`
  (`BROWSING_SOURCE`), and `useCountPostViewForAlertNudge` takes a **required**
  boolean so a caller has to make the claim rather than inherit it — a forgotten
  flag costs a late nudge, a forgotten exclusion costs the wrong audience again.
  The map is deliberately NOT counted: arguably it is browsing too, but the
  narrower rule was the one asked for, and widening it is a product decision.

  It was an inline feed card until 2026-08-06. The card was easy to scroll past
  and, at full size, pushed the first real content off the screen; setting an
  alert area is the app's core loop, so the offer earns one interruption
  instead. The post-view COUNT persists across sessions
  (`alertNudgeStorage.ts`); the intent that fires the sheet does not
  (`alertNudgeIntent.ts`), so it can never open out of nowhere on a cold start.
  It yields while the garage's exit sheet is pending — two root sheets would
  stack.

## Push infrastructure

- `push_tokens` — **primary key on `token`, not `(user_id, token)`.** A device
  token survives logout, so a composite key would leave the previous user's row
  intact and send their notifications to whoever holds the phone now.
  PK-on-token makes re-registration a `do update set user_id` that *moves* the
  device. Asserted by the token-migration test.
- **One send utility** (`supabase/functions/_shared/push.ts`) that every kind
  uses — audience → chunk to 100 → Expo send → tickets → receipts → prune
  `DeviceNotRegistered`. No per-feature push code.
- **Receipts are drained opportunistically.** Expo's API is two-phase and there
  is no pg_cron here, so `notify-spotters` fire-and-forgets
  `process-push-receipts` at the start of each run. Honest consequence: a dead
  token is pruned on the *next* send, not immediately. pg_cron is the upgrade
  path.
- **Tap routing** is one pure function (`lib/pushRoute.ts`), including the
  cold-start case (app killed) — the classic gap. `NotificationsHost` gates
  cold-start navigation on router readiness, the session having resolved, and
  a once-only guard shared with the warm listener so a tap never routes twice.
  A response that arrives while we're still on onboarding is **dropped and
  marked handled** — without that last part the sticky launch response is
  re-read the moment onboarding ends and opens after all.
- Foreground pushes present as a quiet in-app Toast with a "View" action, not a
  system banner over the app the user is already looking at.
- **Message pushes are capped at one per thread per 2 minutes**, enforced in
  `claim_message_notification`. Chat allows 20 messages a minute per thread, so
  without it a hostile counterpart could fire 20 HIGH-importance pushes a
  minute — sound and vibration each — at a theft victim. Collapsing alone is
  **not** a volume control: `collapseId`/`tag` replaces the banner, not the
  buzz. The message itself is always delivered; only the push is suppressed,
  and the thread and its unread badge are untouched.
- **Notifications also collapse** per post / per thread, so a burst reads as
  one banner rather than a pile.
- **The client cannot be trusted to trigger its own notification**, so
  `notify-sighting` / `notify-message` authorise in the DATABASE:
  `claim_sighting_notification` / `claim_message_notification` verify the
  caller actually wrote the row, refuse system messages, and are idempotent.
  A forged id notifies nobody.

### Importing from this feature

**The barrel (`index.ts`) is deliberately light** and must stay that way:
`chatApi` and `sightingApi` import it just to call `notifySighting` /
`notifyMessage`. Anything reaching expo-notifications, react-native-maps,
AsyncStorage, the auth gate or the `shared/ui` barrel lands in those plain api
modules' graph — and their tests then need the native map and AsyncStorage
mocked merely to load the file. That broke them twice during this build.

Same call as `AppMap`'s absence from the `shared/ui` barrel. The heavy pieces
are imported by their single consumer, by path: `NotificationsHost`
(`app/_layout.tsx`), `AlertsScreen` (`app/alerts/index.tsx`),
`AlertWizardScreen` (`app/alerts/new.tsx` + `app/alerts/[alertId].tsx`),
`AlertNudgeCard` + `useAlertNudgeCard` (search-map's `HomeFeedScreen`).

### Triggering

`posts.status = 'active'` is set in exactly one place —
`mark_post_payment_held`, called from `stripe-webhook`. That function is
**not modified**. Instead the webhook fire-and-forget invokes `notify-spotters`
in a try/catch that never rethrows, so a push failure can't turn a settled
payment into a Stripe retry. `notify-spotters` claims the post itself
(`posts.alerts_sent_at`, `where alerts_sent_at is null`), which makes the
webhook's process-first-record-after retry safe: a re-run claims nothing and
exits quietly.

A post with no zones in range still gets claimed. That's deliberate — the claim
means "we tried", and we don't want a later retry blasting a stale post.

`claim_post_alerts` returns **no coordinates**. For a driveway theft the
last-seen point is the victim's home, and nothing downstream needs it —
`match_alert_zones` re-reads the point and does all the spatial work inside the
database, so the exact location never enters an Edge Function's memory or logs.

## watched-post-recovered — SHIPPED 2026-08-06 (it waited a month for its sender)

The `recovery` kind shipped 2026-08-02 as payload + route + kind with no
sender, blocked on "no code path anywhere moves a post to `recovered`". The
recovery transitions landed on 2026-08-02/03 (claim_recovery → release-payout
/ refund-recovery), and the notification center build closed the loop:
`claim_recovery_notifications` (claim on `posts.recovery_notified_at`, copy in
SQL, audience `watchlist_items` minus the owner — who CAN watch their own
post, so the exclusion is real) is fired via
`_shared/recoveryAnnounce.ts` from all three completion paths: the release
core, the no-spotter refund, and the hold sweep. Post context only — **never
watcher counts or other watchers' existence** (DOMAIN.md watchlist carve-out).

## The notification center (2026-08-06, ADR-0012)

The Inbox tab's second face (Messages | Notifications — the segment host is
the route, `src/app/(tabs)/inbox.tsx`, because chat and notifications must
not import each other's screens).

**THE RULE: persist first, then maybe push.** `notifyUsers()` in
`_shared/push.ts` writes one `notifications` row per recipient, then hands the
same content to `sendToUsers`. The row is the durable half; each half fails
alone. Every sender uses it except `notify-message` (chat's persistent surface
is the Messages segment — the one deliberate exclusion). Rows carry write-time
copy + the exact typed payload; the client renders with
`parsePushPayload → pushRouteFor`, so a row and its push always land in the
same place.

- Read state: nothing auto-marks. Tap marks one (optimistic, RPC behind);
  "Mark all as read" is the bulk affordance; a push TAP marks by kind+payload
  match (`mark_notifications_read_by_payload`) — no per-user row id rides a
  shared push. All marking via RPCs; clients hold no update grant.
- Badge: `lib/inboxBadge.ts` sums chat unread + center unread; both hooks
  report through it and set the one `inbox` badge. Chat imports us — never
  the reverse.
- Freshness: refetch-on-focus + pull-to-refresh (chat's documented choice).
- ⚠️ **The row leads with the CAR'S PHOTO where there is one** (2026-08-28,
  second inbox pass), which is why the feed read became
  `get_notification_feed()` rather than a table select: `post_photos` RLS only
  lets a client read a photo while the post is `active` or it owns the post, so
  a client-side join would have left `credited` / `payout_sent` /
  `not_credited` / `recovery` — the ones that matter — as the only pictureless
  rows. The RPC gates the photo MORE narrowly than the row: owner, or a spotter
  with a sighting on that post, or the post is still active. Everything else
  returns null and falls back to the icon, which is the ordinary case.
- Look: neutral `surfaceSubtle` icon TILES — 64pt rounded squares
  (`sizes.inboxRowTile`) since the 2026-08-28 Airbnb inbox pass, matching the
  Messages face's car photo so the two halves of the tab share one silhouette.
  They were 48pt circles; circles mean people, and neither inbox face is about
  a person's photograph. Meaning is carried by icon shape + the three semantic
  hues (`lib/centerRowMeta.ts` — the one mapping).
- ⚠️ `credited` and `closed_uncredited` keep the warning accent bar while
  unread AND now carry a LABEL saying what to do ("Add your bank details",
  "You can contest this"). The bar alone was status encoded as colour, which
  DESIGN_SYSTEM forbids, and a 3pt stripe cannot say what is needed. The label
  is part of `CenterRowMeta`'s discriminated union, so a new needs-attention
  kind cannot compile without someone choosing its words.
- ⚠️ Both inbox faces stay MOUNTED (2026-08-28), so this screen's
  `center_view` log fires on becoming visible rather than on mount — the
  metric is per-view from that date and is not comparable with earlier
  numbers. `useNotificationCenter` also holds its badge report until
  `status === 'ready'`, or every inbox open would blink the count to zero.
- Retention: 90 days, pg_cron `purge-old-notifications` (daily 03:30).
- New with the center: the `payout_sent` kind — "On its way — £X" from the
  RECORDED transfer amount, fired by the release core via
  `claim_payout_sent_notification`.

## Logging

`[notifications]`: `push_permission { state, canAskAgain, surface }`,
`push_token_registered { platform, changed }`, `push_token_unavailable`,
`alert_zone_set { radiusMiles, approximate, enabled, origin }` (origin coarsened
via `redactLocation`), `alert_zone_toggled`, `push_received_foreground`,
`push_opened { type, postId?, coldStart }`.

**Never the token.** `threadId` is deliberately excluded — it correlates two
identities. **Pushes sent vs tapped is the engagement metric for the whole
product.**

## Out of scope

- **Sighting-chain re-alerts** ("the car may have moved") — out of v1 by
  decision; DOMAIN.md amended to match ROADMAP v2 candidate #4. Re-alerts scale
  with reporter count, not with genuine movement, so a busy post in a dense area
  would spam every zone around it.
- Multiple zones, quiet hours, email notifications.
  ⚠️ **The per-type preferences matrix SHIPPED 2026-08-24** and this line
  claimed otherwise until then. Five mutable categories (alerts, messages,
  my_sightings, money, watched) live in `notification_preferences`, are
  toggled from Settings, and are applied in `_shared/push.ts` at the ONE point
  where the push is sent — never where the notifications row is written, so
  muting costs the interruption and never the information (ADR-0012).
  `sighting` and `closed_uncredited` have no category and cannot be muted:
  see `lib/notificationPreferences.ts` for why, and
  `supabase/tests/notificationCategories.test.ts`, which fails if either ever
  acquires one.

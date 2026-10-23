# Feature: profile

The Profile tab, composed to the Airbnb profile reference
(docs/design-refs/profile/ — spec, gap analysis, and the redesign decisions,
2026-07-16): an identity HERO card (96pt avatar with the trusted-spotter
check riding its corner, first name, member-since, and the nonzero
Reputation v1 counters as a passport-style stat column — whole card taps to
edit), a "Your spotter story" row pushing the narrative reputation card
(highlights, badges at 1/5/25, next-goal bar — social proof only, never
payout-affecting), settings groups with heading-scale titles and hairline
dividers, support/legal links, and a **Danger zone** group (2026-10-23: Log
out, Sign out on all devices, red Delete account), then the app version. Also exports
`PublicProfileSheet` — the passport owners see for a spotter, a `// SAFETY`
privacy boundary showing ONLY first name, avatar, reputation, and
member-since; earned trust only (no goal/progress UI publicly).

**Screens:** `ProfileScreen` (tab root; calm signed-out state until real
auth lands, `__DEV__` sample-data preview), `EditProfileScreen`
(`/edit-profile`; names + avatar via expo-image-picker — camera chip ON the
photo, plain state + zod), `SpotterStoryScreen` (`/spotter-story`; the full
narrative ReputationCard), `DeleteAccountScreen` (`/delete-account`, below).
**Tables:** `profiles` (fields + counters via
`20260710120000_profile_fields_and_avatars.sql`), `stripe_connected_accounts`
(payout status, read-only).
**RPCs:** `account_deletion_blockers()` (20261023120000) — what stops the
caller deleting, as `[{code, count}]`; `forget_my_push_tokens()`
(20261023130000) — every device's push token, for "Sign out on all devices".
**Storage:** public `avatars` bucket, own-folder writes.
**Edge Functions:** `delete-account` — called by `requestAccountDeletion`.

## Danger zone and account deletion (2026-10-23)

Owner's picks: delete **straight away**, but only when nothing is pending (no
grace period); a full screen confirmed by **typing DELETE**; a quiet group
with red only on Delete account. No "Download my data".

- **Log out** — this device: its push token, then the local teardown
  (`forgetThisDevice`: badge, unfinished report, location caches), then the
  session.
- **Sign out on all devices** — `forget_my_push_tokens` (every device stops
  getting pushes — the lost-phone case), the same teardown, then
  `signOut({ scope: 'global' })`. Other phones' access tokens live until they
  expire (≤ 1 hour); they just can't refresh.
- **Delete account** → `DeleteAccountScreen`: reads
  `account_deletion_blockers()`. Blocked → one line per reason
  (`lib/deletionReasons.ts`), no button. Clear → Deleted / Kept, type DELETE,
  red button. A server refusal (stale list, or a payout still on its way —
  only the server can see that balance) shows its reason and re-reads the
  list. What the server does is in docs/DOMAIN.md "Account deletion".
**Config:** `config.ts` — `PAYOUTS_ENABLED=true`, legal URLs (TODO
placeholders), support email (`support@trackitdown.example` — a reserved TLD,
so it still goes nowhere).

⚠️ **This paragraph was wrong for three weeks and cost a real decision.** It
said `PAYOUTS_ENABLED=false`, "the payee half of the money loop does not
exist", "no Connect onboarding" and "`release-payout` has no caller". All four
stopped being true on **2026-08-03** (`ec9fbcf`, "a screen where a spotter can
be paid"): the flag is `true`, `supabase/functions/connect-onboarding` exists,
`release-payout` is invoked from `vehicles/api/recoveryApi.ts:250`, and
`ROADMAP.md` records "BOTH WIRES CLOSED 2026-08-03".

Corrected 2026-08-24, after this file was read aloud as the current state and
used to argue the app was further from launch than it is. A stale README is not
a tidiness problem — it is a confident source of false facts about your own
codebase, and it is believed precisely because it is in the repo. When you
change a flag, grep the docs for its name.

## Settings (2026-08-24)

`SettingsScreen` — Profile → Settings → "App settings" (`row-settings`),
route `/settings`. Three groups: **Appearance** (System / Light / Dark radio
rows), **Notifications** (five per-category switches, signed-in only), and
**Permissions** (notifications, location, camera, photos).

⚠️ **Two notification kinds have no switch, and their absence is the feature.**
A sighting of your own car, and the 72-hour window to contest a bounty
decision — whose push is the only door to `/sighting-dispute`. They have no
category, so there is no column to store a mute in. Shown as a row with no
control rather than a disabled switch: a stuck switch reads as a bug, and this
is a decision. `supabase/tests/notificationCategories.test.ts` fails if either
ever acquires a category.

⚠️ **The permission rows are STATUS rows, not switches.** An app cannot grant
itself a permission; a switch could only deep-link and then snap back, which
reads as a control that failed. Each row states the truth and opens the OS
settings page. `useDevicePermission`'s `useFocusEffect` re-check is what makes
the return trip update the row without a relaunch.

⚠️ **A `denied` permission deep-links even when `canAskAgain` is true**,
diverging from the house rule. Every other re-prompt sits behind a
`PermissionPrimer` that has just explained why; a bare settings row has not,
and on Android a second refusal is permanent.

⚠️ **Appearance reverses an owner call of 2026-08-10** ("a switch, not a
three-way chooser"). The three-state model and its persistence already existed;
only the UI was two-state, which meant that once flipped there was no way back
to following the phone. The reasoning moved with the decision — it is on the
Appearance group in `SettingsScreen.tsx`, not left beside a row that no longer
exists. `row-dark-mode` is GONE, not renamed.

**Not here:** "Alerts & notifications" and "Payouts" stayed on the Profile
root — the first carries a live summary, the second only appears when relevant.

The five per-category push switches shipped the same day (this paragraph said
they were "phase 2" until then). They live in `notification_preferences` and
are applied in `supabase/functions/_shared/push.ts` — see
`src/features/notifications/lib/notificationPreferences.ts`.

## Report a bug (2026-08-24; a wizard since 2026-08-27)

Profile → Support & legal → "Report a bug". Message, area, severity, frequency,
what they expected, up to three screenshots. Writes via `submit_bug_report`
(SECURITY DEFINER, `reporter_id` pinned to `auth.uid()`, 5 per rolling hour)
into `bug_reports`.

Now the shared wizard framework's **fifth flow** (`lib/bugReportFlow.tsx`):
three steps — what happened → where and how bad → screenshots — then review.
`ReportBugScreen` is only the host; it builds the flow, reads the diagnostics
once, and owns the submit.

⚠️ **Only the first step asks for anything, and that is the design.** The other
four flows serve someone motivated — posting a car, adding a vehicle, claiming a
sighting. A bug report is altruistic and filed by someone already annoyed that
something broke, so every extra screen is a chance to abandon. Steps 2 and 3
carry permissive schemas AND `optional`, which makes a one-line report
message → Next → Next → Send. `lib/bugReportFlow.test.tsx` pins that, because
the failure is silent: nothing errors, people just give up.

⚠️ **The "Sent with your report" panel is the feature, not decoration.** It
renders from the same readers that build the payload, so the screen cannot
claim less than it sends, and the privacy policy names the same fields. **Any
field added to the payload must appear in that panel in the same change.**
It now lives in `components/BugDisclosurePanel.tsx` and renders as the review
screen's footer — a better home than it had: on the old single screen it sat
far below the fields, and someone who skipped ahead never re-read it. On review
it is the last thing before "Send report".

Three things it deliberately does NOT carry, and the reasoning is in
`supabase/migrations/20260824100000_bug_reports.sql`: no log payloads (the
breadcrumb trail is event NAMES only — the `data` is where the bare UUIDs
live), no route (`area` is a closed ten-value vocabulary that cannot hold an
id), and screenshots only because the user picks, previews and can remove them,
into a PRIVATE bucket with no client read.

**Files:** `screens/ReportBugScreen.tsx`, `api/bugReportApi.ts`,
`api/bugScreenshotUpload.ts`, `lib/bugReportOptions.ts`, `lib/bugDiagnostics.ts`,
`lib/bugBreadcrumbs.ts`, `lib/lastArea.ts` (the tab-name pre-fill, written from
`app/(tabs)/_layout.tsx`).
**Design:** `docs/design-refs/report-bug/` — Airbnb-language pass, 2026-08-24.
⚠️ **No reader exists IN THE APP** — no screen, no Edge Function. The queue is
the Supabase SQL console, and `docs/OPERATIONS.md` now holds the query and says
where the private screenshots live. That makes "Thanks — we'll take a look"
possible; it does not make it automatic. The button is only honest if someone
actually looks.

**Out of scope:** blocked-users management, payment methods, vanity profile
URLs, notification toggles (live in the notifications feature), real auth.

# Feature: profile

The Profile tab, composed to the Airbnb profile reference
(docs/design-refs/profile/ — spec, gap analysis, and the redesign decisions,
2026-07-16): an identity HERO card (96pt avatar with the trusted-spotter
check riding its corner, first name, member-since, and the nonzero
Reputation v1 counters as a passport-style stat column — whole card taps to
edit), a "Your spotter story" row pushing the narrative reputation card
(highlights, badges at 1/5/25, next-goal bar — social proof only, never
payout-affecting), settings groups with heading-scale titles and hairline
dividers, support/legal links, and a quiet ungrouped bottom cluster
(underlined "Log out", muted "Delete account", app version). Also exports
`PublicProfileSheet` — the passport owners see for a spotter, a `// SAFETY`
privacy boundary showing ONLY first name, avatar, reputation, and
member-since; earned trust only (no goal/progress UI publicly).

**Screens:** `ProfileScreen` (tab root; calm signed-out state until real
auth lands, `__DEV__` sample-data preview), `EditProfileScreen`
(`/edit-profile`; names + avatar via expo-image-picker — camera chip ON the
photo, plain state + zod), `SpotterStoryScreen` (`/spotter-story`; the full
narrative ReputationCard).
**Tables:** `profiles` (fields + counters via
`20260710120000_profile_fields_and_avatars.sql`), `posts` (read-only
deletion pre-check), `stripe_connected_accounts` (payout status, read-only).
**Storage:** public `avatars` bucket, own-folder writes.
**Edge Functions:** `delete-account` — **BUILT** (2026-08-01, 247 lines),
invoked at `api/profileApi.ts:228`. This line said "NOT built yet" until
2026-08-03. It sweeps storage as well as rows; `sighting-photos` is
deliberately excluded (SECURITY_AND_TRUST §5 records that as a judgement
call, not a certainty). The client still pre-checks for posts with escrowed
money (active / pending_verification / recovery_claimed) and blocks with
honest copy; the server re-check is now the real enforcement.
⚠️ **Known trap:** crediting a spotter moves a post to `recovery_claimed`,
and nothing can currently move it out of that state — so an owner who
credits someone can never delete their account. See the payout gap below.
**Config:** `config.ts` — `PAYOUTS_ENABLED=false` (the row ships dark; the
payee half of the money loop does not exist — no Connect onboarding, and
`release-payout` has no caller), legal URLs (TODO placeholders), support
email (`support@trackitdown.example` — a reserved TLD, so it goes nowhere).

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
Per-category push toggles are phase 2 (they need a preferences table, RPCs and
filtering in `_shared/push.ts`).

## Report a bug (2026-08-24)

`ReportBugScreen` — Profile → Support & legal → "Report a bug". Message, area,
severity, frequency, what they expected, up to three screenshots. Writes via
`submit_bug_report` (SECURITY DEFINER, `reporter_id` pinned to `auth.uid()`,
5 per rolling hour) into `bug_reports`.

⚠️ **The "Sent with your report" panel is the feature, not decoration.** It
renders from the same readers that build the payload, so the screen cannot
claim less than it sends, and the privacy policy names the same fields. **Any
field added to the payload must appear in that panel in the same change.**

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
⚠️ **No reader exists.** Nothing in the app or repo reads `bug_reports` or the
`bug-screenshots` bucket; the queue is "open the Supabase SQL console". The
button is only honest if someone actually looks.

**Out of scope:** blocked-users management, payment methods, vanity profile
URLs, notification toggles (live in the notifications feature), real auth.

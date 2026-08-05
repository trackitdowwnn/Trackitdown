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
**Out of scope:** blocked-users management, payment methods, vanity profile
URLs, notification toggles (live in the notifications feature), real auth.

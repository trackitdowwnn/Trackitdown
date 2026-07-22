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
**Edge Functions:** `delete-account` — NOT built yet; outlined in the
migration's comment block. The client pre-checks for posts with escrowed
money (active / pending_verification / recovery_claimed) and blocks with
honest copy; the server re-check is the enforcement when the function lands.
**Config:** `config.ts` — `PAYOUTS_ENABLED=false` (row ships dark until
Phase 3 payments), legal URLs (TODO placeholders), support email.
**Out of scope:** blocked-users management, payment methods, vanity profile
URLs, notification toggles (live in the notifications feature), real auth.

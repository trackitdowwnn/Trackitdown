# Feature: profile

The Profile tab: your identity (avatar, first name, display name, member
since), the DOMAIN.md Reputation v1 card (three server-maintained counters,
badges at 1/5/25 — social proof only, never payout-affecting), a settings
hub linking other features, support/legal links, and account management
(sign out, delete account). Also exports `PublicProfileSheet` — the compact
spotter profile owners see, a `// SAFETY` privacy boundary showing ONLY
first name, avatar, reputation, and member-since.

**Screens:** `ProfileScreen` (tab root; calm signed-out state until real
auth lands, `__DEV__` sample-data preview), `EditProfileScreen`
(`/edit-profile`; names + avatar via expo-image-picker, plain state + zod).
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

# Project context — Trackitdown

**Purpose:** a UK app that helps people get stolen cars back. Owners post a
listing (optionally with a reward held by the payment partner); the public
report sightings; the owner credits the sighting that led to the car and the
spotter is paid.

**Tech stack:** Expo SDK 57 / React Native 0.86 / React 19 (TypeScript, Expo
Router, zod); Supabase (Postgres + PostGIS, RLS, SECURITY DEFINER RPCs, Deno
Edge Functions); Stripe Connect; EAS builds + OTA updates (Android preview).

**Current phase:** closed beta with testers; prod holds test data only.
Hardening before public launch (security audit run 1 leads, custom email
sender, legal/company details).

**Key constraints:** privacy of theft victims (a driveway theft's location is
their home) and spotters; money never moves twice or from under a credited
spotter; server is the enforcement point; schema changes only via migration
PRs; minimal UI copy; no payment-provider names in app wording.

**Done looks like:** a fix is merged with CI green (Jest, tsc, lint, SQL
verification suites), deployed, verified read-only in prod, and shipped to
phones by OTA when the app changed.

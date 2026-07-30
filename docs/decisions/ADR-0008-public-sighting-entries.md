# ADR-0008 — Restrained public sighting entries (loosening "public sees none")

**Status:** accepted · **Date:** 2026-07-29

## Context

Since the sightings feature shipped, SECURITY_AND_TRUST §6 has held a hard
line: *"`sightings`: spotter sees their own; the post's owner sees all
sightings on their post; **public sees none**."* The public's only signal has
been the aggregate on the post detail — "N sightings · latest 5h ago".

The sighting timeline feature (2026-07-29) asked whether the public face
should instead show a restrained per-sighting list: relative time + coarse
locality, most recent five, "and N earlier sightings".

## The two arguments

**Against (why §6 said "none"):** per-sighting time + place is a movement
trace. A sequence of entries — Holloway 5h ago, Archway yesterday — reads as
a track, and the person best positioned to consume a track of a stolen car's
sightings is the person who has it. The aggregate leaks recency only; a list
leaks recency *per place*.

**For:** the trace argument inverts on inspection. The thief already knows
where the car is — they possess it; a locality-level echo of where strangers
have seen it tells them almost nothing they don't know, and nothing at street
precision. The people who genuinely gain are would-be spotters: visible
activity proves the network works (the platform's core credibility claim),
and recency-by-area helps someone decide whether keeping an eye out is still
worthwhile *here*. The sighting's real secrets — who reported it, exactly
where, and what it looked like — stay owner-only.

## Decision

Show the restrained public entries, fenced by construction:

- A **dedicated SECURITY DEFINER RPC** (`get_public_sighting_entries`) is the
  only path; the sightings table itself remains ungranted to `anon` and
  RLS-closed to non-spotters. The public payload is `{created_at, locality}`
  per entry plus a total count — **no sighting ids, no coordinates, no photo
  paths, no spotter fields, no notes, no accuracy data**.
- **Locality granularity only** — a new `sightings.locality` column captured
  at report time from the reverse-geocode's district/city, never the
  street-level `area_label` the owner sees. No locality (older sightings,
  failed geocode) → the entry shows time only.
- **Capped server-side** at the 5 most recent; the count of the remainder is
  a number, not a list.
- **Active posts only.** A closed post's public entries vanish with it
  (consistent with §3's location-history posture).

## Consequences

- SECURITY_AND_TRUST §6 is updated in the same session (the sightings line
  now names this RPC as the single public carve-out).
- `sightings_verification.sql` gains absence CHECKs on the public payload —
  the fence is tested, not asserted.
- The aggregate line is superseded wherever the timeline renders.
- Revisit trigger: if moderation ever sees sighting entries being used to
  probe spotter activity (e.g. correlated harassment reports), the RPC can be
  narrowed back to the aggregate without schema changes — the column and cap
  live server-side.

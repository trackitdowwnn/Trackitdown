# ADR-0009 — A public sighting map, at snapped ~1km grain

**Status:** accepted 2026-07-30 (owner decision). Revises ADR-0008.

## Decision

The post detail page's "Sighting activity" section gains an interactive map
on BOTH faces, showing the post's sightings connected in time order from the
theft origin:

- **Owner face:** exact capture points (the owner's payload already carries
  them — unchanged posture).
- **Public face:** each public entry now carries `snap_lat`/`snap_lng` — the
  sighting's first located photo **rounded server-side to a 0.01° grid**
  (~1.1 km latitude, ~0.7 km longitude at UK latitudes) — or null when the
  sighting is un-located. The rounding happens inside
  `get_public_sighting_entries` before anything leaves the database; no raw
  coordinate ever enters a public payload.

## What ADR-0008 keeps

Everything else: the 5-entry cap + earlier-count, time + coarse locality,
no ids, no photos, no spotter fields, no notes, no accuracy, active posts
only, identical empty shape for missing/non-active posts. The strict client
zod shape and the SQL absence CHECKs remain the fences, updated for the two
new fields.

## Why this grain

"Show the trail publicly" (owner ask: the network's visible momentum — a
would-be spotter seeing the trail move through their area is the growth
loop) collides with ADR-0008's reason for hiding locations (the thief reads
the post too). The ~1km snap resolves it: the SHAPE and DIRECTION of the
trail read clearly at city zoom, while no pin identifies a real capture
point, a spotter's position, or a stakeable location. The owner's exact
trail stays owner-only.

## Rejected

- Exact public points — hands the thief every spotter's position.
- Locality-name centroids — needs a geocoding table we don't have; the grid
  snap is honest, cheap, and derived from data we already hold.

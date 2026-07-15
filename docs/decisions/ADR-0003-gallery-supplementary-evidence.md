# ADR-0003 — Gallery photos as supplementary sighting evidence (hybrid)

**Status:** accepted (build deferred) · **Date:** 2026-07-15

## Context

DOMAIN.md's sighting rules have been in-app camera ONLY: the live capture
(photo + GPS + timestamp bundled atomically at the shutter) is what proves a
spotter was actually there, and gallery uploads would let fabricated
sightings chase bounties.

But the likeliest real-world spotter behaviour argues for an exception:
someone who sees a stolen car photographs it FIRST — instinctively, before
the car drives off — and opens the app second. Camera-only forces that
person to discard their best photo of the car. Product judgement (owner
decision, 2026-07-15): this is common enough to serve.

Options considered:
- **A — keep camera-only.** Strongest fraud posture; rejects the
  snap-first spotter.
- **B — hybrid (chosen).** Gallery photos allowed as SUPPLEMENTARY
  evidence only; every sighting still requires ≥1 live in-app capture.
- **C — full gallery freedom.** Rejected: a gallery-only sighting is
  unfalsifiable, and making it safe needs moderation infrastructure that
  does not exist (review queues for gallery-only reports, payout holds).

## Decision

Adopt **B**, with three non-negotiables:

1. **≥1 live in-app capture per sighting, enforced server-side** in
   `create_sighting` — never client-only. Gallery-only submissions are
   rejected with a machine token.
2. **Honest provenance, end to end.** Each photo row carries
   `source: 'live' | 'gallery'`. Owner-facing UI labels gallery photos
   "added from photo library" — unmissable, not fine print.
3. **Payout blindness.** Credit/recovery decisions lean structurally on
   live evidence only: gallery photos carry NO location/time evidence
   weight (their EXIF is stripped and never read as evidence), and the
   crediting flow must not surface them as location proof.

## The attack this accepts, and its mitigations

The residual attack under B: pair a trivial live capture (an empty street —
which proves presence at a place and time, not the car) with gallery images
of the car **scraped from the owner's own post**. The owner sees convincing
photos of their car with only the label to warn them.

- Cost to the attacker: they must still physically be somewhere and take a
  live photo; the payout still cannot credit gallery evidence.
- Residual harm: owner false hope / wasted attention — a trust cost, not a
  payout loss.
- Mitigations: the mandatory label (now); perceptual-hash dedupe of gallery
  uploads against the post's own photos + flagging gallery-heavy reporting
  patterns (future, listed for the moderation feature).

## Consequences

- DOMAIN.md sighting rules updated: live capture remains the REQUIRED
  evidence; gallery becomes permitted supplementary context once built.
- Build is a follow-up feature (not part of the 2026-07-15 session that
  recorded this): migration adding `sighting_photos.source` + the RPC
  ≥1-live rule, gallery pick/upload path (EXIF stripped), owner-facing
  labels, tests (RPC rejects gallery-only; source flags persist; labels
  render), and a security-reviewer pass.
- `CameraCapture` stays live-capture-only BY DESIGN — the gallery path, when
  built, lives in the photo-step UI beside it, never inside it.
- ROADMAP's "no gallery uploads" line now reads "no gallery-ONLY
  sightings"; the hybrid build sits in "Deferred from built v1 features".
- Revisit if: fraud/moderation data after launch shows labelled gallery
  photos misleading owners in practice, or the live-capture requirement
  measurably suppresses real reports.

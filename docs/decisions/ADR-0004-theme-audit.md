# ADR-0004 — Colour theme: refine the warm palette, don't redirect

**Status:** accepted · **Date:** 2026-07-15

## Context

A full colour-theme audit was run (inventory of `src/shared/theme` + how
tokens are actually used, web research on Airbnb / fintech / crime-app
colour conventions and colour psychology, WCAG contrast maths, and the
owner's own read of the app on-device). Standing question: keep the warm
cream base (`#FAF7F2`) or move to an Airbnb-style near-white.

Findings:
- **Token discipline is exemplary** — zero hard-coded hex/rgba in
  production code; every colour flows through `colors.*`.
- **The palette is already on-Airbnb**: ~90% neutral (cream/white/warm
  grey) with a single warm accent (terracotta) reserved for value moments
  and sage for actions. Research confirms sage reads "calm/resolution, not
  emergency" and terracotta reads "genuine reward, not casino" (casinos use
  neon-green + gold-on-black; we don't).
- The app already **avoids the "Citizen" trap** — no dark map, no red
  danger dots — which research flagged as the key failure mode for a
  crime-adjacent product.
- **Accessibility is strong**: every token used as TEXT clears WCAG AA
  (4.5:1); status is never colour-alone (dot + label).

Only three real defects surfaced:
1. The map rendered **stock Google colours** (bright blue/green) that
   clashed with the warm palette — despite DESIGN_SYSTEM promising "a light
   map style (muted natural tones)".
2. `warning` `#C9973B` sat at **2.46:1** on cream — below the 3:1 WCAG needs
   for a meaningful graphic (it's used only as dots/icons/borders).
3. DESIGN_SYSTEM claimed a map style that didn't exist and had no contrast
   table.

## Decision

**Refine the current theme; do not redirect it.** Keep the warm cream base,
sage primary, and terracotta bounty accent — the owner chose "calm and
right, just fix issues" and "distinctive & ownable", and the audit +
research agree the direction is correct. Change is a choice, not an
assumption; here the choice is to keep.

Applied fixes only:
- **Custom light map style** (`src/shared/theme/mapStyle.ts`, wired into
  `AppMap` via `customMapStyle`): land = `surfaceSubtle` cream, water =
  muted sage-grey, soft roads, quiet labels, POI/transit clutter removed —
  harmonised with the palette and previewed on-device before adoption.
- **`warning` deepened** `#C9973B` → `#A9762A` (2.46 → 3.70 on cream) so its
  dot/icon usage clears 3:1. Same amber semantic; never body text.
- **DESIGN_SYSTEM.md** updated: real contrast table, honest map-style
  section.

Explicitly NOT changed: the base surface (cream stays), the sage/terracotta
pairing and their meanings (accent = value, danger = destructive/error,
statuses keep semantic roles), and every other token value.

## Consequences

- The map now reads as one system with the rest of the app; the design doc
  matches reality.
- Palette meaning is unchanged, so no downstream component needs rework.
- A future redirect (near-white base, different accent) remains possible but
  is now a documented, deliberate departure from a researched baseline —
  not a silent drift.
- Revisit if: real user/photo data shows the cream muddies photography, or a
  brand refresh deliberately changes the accent.

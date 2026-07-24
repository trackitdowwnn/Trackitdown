# ADR-0006 — Colour theme: monochrome (near-black primary + bounty)

**Status:** accepted · **Date:** 2026-07-24 · **Supersedes:** [ADR-0005](ADR-0005-airbnb-orange-theme.md)

## Context

ADR-0005 (2026-07-16) redirected the palette to Airbnb's cool-neutral
structure with a **deep orange `primary`** (Arches `#C2410C`) for actions and
a **terracotta `accent`** (`#C97B5D`) reserved for bounty/value — the app's two
warm colours.

The owner has decided to drop the warmth entirely and go **monochrome**: no
orange, no terracotta. Both the primary action colour and the bounty/value
accent become **near-black**. Two choices were confirmed before implementing:

1. **Scope — primary AND terracotta** both go black (fully monochrome), not
   just the primary. The bounty tag is no longer a distinct warm hue.
2. **Shade — soft near-black `#1A1A1A`** (the Vercel/Linear "black button"
   look), not pure `#000` — softer, and it sits with the `#222` text ink.

Semantic status hues are explicitly **kept** so meaning survives colour-blind
and at-a-glance reading: `success` green, `warning` amber (pending/expiring),
`danger` red. Amber is now the only warm colour left in the app, and only ever
appears as a status dot/icon/border.

## Decision

Swap the warm brand tokens in `src/shared/theme/colors.ts` to near-black. As in
ADR-0005 this is a **value swap** — token *names* are unchanged, so the whole
app cascades (every button, CTA, link, active state, selection ring/checkmark,
the bounty tag, and the tab-bar accent).

### The change

| Token | From (ADR-0005) | To | Note |
|---|---|---|---|
| `primary` | `#C2410C` (Arches orange) | `#1A1A1A` | actions, active states, selection |
| `primaryPressed` | `#A8380A` | `#333333` | lightens — can't go darker than near-black |
| `accent` | `#C97B5D` (terracotta) | `#1A1A1A` | bounty/value fills + large type |
| `accentText` | `#A05A3B` | `#1A1A1A` | bounty label/body text |

Unchanged: `background` `#F7F7F7`, `surface` `#FFFFFF`, the greys/borders,
`success`/`warning`/`danger`, and `textOnPrimary` `#FFFFFF` (white text on the
near-black fills — now AAA at ~16.9:1).

`accent`/`accentText` now equal `primary`; the token *names* are retained so a
future re-theme (or giving bounty its own hue again) is still a one-line value
swap, and so intent stays legible at the call site.

## Consequences

- **Bounty no longer pops by hue.** Value now reads through a bold black fill,
  weight, and size rather than colour. Acceptable and intended per the owner's
  monochrome choice; if "value" ever needs to stand out again, give `accent` a
  distinct value.
- **Amber `warning` is the only warm colour left** — a deliberate semantic
  island for pending/expiring, never brand decoration.
- **Docs:** `DESIGN_SYSTEM.md` colour palette + contrast table updated; inline
  "orange"/"terracotta" comments across the UI were swept to "near-black".
- **`mapStyle.ts`** stays on cool neutrals (it never used the accent).

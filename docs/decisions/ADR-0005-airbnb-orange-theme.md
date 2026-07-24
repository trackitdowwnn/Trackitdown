# ADR-0005 — Colour theme: redirect to Airbnb's palette with an orange accent

**Status:** superseded by [ADR-0006](ADR-0006-monochrome-theme.md) (2026-07-24) · **Date:** 2026-07-16 · **Supersedes:** [ADR-0004](ADR-0004-theme-audit.md)

## Context

ADR-0004 (2026-07-15) audited the theme and chose to **keep** the warm
cream/sage/terracotta palette, while explicitly noting that "a future
redirect … remains possible but is now a documented, deliberate departure."

The owner has now made that departure a decision: adopt **Airbnb's actual
visual structure** — cool near-white surfaces, grey ink, and ONE vivid
accent used sparingly so photography carries the colour — but with
**orange** where Airbnb uses its Rausch coral/pink.

Four decisions were confirmed with the owner before implementing:

1. **Orange = `primary`** (buttons, CTAs, links, active states), replacing
   sage.
2. **Bounty keeps a distinct warm accent** — the existing terracotta stays,
   so money still reads as "value". It becomes the app's *only* warm colour,
   so it stands out more, not less.
3. **Full Airbnb cool neutrals** — page `#F7F7F7`, cards `#FFFFFF`, grey text.
4. **Orange = Airbnb Arches `#FC642D`**, tuned deeper for WCAG AA.

**Airbnb reference (researched):** surfaces `#FFFFFF` / `#F7F7F7`; text
`#222222` / `#767676`; the accent (Rausch `#FF385C`) is reserved for the
*single* primary action — everything else is near-neutral ink and grey.

## Decision

Redirect the palette to cool Airbnb neutrals with a deep-orange primary.
The change is a **value swap in `src/shared/theme/colors.ts`** (token names
unchanged, so the whole app cascades), plus the custom map style
(`mapStyle.ts`) re-derived to cool tones and the docs.

### The new palette

| Token | From (ADR-0004) | To | Note |
|---|---|---|---|
| `background` | `#FAF7F2` | `#F7F7F7` | Airbnb page near-white (cool) |
| `surface` | `#FFFFFF` | `#FFFFFF` | unchanged |
| `surfaceSubtle` | `#F3EEE6` | `#EEEEEE` | cool light grey |
| `surfaceSubtlePressed` | `#E9E2D5` | `#E0E0E0` | |
| `primary` | `#5B755D` | `#C2410C` | **deep Arches orange** — the one accent |
| `primaryPressed` | `#4C634E` | `#A8380A` | white-on 6.49 AA |
| `accent` | `#C97B5D` | `#C97B5D` | **terracotta kept** — bounty large-type |
| `accentText` | `#A05A3B` | `#A05A3B` | **terracotta kept** — bounty text |
| `textPrimary` | `#2B2926` | `#222222` | Airbnb ink |
| `textSecondary` | `#6F6A62` | `#6A6A6A` | cool grey (Foggy `#767676` is only 4.24 so deepened) |
| `border` | `#E7E0D6` | `#DDDDDD` | Airbnb divider grey |
| `borderStrong` | `#B8AE9E` | `#949494` | ≥3:1 so progress tracks stay visible |
| `success` | `#4F8A5B` | `#4F8A5B` | unchanged (dot only) |
| `warning` | `#A9762A` | `#A9762A` | unchanged (dot/icon only) |
| `danger` | `#B4553F` | `#C0281E` | **clearer red** — must stay distinct from orange |
| `dangerPressed` | `#96462F` | `#A21F16` | |
| `surfaceInverse` | `#2B2926` | `#222222` | cool ink |
| `surfaceInversePressed` | `#403D39` | `#3A3A3A` | |
| `overlay` | `rgba(43,41,38,0.45)` | `rgba(0,0,0,0.45)` | cool scrim |

`textOnPrimary` stays `#FFFFFF` (white on orange = 5.18 AA).

### Why a *deepened* Arches, not `#FC642D` itself

Airbnb's vibrant Arches `#FC642D` fails WCAG AA both ways — white-on is only
~3.0:1 and orange-on-`#F7F7F7` is ~2.8:1 — so it can't carry white button
labels or serve as link text accessibly. `primary` is therefore a deepened
Arches, **`#C2410C`**: white-on-primary = 5.18:1 and orange-as-text = 4.83:1,
both AA. It reads unmistakably "Airbnb-orange" while clearing contrast. (On
device the brightness can be re-tuned within the AA envelope.)

### Why danger moved to a clearer red

With orange now the primary CTA colour, the old muted brick-red danger
(`#B4553F`) sat too close in hue and could read as "the primary action".
`danger` moves to a clearer red (`#C0281E`, 5.50 AA as text / 5.89 white-on)
so destructive/error UI never blurs with the orange CTA.

### Semantic rules (preserved)

- **Orange = actions** only (the single vivid accent).
- **Terracotta = value/bounty** only — now the sole warm colour.
- **Danger = destructive/error** only, kept a distinct red.
- Status never encoded by colour alone: `StatusBadge` always pairs a dot
  with a label (colour-blind-safe) — unchanged.

## Consequences

- **Low mechanical risk:** token discipline (zero hard-coded hex in
  production — confirmed again this session) means the whole app re-themes
  from `colors.ts`. No component logic changes.
- The map style was re-derived to match: land `#EEEEEE`, water `#D6DEE2`
  (cool blue-grey), parks `#E3EAE3`, road edges `#DDDDDD`, labels `#6A6A6A`
  with an `#F7F7F7` halo; pins/cluster now render orange.
- Every text token clears WCAG AA on the new `#F7F7F7`/`#FFFFFF` surfaces
  (contrast table in `docs/DESIGN_SYSTEM.md`); `accent`/`success`/`warning`
  remain large-type/dot-only as before.
- The real risk is aesthetic, resolved by on-device preview across the feed,
  a post detail, a form, the map, and the report-sent success.
- Reversible: names are stable, so a future palette change is again a
  values-only swap.

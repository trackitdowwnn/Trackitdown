# Reference spec — Airbnb listing detail page (mobile app)

WHAT: Measured reference spec of Airbnb's listing detail page, from the eight
screenshots in this folder (primary source) plus web research. Every
observation is mapped to our nearest `DESIGN_SYSTEM.md` token; proposed
additions are marked **NEW**.
WHY: The post detail screen (`/post/[id]`) is architected on this page. This
spec is the measurable standard the GAP_ANALYSIS.md compares against.
LINKS: GAP_ANALYSIS.md (sibling); docs/DESIGN_SYSTEM.md;
src/features/vehicles/README.md (our screen's anatomy).

## Sources & conventions

- **Primary:** screenshots `1000013656–1000013670.jpg` (Samsung, 1080×2340 ≈
  360dp logical width @3x; captured 2026-07, UK locale). All dp values below
  are px÷3, read to the nearest 4dp — treat as ±4dp.
- **Caveat:** the screenshots show the **hotel** listing variant ("Choose
  room" flow). Anatomy, rhythm, dividers, amenities, map, reviews, and the
  sticky bar are shared with the canonical homes listing; two sections differ
  and are flagged inline: the **title block** (centred here; left-aligned on
  homes) and the **host block** (absent on hotels; homes has "Meet your
  host"). For those two, homes-pattern knowledge is used at lower confidence.
- **Secondary (context only):** 2025 redesign coverage — softer/curvier
  surfaces, modular components, restrained purposeful motion; design-system
  teardowns — 4pt base grid, weight-only type hierarchy in one family
  (Cereal), depth from photography + whitespace rather than shadows, a single
  high-chroma accent reserved for the primary CTA.
  ([Superdesign breakdown](https://superdesign.dev/blog/airbnb-design-system),
  [It's Nice That on the 2025 app](https://www.itsnicethat.com/articles/airbnb-app-redesign-140525),
  [Summer 2025 update notes](https://medium.com/design-bootcamp/airbnb-summer-2025-update-heres-what-s-new-and-why-it-matters-0ced2338b921))

## 1 — Global page architecture

| Observation | Measured | Nearest token |
|---|---|---|
| One vertical scroll; photo hero first, prose after | — | matches ours |
| Content gutter | 24dp both edges, every section | `spacing.xl` ✅ |
| Section separator | full-width-inset hairline, light grey | `colors.border` + hairline ✅ |
| **Section rhythm** | divider → ~32dp → section title → ~16dp → content → ~32dp → divider | `spacing.xxl` / `spacing.lg` (**ours is 24/8 — see gaps**) |
| Content sheet | white sheet with **large rounded top corners (~24–28dp)** slides up over the hero's bottom edge | `radii.xl` (24) |
| Canvas | pure white; depth via whitespace, near-zero shadows | our `background`/`surface` split is warmer — deliberate palette, keep |
| Accent discipline | ONE high-chroma colour, only on the primary CTA; all else ink + greys | = our accent-reserved-for-bounty rule; monochrome since ADR-0006 (accent is near-black) ✅ |

## 2 — Hero carousel + floating buttons

| Observation | Measured | Nearest token |
|---|---|---|
| Hero height | ~312dp on a 360dp frame ≈ **87% of width**, full-bleed behind status bar | ours `HERO_RATIO 0.85` ✅ (≈match) |
| Paging | horizontal, one photo per page, no partial peek | ✅ matches `PostHero` |
| Counter pill | "1 / 59", dark ~60%-alpha pill, bottom-right, caption-size white text; sits just above the sheet's curved edge | `surfaceInverse` + `typography.caption` ✅ |
| Floating buttons | white circles **~32dp drawn**, dark ~16dp icons; back top-left; share + save top-right, ~8dp gap; ~16dp from edges | ours are 44dp (`sizes.touchTarget`) — **deliberate a11y divergence, keep** |
| Tap on photo | opens full-screen gallery (photo-count pill doubles as affordance) | no analogue yet — note for future |

## 3 — Header, two states

| Observation | Measured | Nearest token |
|---|---|---|
| State A (over hero) | no bar at all — only the floating circle buttons | ✅ matches `AppHeader` |
| State B (scrolled) | solid white bar ≈ **56dp** below status bar; hairline bottom edge | `HEADER_BAR_HEIGHT` 56 ✅ |
| Icon treatment in B | circles dissolve to **flat dark icons on the bar** (cross-fade tied to scroll) | ours keep white circles on the solid bar — see gaps |
| Title in B | **none** — the bar stays icon-only at every scroll depth | ours fades a title in — divergence to judge (wayfinding vs fidelity) |
| Fade behaviour | solidifies over a short scroll range as the sheet edge reaches the bar | ✅ matches our `fadeStart/fadeEnd` approach |

## 4 — Title block (hotel variant: centred; homes: left-aligned)

| Observation | Measured | Nearest token |
|---|---|---|
| Name | ~28dp bold, ink | between our `title` (24) and `display` (32) → map to `title` |
| Kind + place line | ~16dp regular, secondary ("Hotel in Paris, France") | `body` + `textSecondary` ✅ |
| **Stat module** | two cells split by a vertical hairline: big bold number (~18dp) over caption ("4.69 / ★★★★★" \| "188 / Reviews") | no analogue component — candidate pattern for bounty/sightings/days-active stat band |
| Summary paragraph | ~16dp regular secondary, ~4 lines, generous ~1.6 line-height | `body` + `textSecondary` |
| Homes variant caveat | left-aligned title + "rating · reviews · location" meta lines | closer to our current block |

## 5 — Highlights rows (their location/breakfast/métro block; our TrustBlock analogue)

| Observation | Measured | Nearest token |
|---|---|---|
| Row anatomy | leading **~48dp icon tile** (colourful, rounded ~12dp), ~24dp gap, then a text column | `sizes.avatarMd` 48 / `radii.md` |
| Row title | ~18dp semibold ink | `typography.heading` ✅ |
| Row body | ~16/26 regular secondary, 2–4 lines | `body` + `textSecondary` |
| Row spacing | ~32dp vertical between rows | `spacing.xxl` |
| Register | warm-factual: each row is a *reason to believe*, headline + evidence | translate: our rows are verification facts |

## 6 — Amenities ("What this hotel offers"; our FeaturesGrid analogue)

| Observation | Measured | Nearest token |
|---|---|---|
| Section title | ~26dp bold, ink | nearest `typography.title` (24/30) |
| Layout | **single column**, one amenity per row (mobile app; the 2-col grid is web-only) | ours is two-up 47% — see gaps |
| Row anatomy | thin-line icon ~24–28dp in **ink** (not grey), ~24dp gap, label ~18dp regular ink | `sizes.icon` 24; ours uses `iconSm` 18 grey |
| Row height | ~48dp per row (icon centred to first line) | `sizes.touchTarget` as minHeight |
| Overflow | "Show all 22 amenities" **grey block button** (below) | **NEW** Button variant |

## 7 — The grey "show all" block button (recurring pattern)

Appears for amenities, rooms, and reviews — the page's only non-CTA button.

| Observation | Measured | Nearest token |
|---|---|---|
| Fill | flat light grey, no border, no shadow | `surfaceSubtle` (pressed: `surfaceSubtlePressed`) |
| Size | full-width, **~52dp tall**, radius ~12–16dp | `sizes.control` 52 + `radii.md` 12 ✅ |
| Label | ~16dp semibold ink, centred, states the count ("Show all 188 reviews") | `cardTitle` weight at `body` size |
| **Proposed addition** | **NEW: `Button` variant `subtle`** — `surfaceSubtle` fill, `textPrimary` label; unlocks this pattern app-wide | — |

## 8 — About + photo collage

| Observation | Measured | Nearest token |
|---|---|---|
| Section title | ~26dp bold ("About Hôtel Le Richemont") | `typography.title` |
| Body | ~16–18dp regular ink, ~1.6 line-height, no clamp here (homes clamps + "Show more" underlined) | `body`; ReadMore ✅ |
| Collage | 2-col masonry, tiles rounded ~16dp, ~8–12dp gaps; floating white circular gallery button over bottom-right | `radii.lg`, `spacing.sm/md` — future gallery pattern |

## 9 — Location section ("Where you'll be"; our "Last seen here")

| Observation | Measured | Nearest token |
|---|---|---|
| Order | section title → venue name (ink) + full address (secondary) → map | ours: title → map → area caption (below) |
| Map card | gutter-to-gutter, **~340–400dp tall (roughly 4:5 portrait)**, radius ~24dp | ours 180dp tall / `radii.lg` — see gaps; **NEW** `sizes.mapPreview` ≈ 340 (or reuse `mapPickerHeight` 340) |
| Map controls | floating white circles top-right (expand, layers), ~32dp | our whole-card tap has no visible affordance — see gaps |
| Pin | dark custom teardrop, white centre dot | ours: 16dp sage dot — calmer, keep colour, consider teardrop weight |
| Register | anticipatory ("Where you'll be") | ours stays factual ("Last seen here"). SAFETY scope (DOMAIN.md): driveway-theft points coarsened to ~1km for non-owners (they mark the victim's home); other points exact by design — never adopt address-level presentation |

## 10 — Reviews (our analogue: sighting activity, dormant)

| Observation | Measured | Nearest token |
|---|---|---|
| Category chips | outlined pills, radius full, ~48dp tall, leading icon + ~16dp medium label, horizontal scroll | `radii.full`, `label` type |
| Review card | 48dp avatar + name (~18 semibold) + tenure caption; star row + "· 3 weeks ago" caption; underlined context link; body ~18/29 clamped ~4 lines; underlined "Show more" | `avatarMd`, `heading`, `caption`, `body` |
| Card layout | horizontal carousel, vertical hairline between cards, next card peeks | future pattern when sightings ship |
| Overflow | "Show all 188 reviews" grey block button | Button `subtle` (**NEW**) |
| SAFETY translation | never individual sightings to non-owners (SECURITY_AND_TRUST §6) — adopt the *anatomy* for an owner-only timeline; the public line stays an aggregate | — |

## 11 — Things to know + report link

| Observation | Measured | Nearest token |
|---|---|---|
| Rows | leading line icon, bold ~18dp row title + trailing chevron, secondary body lines below, ~40dp between rows | `heading`, `textSecondary` |
| "Report this listing" | flag icon + **underlined** ~16dp semibold ink text, standalone row at page bottom (NOT in the header) | ours puts flag in the header — divergence to judge |

## 12 — Sticky bottom bar

| Observation | Measured | Nearest token |
|---|---|---|
| Structure | white bar, hairline top edge; content row ~64dp + safe area | ours: `surface` + hairline ✅ |
| Left cell | price "**£197 total**" ~18dp bold ink **underlined** (tappable → breakdown) + date range caption below | `heading` + `caption` ✅ ours; underline = tappable-only affordance — do NOT copy onto a non-tappable bounty |
| Right cell | solid high-chroma **pill** (radius full), ~52dp tall, ~46% screen width, ~17dp semibold white label | `sizes.control` 52 ✅; ours uses `radii.md` 12 — pill shape is a judgement call |
| Promo strip | full-width light-grey strip directly above the bar (~44dp) | no analogue — our SafetyNotice is in-scroll; fine |
| Persistence | bar visible from first paint to page bottom, never hides | ✅ matches `PostBottomBar` (post-load, visible posts only — theirs also shows during load) |

## 13 — Motion & interaction summary

- Header solidify: scroll-linked cross-fade (bar fill + hairline + circle→flat
  icon swap), no bounce — ours matches mechanism via Reanimated; add the icon
  cross-fade if adopted.
- Hero paging: plain platform paging, no parallax on the hotel variant.
- All motion restrained and purposeful (2025 language): 200–250ms class
  transitions — matches our `motion.fast/standard` rule.
- Underline = tappable text, everywhere (price, "Show more", "See terms",
  report). A consistent, colour-free link affordance worth adopting for inline
  text actions.

## 14 — Copy register (for translation, never verbatim)

- Warm-factual selling: every section headline is a benefit; body copy is
  concrete evidence ("You're 5 minutes on foot to Olympiades station").
- Numbers carry trust (ratings, review counts, distances) — our equivalents:
  bounty, sighting count, days active, verification facts.
- Our translation duty: their register is **anticipation**; our page serves a
  distressed owner and a helpful spotter. Keep the *headline + evidence*
  structure, swap selling for calm factual reassurance (see GAP_ANALYSIS.md
  "Emotional translation").

## 15 — Proposed token/component additions (consolidated)

| Proposal | Definition | Motivated by |
|---|---|---|
| **Button variant `subtle`** | `surfaceSubtle` fill, `surfaceSubtlePressed` pressed, `textPrimary` label, existing 52dp/`radii.md` geometry | §6, §7, §10 "show all" pattern |
| **`sizes.mapPreview`** | ~340 (or generalise the existing `mapPickerHeight: 340` to a shared name) | §9 large map |
| *(no new type token)* | detail-page section titles map to existing `typography.title` (24/30) | §4, §6, §8 |
| *(no new radius)* | content-sheet top curve maps to `radii.xl` (24) | §1 |

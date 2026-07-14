# Gap analysis — post detail screen vs the Airbnb reference spec

WHAT: Every divergence between our `/post/[id]` screen and REFERENCE_SPEC.md,
grouped, each with current → reference → proposed change → effort (S/M/L) →
visual impact. Ends with the top-3 highest-impact changes and the mandatory
emotional-translation notes.
WHY: The decision document for the redesign build session (Phases 4–6 of
/airbnb-redesign). Research and spec only — no code changed alongside this.
LINKS: REFERENCE_SPEC.md (the standard); src/features/vehicles/README.md
(current anatomy); docs/DESIGN_SYSTEM.md.

**Overall verdict:** the skeleton already matches — hero ratio, header
mechanism, section order, divider system, sticky-bar anatomy and its 52dp CTA
are all within tolerance of the reference. The gap is concentrated in
**scale and air**: our section titles are two tiers small (`heading` 18 →
`title` 24, deliberately bypassing `sectionTitle` 20 — the reference measures
~26dp), our
section rhythm one spacing step too tight, and three mid-page components
(trust rows, features grid, map) are visibly lighter-weight than their
analogues. Closing ~4 small gaps closes most of the distance.

## A — Layout & rhythm

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| A1 | Section vertical rhythm | `paddingVertical: spacing.xl` (24) each side of every divider, `gap: spacing.sm` (8) inside | ~32dp each side, ~16dp title→content | `spacing.xxl` (32) section padding; raise the inside `gap` from `spacing.sm` (8) to `spacing.lg` (16) | **S** | **High** — the single biggest "feel" gap; theirs breathes |
| A2 | Content sheet over hero | body starts flush at the hero's bottom edge, square | white sheet with `radii.xl`-class rounded top corners overlaps the hero's last ~24dp | pull `PostDetailBody` up over the hero with rounded top corners (`radii.xl`, `surface` fill); counter pill sits above the curve | **M** | **High** — signature 2025-Airbnb move, instantly recognisable |
| A3 | Map preview size | `LastSeenMap` 180dp tall, `radii.lg` | gutter-to-gutter ~340–400dp (≈4:5), radius ~24dp | height → **NEW `sizes.mapPreview` 340** (or generalise `mapPickerHeight`), radius → `radii.xl`; keep non-interactive whole-card tap | **S** | **High** — the map is a primary spotter tool; theirs treats location as a headline, ours as a footnote |
| A4 | Features grid columns | two-up rows at `width: '47%'` | single column, one per row, ~48dp row height | single column; `minHeight: sizes.touchTarget` rows | **S** | Medium — reads calmer and resolves long-label squeeze |
| A5 | Title block alignment | left-aligned | centred on the hotel variant; **left on canonical homes** | keep left-aligned (homes-faithful; also better with PlateChip) — note as deliberate | — | — (no change) |

## B — Component anatomy

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| B1 | TrustBlock rows | 18dp toned icon (sage/warning/grey per row tone) + one body line, 8dp row gap | highlight rows: ~48dp icon tile, semibold ~18dp title + 2-line secondary body, ~32dp row gap | promote each trust fact to headline + evidence: tile (`avatarMd` circle, `surfaceSubtle` fill, icon keeping the existing tone semantics), `heading` title, `body`+`textSecondary` evidence line (e.g. "Ownership verified" / "V5C logbook checked before this post went live") | **M** | **High** — turns our strongest trust content into the page's most Airbnb-feeling block |
| B2 | "Show all" overflow pattern | none — sections render everything | grey block button (`surfaceSubtle` fill, 52dp, radius 12, count in label) after amenities/rooms/reviews | **NEW Button variant `subtle`**; use for future photo gallery, long feature lists, owner-only sighting timeline | **S** | Medium now, High later — unlocks a recurring pattern |
| B3 | Header solid-state icons | white circle buttons persist on the solid bar | circles cross-fade to flat dark icons on white | interpolate circle fill/shadow → transparent over the same `fadeStart/fadeEnd` range | **M** | Medium — polish; removes the "sticker on a bar" look |
| B4 | Header title | title fades in when solid | icon-only bar at every depth | **keep our title** (wayfinding on a long page; also our screen has no floating price bar naming the item) — mark **adapted, not matched** | — | — (deliberate) |
| B5 | Flag/report placement | flag icon in the header | "Report this listing" underlined text row at page bottom; header holds share + save only | move report to an underlined text row after the safety notice; header keeps share only | **S** | Medium — declutters the header and matches their trust-page grammar |
| B6 | Bottom-bar CTA shape | `radii.md` (12) | full pill (radius full) | judgement call: pill is shape-language, not trade dress — but every button app-wide is `radii.md`; adopt only via a system-wide decision (/theme-audit), not one-off here | — | — (defer) |
| B7 | Floating button size | 44dp circles (`touchTarget`) | ~32dp drawn circles | **keep 44dp** — accessibility floor beats fidelity; mark deliberate | — | — (deliberate) |
| B8 | Stat module (title block) | status badge + meta caption line | centred bold-number-over-caption cells split by hairlines (rating \| reviews) | optional: bounty \| sightings \| days-active stat band once sightings ship; today numbers are too sparse — defer | L | Low today |
| B9 | Owner block | avatar + two text lines (matches homes host-row scale) | hotels: absent; homes: "Meet your host" card with large avatar | no change now; if sightings/chat ship, revisit as a tappable card | — | — (already adequate) |

## C — Typography & hierarchy

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| C1 | Section titles | `heading` 18/24 SemiBold | ~26dp bold — a full tier larger | detail-page section titles → `typography.title` (24/30); no new token | **S** | **High** — with A1, this IS the Airbnb rhythm: big calm headline, air, content |
| C2 | Feature/detail icons | `iconSm` 18 in `textSecondary` | ~24–28dp thin-line icons in ink | `sizes.icon` 24, `textPrimary` | **S** | Medium — content reads as content, not metadata |
| C3 | Body line-height | 16/24 (1.5) | ~1.6 | within tolerance — keep | — | — |
| C4 | Underline = tappable | already the de facto convention (ReadMore, PhotoGridPicker underline their text actions) but nowhere written down | underline is the universal inline-text-action affordance | formalise the existing convention in DESIGN_SYSTEM.md and apply to new inline text actions (report row); never on non-tappable text (no underlined bounty — ours opens nothing) | **S** | Low–Medium — consistency win |

## D — Interaction & motion

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| D1 | Hero → full gallery | no tap action on photos | tap opens full-screen gallery; count pill signals it | defer until the photo pipeline matures; note as roadmap | L | Medium later |
| D2 | Map affordance | whole-card invisible tap target | visible floating expand button on the map card | add a 28dp white circle (`sizes.circleButtonSm` — its documented purpose is exactly this) with an expand icon, top-right of `LastSeenMap`, pressable padded to `touchTarget` | **S** | Medium — discoverability of an existing feature |
| D3 | Map interactivity | non-interactive preview (deliberate: scroll safety + coarse location) | pannable with layer switcher | **keep ours** — SAFETY + scroll-jank rationale stands; mark deliberate | — | — (deliberate) |
| D4 | Header cross-fade | fill + title fade only | fill + icon-treatment swap | covered by B3 | — | — |

## E — States

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| E1 | Loading | skeleton hero + 4 text lines | (not observable in screenshots; their pattern is progressive image + shimmer) | extend skeleton to cover the new rhythm (trust tiles, map block) when A1/B1 land | **S** | Low — keep parity with the real layout |
| E2 | Error / closed | ErrorState + graceful closed EmptyState | n/a in reference | already stronger than observable reference — keep | — | — |

## F — Copy register

| # | Divergence | Current | Reference | Proposed change | Effort | Impact |
|---|---|---|---|---|---|---|
| F1 | Section headline grammar | noun labels ("Details", "Features", "Theft details") | benefit/context headlines ("What this hotel offers", "Where you'll be") | selectively adopt where register survives translation: "Features" → "What to look for"; keep "Theft details" factual (see translation notes) | **S** | Medium |
| F2 | Trust facts | bare facts ("Ownership verified") | headline + evidence sentence | pair each fact with one calm evidence line (see B1) | **S** | Medium–High |

## Top 3 highest-impact changes

1. **C1 + A1 together — big section titles + 32dp rhythm.** Two `S` changes,
   one shared visual outcome: the page stops reading as a dense record and
   starts reading as the reference's calm, confident scroll. Closes more of
   the gap than everything else combined.
2. **B1 — TrustBlock → highlight-row anatomy.** Our verification story is the
   emotional core of the page (their location/breakfast rows are just
   nice-to-haves — ours answer "is this real, can I trust it?"). Giving it
   the 48dp-tile, headline-plus-evidence treatment upgrades trust itself, not
   just styling.
3. **A3 + D2 — the map becomes a headline.** Spotting is our product's whole
   loop; a 180dp thumbnail undersells it. The ~340dp rounded map with a
   visible expand affordance makes "Last seen here" the working tool it
   should be — while keeping the non-interactive, coarse-location safety
   posture.

*(Runner-up: A2, the rounded content sheet — highest "instantly Airbnb"
recognition per line of code, but it touches the hero/scroll structure, so it
rides behind the safe wins.)*

## Emotional translation — where their register must NOT be copied

| Place | Their register | Our moment | Translation |
|---|---|---|---|
| Price ↔ bounty | "£197 total", underlined, asks for money | the bounty *promises* money for help | keep terracotta + plain statement ("Paid to the spotter whose sighting leads to recovery"); no underline (not tappable), no urgency framing |
| "Where you'll be" ↔ "Last seen here" | anticipation of arrival | last confirmed trace of a stolen car | headline stays factual; never adopt address-level *presentation*. SAFETY scope (DOMAIN.md): driveway-theft points are coarsened to ~1km for non-owners because they mark the victim's home; other last-seen points are served exact by design |
| Reviews ↔ sighting activity | social proof to close a sale | hope (owner) / momentum (spotter) | adopt the anatomy only for an owner-only timeline later; the public surface stays an aggregate count (SECURITY_AND_TRUST §6) |
| Highlights ↔ trust rows | selling the stay | reassuring a theft victim's audience | headline + evidence structure yes; superlatives no — evidence lines are procedural facts ("V5C logbook checked"), not warmth |
| "Things to know" ↔ safety notice | house rules, transactional | "report, don't approach" — the one place we are firm | do NOT soften into their row grammar; SafetyNotice keeps its unmissable banner form (deliberate divergence) |
| Host warmth ↔ owner privacy | "Meet your host", big photo, tenure | owner is a victim; identity is need-to-know | keep de-identified/first-name-only server-gated block; never a photo (DOMAIN.md "Owner identity on a post") |

## Deliberate divergences (keep, with reasons)

- 44dp floating buttons (a11y floor) — B7
- Non-interactive, coarse map preview (safety + scroll) — D3
- Header title fades in (wayfinding; no floating item-name elsewhere) — B4
- SafetyNotice stays a banner, not a "things to know" row — F/translation
- Warm palette, Inter, lucide/Feather icons — hard rule: system, not trade dress
- No underlined bounty (underline = tappable; ours isn't) — C4

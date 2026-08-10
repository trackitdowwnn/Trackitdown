# Design System — Clean, Spacious, Trustworthy

Visual direction: **Airbnb-inspired, monochrome**. Spacious layouts, generous
white space, soft rounded cards, cool near-white surfaces and grey ink with the
primary action and bounty/value both rendered in **near-black** (no brand warm
colour), friendly type — photography carries the colour. The subject matter (car
theft) is stressful — the design's job is to feel calm, capable, and human.
Never alarmist, never "police app" dark-and-red. (Structure follows Airbnb,
2026-07-16, `docs/decisions/ADR-0005-airbnb-orange-theme.md`; the orange/
terracotta accents were swapped to near-black on 2026-07-24 at the owner's
request — semantic status hues kept.)

All values below live as tokens in `src/shared/theme/`. UI code imports
tokens; it never hard-codes hex values, pixel sizes, or font names.

## Colour palette

| Token | Hex | Use |
|---|---|---|
| `background` | `#F7F7F7` | app background — cool near-white (Airbnb page) |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `surfaceSubtle` | `#EEEEEE` | secondary surfaces, chips |
| `surfaceSubtlePressed` | `#E0E0E0` | pressed state of subtle-surface fills |
| `primary` | `#1A1A1A` | soft near-black — primary buttons, links, active states, selection rings/checks (AAA on `background`) |
| `primaryPressed` | `#333333` | pressed/hover state of primary (lightens, since it can't go darker) |
| `accent` | `#1A1A1A` | bounty fills, highlights, badges, large value type — monochrome (shares the near-black; value reads via bold fill + weight) |
| `accentText` | `#1A1A1A` | near-black for bounty label/body-size text (AAA on `background`) |
| `textPrimary` | `#222222` | ink for headings/body |
| `textSecondary` | `#6A6A6A` | captions, metadata |
| `border` | `#DDDDDD` | hairlines, input borders |
| `borderStrong` | `#949494` | small elements that must stay visible (progress tracks) |
| `success` | `#4F8A5B` | affirmative states — recovery confirmed, payout complete, ownership verified (fill/dot/icon, not body text) |
| `warning` | `#A9762A` | pending verification, expiring posts (dot/icon/border only — never body text; clears 3:1 as a graphic) |
| `danger` | `#C0281E` | destructive actions, errors (clear red, kept distinct from the near-black primary) |
| `dangerPressed` | `#A21F16` | pressed state of danger |
| `textOnPrimary` | `#FFFFFF` | text/icons on `primary` and `danger` fills |
| `surfaceInverse` | `#222222` | the surface that is the INVERSE OF THE PAGE — the feed's floating map pill, the selected map pin, the Toast pill. **Flips with the theme** (near-white on dark). Named separately from `textPrimary` so text tweaks never restyle fills |
| `surfaceInversePressed` | `#3A3A3A` | pressed state of `surfaceInverse` |
| `surfaceOverMedia` | `#222222` | chrome sitting on PHOTOGRAPHY — the photo-viewer backdrop and close button, camera counters, the hero photo-count pill, photo-tile status pills. **Identical in both palettes**: a photo is as bright in dark mode as in light, so its chrome must not flip |
| `surfaceOverMediaPressed` | `#3A3A3A` | pressed state of the above |
| `textOnMedia` | `#FFFFFF` | text/icons on `surfaceOverMedia` or over a `mediaScrim` |
| `mediaScrim` | `rgba(0,0,0,0.45)` | a scrim over a PHOTO (gradients behind photo chrome). Unlike `overlay` it does NOT deepen on dark — what's beneath is the photo, whose brightness owes nothing to the theme |
| `overlay` | `rgba(0,0,0,0.45)` | modal scrim |
| `mapZoneFill` | `rgba(26,26,26,0.10)` | the spotter's alert-zone circle on a map — FILL only, never text or a text container's border |
| `mapZoneStroke` | `rgba(26,26,26,0.35)` | that circle's outline |

Rules: near-black `primary` is the action colour — buttons, links, active
states, selection. `accent` (also near-black) is reserved for bounty/value
moments; in the monochrome scheme value stands out through a bold black fill,
weight, and size rather than hue. Danger red appears only on destructive/error
UI — never as decoration on "stolen" content. `success` green and `warning`
amber remain the semantic status hues (not brand colour), so pending/verified
states stay legible. SANCTIONED EXCEPTION (2026-07-30): the sighting arc's
nodes are sage (`success`) — a sighting is affirmative evidence on a hopeful
arc. Two surfaces read that one arc: the sighting timeline's rail nodes and
the OWNER-ONLY trail map's sighting pins (`SightingsTrailMap` — same
evidence, in space). Dots/pins and the recovered-terminal fill only, never
the rail line, the trail line, or entry text.

The two `mapZone*` tokens join `overlay` as the only sanctioned raw rgba in
the palette: the alert-zone circle sits over live map tiles, so its alpha is a
palette decision rather than a component detail, and inline rgba in a
component would put it beyond review. They are derived from `primary` so the
zone reads as "yours", like every other selection ring in the app. Fill and
stroke only — a translucent ink at 10% is nowhere near a text contrast ratio.

### Contrast (WCAG AA on the near-white `#F7F7F7` background)

Every token used as TEXT clears AA (4.5:1). `success` is dot/fill only by
design; `warning` is dot/icon/border only. The near-black `primary`/`accent`
clear AAA both as text and as a fill under white. (Monochrome swap 2026-07-24;
structure per `docs/decisions/ADR-0005-airbnb-orange-theme.md`.)

| Pairing | Ratio | Verdict |
|---|---|---|
| `textPrimary` on `background` | 14.9 | AA |
| `textSecondary` on `background` | 5.1 | AA |
| `primary` (as text) on `background` | 15.3 | AAA |
| `accentText` on `background` | 15.3 | AAA |
| `danger` (as text) on `background` | 5.5 | AA |
| white on `primary` | 16.9 | AAA |
| white on `danger` | 5.9 | AA |
| `success` on `background` | 3.8 | dot only |
| `warning` on `background` | 3.7 | dot/icon only (≥3:1 graphic) |

Never encode status by colour alone: `StatusBadge` always pairs its dot
with a text label (colour-blind-safe).

> **Known gap.** `borderStrong` measures **2.83:1** on `background` (it clears
> 3.03 on `surface`), despite its own token comment claiming ≥3:1 on the
> background. Real and shipped. `#8F8F8F` would clear it. Recorded in
> `src/shared/theme/colors.test.ts`, which fails when it is fixed.

### Dark palette (added 2026-08-09 — `docs/decisions/ADR-0013-dark-mode.md`)

There are now **two** palettes. Components never import `colors` directly; they
take the active one from `useThemedStyles(makeStyles)` or `usePalette()`. See
ADR-0013 for why this had to be a migration rather than a value swap.

Soft charcoal, never true black — the page is `#141414` and cards sit **above**
it, mirroring the light theme's hierarchy rather than flattening it. The
monochrome rule is unchanged but **inverts**: `primary`/`accent` become
near-white and `textOnPrimary` becomes near-black.

| Token | Light | Dark | Dark vs bg | vs surface |
|---|---|---|---|---|
| `background` | `#F7F7F7` | `#141414` | — | — |
| `surface` | `#FFFFFF` | `#1E1E1E` | — | — |
| `surfaceSubtle` | `#EEEEEE` | `#2A2A2A` | — | — |
| `primary` / `accent` / `accentText` | `#1A1A1A` | `#F2F2F2` | 16.5 AAA | 14.9 |
| `primaryPressed` | `#333333` | `#D6D6D6` | — | — |
| `textPrimary` | `#222222` | `#EDEDED` | 15.7 AAA | 14.2 |
| `textSecondary` | `#6A6A6A` | `#A3A3A3` | 7.3 AAA | 6.6 |
| `textOnPrimary` | `#FFFFFF` | `#141414` | 16.5 on `primary` | — |
| `border` | `#DDDDDD` | `#333333` | 1.5 decorative | 1.3 |
| `borderStrong` | `#949494` | `#6E6E6E` | 3.6 ≥3 | 3.3 ≥3 |
| `success` | `#4F8A5B` | `#6FBF7F` | 8.3 | 7.5 |
| `warning` | `#A9762A` | `#E0A64B` | 8.5 | 7.7 |
| `danger` | `#C0281E` | `#F2685C` | 6.1 AA | 5.5 |
| `surfaceInverse` | `#222222` | `#EDEDED` | inverts | — |
| `overlay` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.65)` | — | — |

Semantic hues are **lightened, not reused** — the light values are tuned for
near-white and fall to 2–3:1 on charcoal.

**Two tokens split, and the distinction matters.** `surfaceInverse` means
"inverse of the PAGE" and **flips** (map pins, the map pill — a dark pin on the
dark basemap measures ~1.2:1 and vanishes). The new `surfaceOverMedia` /
`surfaceOverMediaPressed` / `textOnMedia` mean "chrome sitting on PHOTOGRAPHY"
and are **identical in both palettes** — a white close button over a bright
photo is wrong in every theme. `overlay` (scrim over the page, deepens on dark)
splits from the new `mediaScrim` (gradient over a photo, unchanged) the same way.

**Shadows are theme-invariant** — `shadows.ts` casts a literal black, not
`textPrimary`. In dark they barely register, which is correct: elevation there
is carried by the surface ladder, not by shadow.

Contrast is **computed, not asserted**: `src/shared/theme/colors.test.ts`
re-derives every ratio above for both palettes, so changing a value re-checks
the promise rather than updating an expectation.

### Map style

There are two style arrays — `mapStyle` and `mapStyleDark`, chosen by
`mapStyleFor(scheme)`. The dark twin is structurally identical (same features,
same visibility rules) with every colour moved to its dark-palette role; the two
bespoke hues keep their *relationship* rather than their values — parks and
water sit LIGHTER than the land in light mode and DARKER in dark, since a
lighter park on a dark map would read as bright paint.

The Google Map uses a custom light style (`src/shared/theme/mapStyle.ts`),
NOT stock Google colours: land = `surfaceSubtle` light grey, water = a cool
blue-grey, parks a cool green-grey, roads soft, labels quiet, POI/transit
clutter removed — a calm, cool canvas under the pins (near-black `primary`
ink since the 2026-07-24 monochrome swap; the owner trail map's sighting
pins are sage per the sanction above). This is deliberately the opposite of
a busy/alarming crime map.

## Typography

- Font: **Satoshi** (Fontshare, FFL licence — `src/assets/fonts/`; loaded via
  `expo-font` `useFonts` in `src/app/_layout.tsx`; system fallback on load
  error). Adopted 2026-07-23, replacing Inter.
- **Weight is expressed as a FAMILY, never `fontWeight`.** With statically
  loaded faces Android synthesises fake bolds on top of an already-bold face,
  so `typography` tokens set `fontFamily` (`typography.ts` `fontFamilies`).
  Satoshi ships four faces: Regular (400), Medium (500), Bold (700), Black
  (900) — **there is no SemiBold (600) face**, which is why the old 600 tier
  (title/heading/cardTitle) collapses into Bold rather than by accident.
- Scale (size / line height / family):
  - `displayHero` 40/46, Black — **the onboarding headline only** (added
    2026-08-08, from `docs/design-refs/onboarding/`). Onboarding is the one
    surface with a single sentence and a whole screen to say it in: nothing
    competes with it and the reader has not yet been given anything to do.
    A separate role rather than a bigger `display`, because `display` is
    shared with in-page hero numbers (MoneySlider's readout) that must not
    grow with it. Capped at `displayFontScaleCap` (1.3) on every run of the
    headline — the multiplier is not reliably inherited across nested `Text`,
    so an emphasised word left uncapped would outgrow the plain words beside
    it at large dynamic-type settings.
  - `display` 32/38, Black — big moments ("Car recovered 🎉")
  - `title` 24/30, Bold — screen titles
  - `sectionTitle` 20/26, Bold — feed section headers (added 2026-07-11;
    sits between heading and title so scrolling feeds read in clear bands)
  - `heading` 18/24, Bold — in-screen headings
  - `cardTitle` 16/22, Bold — feed-card titles (added 2026-07-11; body
    size at heavier weight, so photos stay the hero of a card)
  - `body` 16/24, Regular — default text
  - `caption` 13/18, Regular — metadata, timestamps
  - `label` 14/18, Medium — buttons, form labels
  - `mapPin` 14/18, Bold — **map-pin bounty pills only** (added 2026-08-07);
    label size one weight up, because a pin fights map tiles and its own
    overlapping neighbours. Capped at `mapPinFontScaleCap` (1.3): uncapped,
    the OS 200% setting doubles every pill and buries the map
  - `tabLabel` 11/14, Medium — **tab-bar item labels only**; the single
    sanctioned size below `caption` (matches platform tab conventions)
  - `plate` 14/18, Black — number-plate chip (below)
- On Android, strip `includeFontPadding` on any text a chip/badge sits beside
  (Satoshi's font box is padded asymmetrically, throwing inline chips off
  optical centre) — see PlateChip and the detail page's title cluster.
- Sentence case everywhere. No ALL CAPS except number plates, which render
  in a plate-style chip (Black weight, `surfaceSubtle` background; no letter
  spacing since 2026-07-23 — Satoshi's tracking already reads plate-like).
- **Underline = tappable** (formalised 2026-07-14; was already the de facto
  convention in ReadMore/PhotoGridPicker): inline text actions are underlined
  `textPrimary` — no colour needed. Never underline non-tappable text.

## Spacing, radii, elevation

- Spacing scale (4pt base): `4, 8, 12, 16, 24, 32, 48`. Screens use 24px
  horizontal padding. Be generous — when in doubt, add space.
  **Exception (approved 2026-07-11): image-led feed surfaces** (the Explore
  home feed and future card grids) use a 16px gutter (`spacing.lg`) so
  photo cards get the width — matching the reference feed pattern. Forms,
  text screens, and settings keep 24px.
- Radii: `sm` 8 (chips), `md` 12 (inputs, buttons), `lg` 16 (cards),
  `xl` 24 (sheets, modals).
- Elevation: soft and subtle only —
  `shadowColor #000000, opacity 0.05, radius 12, offset (0, 4)`. No hard drop
  shadows. The colour is a **literal black, not a token**: a shadow is cast by a
  light source, not by ink, and tying it to `textPrimary` would have turned every
  card shadow into a white glow once ink inverted (ADR-0013). This keeps
  `shadows` theme-invariant. On dark it barely registers, which is correct —
  elevation there is carried by the surface ladder, not by shadow, so anything
  floating over a busy surface (map chrome) needs a `borderStrong` hairline
  instead.

## Core components (live in `src/shared/ui/`)

- **Button** — variants: `primary` (near-black fill), `secondary` (outline),
  `ghost`, `danger`. Height 52, radius `md`, full-width by default.
- **Card** — white surface, radius `lg`, 16px padding, soft shadow. The
  vehicle card (photo, plate chip, make/model, bounty in `primary`,
  distance, last-seen time) is the app's signature element — Airbnb-listing
  style with a large image and breathing room.
- **PlateChip** — renders a UK registration in plate styling. **Interactive:**
  long-press copies the plate (light haptic + "Plate copied" toast); a screen
  reader gets the same via a "Copy plate" action. Because it is a `Pressable`
  it becomes the touch responder for its own bounds, so **any tappable row or
  card containing one MUST forward its own press** via the required
  `onPress` prop — pass an explicit `null` only when nothing tappable encloses
  it. A chip left without a handler inside a card turns the plate into a dead
  patch that swallows the card's tap.
- **BountyTag** — `primary`, e.g. "£500 bounty", always formatted from
  pence via the shared money formatter.
- **SafetyNotice** — reusable banner with the "report, don't approach"
  copy; required on sighting flows (see SECURITY_AND_TRUST.md). Passing
  `collapsible` pins it as a single titled line that expands on tap — for
  surfaces where it sits above LIVE content for a whole session (chat) rather
  than being read once in a flow, where full height cost ~100dp of every
  thread. It is never dismissible in either form, keeps `role="alert"`, and
  its accessibility label is the complete title + body whether open or shut,
  so the shrink is visual only. Chat is the only sanctioned consumer.
- **ListRow** — the settings-style row: optional icon, title, optional
  value/subtitle, chevron when pressable, destructive variant. Passing
  `selected` turns it into a **chooser** row: the chevron becomes a check (an
  equal-sized spacer when unselected, so titles don't shift down the list) and
  the role becomes `radio` rather than `button` — "radio, selected" reads as
  one-of-several, where "button, selected" reads as a toggle that is on. Rows
  in a group where nothing is chosen yet pass `selected={false}`, never
  `undefined`, so the set stays a radio group to a screen reader.
- **EmptyState** — friendly illustration + one-line explanation + action.
- **AppTabBar** — bottom navigation: `surface` bar, hairline `border` top
  edge, no shadow; 24pt icons (`sizes.icon`) over always-visible `tabLabel`
  text; active `primary`, inactive `textSecondary`; badges in `accentText`
  terracotta (dot or 1–9/"9+" pill) — a sanctioned exception to the value-only
  accent rule (an accentText badge stays distinct from the near-black primary and
  needs no per-component override). Bar body is `sizes.tabBar` (56) tall
  plus safe area; press feedback is a subtle scale (`motion.tabPressScale`).
  The Profile tab is the one sanctioned photo tab: a signed-in member's
  avatar (`sizes.tabAvatar`, 26pt circle) replaces the icon, active state is
  a 2pt `primary` ring (`sizes.tabAvatarRing`, photos can't tint) plus the
  usual label tint, and the label reads "You"; every tab's glyph centres in
  the shared `sizes.tabIconSlot` (34) so labels stay aligned. A failed
  avatar load falls back to the person icon.

## Screen conventions

- Map screens: light map style (muted natural tones), custom `primary` pins;
  selected pin grows and shows a floating vehicle card, Airbnb-style.
  - **EVERY marker carries its price (2026-08-07).** One appearance: a white
    £ pill with a hairline border; the selected one inverts to
    `surfaceInverse` and grows. There is no quiet tier.
    - **Never ship a price-less map marker.** A marker with no price on it
      reads as a GROUP — there is nothing else it could be saying — so a
      "demoted" pin quietly claims to be several cars. We shipped one for a
      day (top-12-only pricing, borrowed from the reference) and it was
      reported as "grouping" four separate times. The ink argument for it was
      sound and beside the point.
    - Overlapping pills are FINE where overlapping dots were not: a pill has
      an edge and a number, so a pile of them still reads as a pile of prices.
      The reference does exactly this (`docs/design-refs/map/`, shot 2 has
      four pills piled together). Markers that would stack are LEFT to stack:
      a marker is always drawn on its car. Spreading them apart was tried on
      2026-08-07 and reverted the same day — a constant on-screen gap needs a
      ground offset that grows with the zoom, so the markers visibly slid
      across the map every time the camera settled. Markers that move are
      worse than markers that overlap.
    - Pill text is `typography.mapPin` (label-size, one weight up): a pin
      fights map tiles and its own overlapping neighbours, and going up a
      *size* instead would turn a dense area into a wall of type.
    - **One deliberate divergence from the reference**: its pill is
      borderless, ours keeps a hairline. Forced by our map style — the pill
      barely separates from the land by fill in either theme (1.16:1 light,
      1.09:1 dark), so the edge is what makes it a pill rather than floating
      text. The hairline is `borderStrong`, not `border` (2026-08-10): dark
      mode darkened the land, `border` measured 1.08:1 against it, and
      `shadows` casts a literal black that contributes nothing on dark tiles —
      so the pill lost every edge at once. `borderStrong` is 3.55:1 on the dark
      land and 2.61:1 on the light one, which also fixes light, where the old
      hairline was 1.17:1 and the shadow was carrying it alone. The same rule
      applies to every floating map control (`MapCircleButton`,
      `MapSearchPill`).
    - Bounty rank still decides **paint order** (highest on top, so a tap in a
      crowd lands on the car worth tapping) and **how many markers stay in the
      assistive-tech tree** — the drawn set and the reachable set deliberately
      differ, because a screen reader should not swipe past a hundred markers
      when the sheet lists every car with more detail.
  - **Floating CONTROLS over map tiles use `shadows.lifted`** (back, recentre,
    search pill, map pill) — they must hold an edge against busy tiles.
    **MARKERS keep `shadows.soft`**: they are content, not chrome, and
    `lifted`'s `elevation: 10` on forty-plus Android markers is both muddy and
    expensive.
  - **Anything that frames the camera must inset for that chrome.** A result
    centred behind the sheet may as well not exist. Where a sheet can be
    dragged, the inset tracks it and the camera zooms to match, so the same
    ground stays on screen however much of it is left (2026-08-06).
- **Filling wizard steps** (`WizardStep.fills`, added 2026-07-31). A step whose
  body IS the answer — today the two map steps — opts in and gets a plain flex
  container instead of the usual `ScrollView`, so a `flex: 1` child reaches the
  footer. It also takes a compact headline (`title`, not `display`) and **no
  helper line**: on such a step every line of copy comes straight out of the
  thing the user came to use. Three rules travel with it:
  - **The flex chain must be unbroken** — fills container → step body → the
    step's own wrapper → the map. One `View` without `flex` anywhere along it
    and the child silently falls back to its `minHeight`, which reads as
    "nearly right" rather than as a bug. `WizardScreen.test.tsx` guards each
    link.
  - **No slide transition.** A full-bleed map sliding reads as the whole app
    moving; and a fills step that swaps its subtree after mount strands the
    entering transform, leaving the step permanently offset.
  - **It stops filling above 1.3× text scale** and scrolls instead. A fills step
    has no scroll rescue, so at accessibility text sizes content would run off a
    container that cannot scroll. Big text beats the full-bleed map.
- **Rounded map cards on Android.** `react-native-maps` draws into a
  `SurfaceView` that misrenders when an ancestor clips it (`overflow: 'hidden'`
  + `borderRadius`) — historically black, and on RN 0.86 the map draws OFFSET
  inside its card. The interactive picker therefore rounds its corners by
  COVERING them (`MapCornerMask`) rather than clipping.
  ⚠️ **Open question**: the three static map cards (`LastSeenMap`,
  `SightingsTrailMap`, `SightingDetailScreen`) still clip on both platforms and
  are believed fine — possibly because they pass `interactive={false}`, so the
  SurfaceView never handles a gesture. Nobody has checked all four on a device.
  Until someone does, do not unify by copying either treatment onto the other.
- Forms: one topic per screen step (the posting flow is a stepper —
  car details → photos → last seen → bounty → verification), progress
  shown, big touch targets, inline validation.
- Loading: skeleton placeholders in `surfaceSubtle`, no spinners on lists.
  Blocking waits show ONE face — `BrandLoader` (wordmark + a rotating waiting
  phrase), rendered by both the cold-start splash and `FullscreenLoader`. The
  phrase is lit by a highlight sweeping left to right through its letters
  (`motion.loaderShimmer`, 700ms), above a small `ActivityIndicator`. Both,
  deliberately: the splash usually lifts inside 500ms, and in a glimpse that
  short the spinner is the part that reads, while the sweep is what makes the
  wait feel like this app rather than any app. **Do not lengthen the sweep for
  calm** — it shipped at 1800ms on 2026-08-06 and never completed a third of a
  pass before the screen was gone, which is an animation nobody ever sees.
  The sweep's resting colour is `textSecondary` and must not go lighter: it is
  the lightest text colour clearing WCAG AA on the background (~4.9:1), and
  the waiting phrase is content, not decoration. Under reduced motion the
  sweep is dropped and the line renders still.
- Profile surfaces (2026-07-16, docs/design-refs/profile/REFERENCE_SPEC.md):
  the identity hero/passport card is the ONE elevated object on its screen
  (`surface`, `radii.xl`, soft shadow, `sizes.avatarXl` avatar); counters
  render as value-over-caption stat rows with hairlines between; settings
  groups take `heading`-scale titles with hairline dividers between rows;
  sign-out is underlined text (underline = tappable), account deletion stays
  a findable-but-quiet muted-danger action on the root. The trusted-spotter
  avatar chip fills with `primary` as a STATUS mark — a sanctioned exception
  to the actions-only rule (it mirrors the reference's verification badge
  and stays distinct from any nearby CTA).
- Accessibility: minimum 44pt touch targets, WCAG AA contrast against the
  near-white background (check `primary` and `accentText` on `#F7F7F7`), labels on all interactive
  elements, support dynamic type.

## Motion

Calm and continuity-focused, never spectacle (Airbnb's restraint). Tokens
live in `src/shared/theme/motion.ts` (durations + springs) and
`src/shared/theme/motionEasing.ts` (easings — imported directly, not via the
barrel, since it pulls in Reanimated).

- **Durations:** `instant` 0 (reduced-motion fallback) · `fast` 200 (micro:
  fades, press, label floats) · `standard` 250 (screen-scale: sheets, slides)
  · `slow` 300 (hero continuity). Map camera moves are sanctioned exceptions
  (`mapFly` 500 / `mapPan` 350).
- **Easing:** one deceleration curve — `easeOut` — for enters and most timing
  (from `motionEasing.ts`). `easeIn` (exits) / `easeInOut` (reversible moves)
  are added there when a consumer needs one. No ad-hoc quad/cubic mix.
- **Springs (three feels, one source):** `springGentle` (critically damped,
  zero wobble) — the sanctioned default for calm owner-facing motion;
  `springStandard` (a hair of life) for touch feedback and floating surfaces
  (e.g. the map peek card); `springBouncy` (one soft overshoot) reserved for
  **success/reward moments only** (report-sent, recovery) — the one place
  warmth shows.
- **Navigation:** platform-native — iOS horizontal push + swipe-back, Android
  fade-through; the report-sighting wizard presents from the bottom; the
  post-detail hero uses a subtle cross-fade + scale-from-0.94 for card→detail
  continuity (not a full shared element).
- **Lists:** on-screen rows enter with a small staggered `FadeInDown`
  (≤~300ms total); recycled/off-screen cells don't animate.
- **Reduced motion (part of the system, not a footnote):** every animated
  component reads `useReducedMotion()`, and layout entrances pass
  `ReduceMotion.System`. When reduced, large translations/scales collapse to a
  fade or `instant`; state feedback is preserved. Satisfies WCAG 2.3.3.

## Tone of voice (microcopy)

Calm, human, direct. "We'll notify people nearby" not "ALERT DISPATCHED".
Empathy at the start ("Sorry this happened — let's get the details"),
clarity in the middle, warmth at the end. Safety copy is the one place we
are firm and unmissable.

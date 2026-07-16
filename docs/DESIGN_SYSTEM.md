# Design System — Clean, Spacious, Trustworthy

Visual direction: **Airbnb-inspired**. Spacious layouts, generous white
space, soft rounded cards, cool near-white surfaces and grey ink with ONE
vivid accent (orange) used sparingly, friendly type — photography carries
the colour. The subject matter (car theft) is stressful — the design's job
is to feel calm, capable, and human. Never alarmist, never "police app"
dark-and-red. (Palette redirected to Airbnb's structure with an orange
accent, 2026-07-16 — see `docs/decisions/ADR-0005-airbnb-orange-theme.md`.)

All values below live as tokens in `src/shared/theme/`. UI code imports
tokens; it never hard-codes hex values, pixel sizes, or font names.

## Colour palette

| Token | Hex | Use |
|---|---|---|
| `background` | `#F7F7F7` | app background — cool near-white (Airbnb page) |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `surfaceSubtle` | `#EEEEEE` | secondary surfaces, chips |
| `surfaceSubtlePressed` | `#E0E0E0` | pressed state of subtle-surface fills |
| `primary` | `#C2410C` | deep Arches orange — primary buttons, links, active states (the ONE vivid accent; AA at label size on `background`) |
| `primaryPressed` | `#A8380A` | pressed/hover state of primary |
| `accent` | `#C97B5D` | terracotta — bounty fills, highlights, badges, large type (the sole warm colour; reserved for value) |
| `accentText` | `#A05A3B` | terracotta for bounty label/body-size text (AA on `background`) |
| `textPrimary` | `#222222` | ink for headings/body |
| `textSecondary` | `#6A6A6A` | captions, metadata |
| `border` | `#DDDDDD` | hairlines, input borders |
| `borderStrong` | `#949494` | small elements that must stay visible (progress tracks) |
| `success` | `#4F8A5B` | affirmative states — recovery confirmed, payout complete, ownership verified (fill/dot/icon, not body text) |
| `warning` | `#A9762A` | pending verification, expiring posts (dot/icon/border only — never body text; clears 3:1 as a graphic) |
| `danger` | `#C0281E` | destructive actions, errors (clear red, kept distinct from the orange primary) |
| `dangerPressed` | `#A21F16` | pressed state of danger |
| `textOnPrimary` | `#FFFFFF` | text/icons on `primary` and `danger` fills |
| `surfaceInverse` | `#222222` | the rare dark surface: floating (map pill) and the ONE full-bleed use, the photo-preview viewer backdrop — same ink as `textPrimary`, named separately so text tweaks never restyle fills |
| `surfaceInversePressed` | `#3A3A3A` | pressed state of `surfaceInverse` |
| `overlay` | `rgba(0,0,0,0.45)` | modal scrim |

Rules: orange `primary` is the single vivid accent — actions only (buttons,
links, active states). The terracotta accent is the sole warm colour and is
reserved for bounty/value moments so it keeps its meaning and stands out
against the orange. Danger red appears only on destructive/error UI (and is
kept a distinct red so it never reads as the orange CTA) — never as
decoration on "stolen" content.

### Contrast (WCAG AA on the near-white `#F7F7F7` background)

Every token used as TEXT clears AA (4.5:1). `accent` and `success` are
large-type/fill/dot only by design; `warning` is dot/icon/border only.
(Redirected 2026-07-16 — see `docs/decisions/ADR-0005-airbnb-orange-theme.md`.)

| Pairing | Ratio | Verdict |
|---|---|---|
| `textPrimary` on `background` | 14.9 | AA |
| `textSecondary` on `background` | 5.1 | AA |
| `primary` (as text) on `background` | 4.8 | AA |
| `accentText` on `background` | 4.9 | AA |
| `danger` (as text) on `background` | 5.5 | AA |
| white on `primary` | 5.2 | AA |
| white on `danger` | 5.9 | AA |
| `accent` on `background` | 3.0 | large/fill only |
| `success` on `background` | 3.8 | dot only |
| `warning` on `background` | 3.7 | dot/icon only (≥3:1 graphic) |

Never encode status by colour alone: `StatusBadge` always pairs its dot
with a text label (colour-blind-safe).

### Map style

The Google Map uses a custom light style (`src/shared/theme/mapStyle.ts`),
NOT stock Google colours: land = `surfaceSubtle` light grey, water = a cool
blue-grey, parks a cool green-grey, roads soft, labels quiet, POI/transit
clutter removed — a calm, cool canvas under the on-brand pins (orange
cluster, terracotta amount). This is deliberately the opposite of a
busy/alarming crime map.

## Typography

- Font: **Inter** (via `@expo-google-fonts/inter`); system fallback.
- Scale (size / line height / weight):
  - `display` 32/38, Bold — big moments ("Car recovered 🎉")
  - `title` 24/30, SemiBold — screen titles
  - `sectionTitle` 20/26, SemiBold — feed section headers (added 2026-07-11;
    sits between heading and title so scrolling feeds read in clear bands)
  - `heading` 18/24, SemiBold — in-screen headings
  - `cardTitle` 16/22, SemiBold — feed-card titles (added 2026-07-11; body
    size at semibold weight, so photos stay the hero of a card)
  - `body` 16/24, Regular — default text
  - `caption` 13/18, Regular — metadata, timestamps
  - `label` 14/18, Medium — buttons, form labels
  - `tabLabel` 11/14, Medium — **tab-bar item labels only**; the single
    sanctioned size below `caption` (matches platform tab conventions)
- Sentence case everywhere. No ALL CAPS except number plates, which render
  in a plate-style chip (bold, letter-spaced, `surfaceSubtle` background).
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
  `shadowColor #222222 (textPrimary), opacity 0.06, radius 12, offset (0, 4)`.
  No hard drop shadows.

## Core components (live in `src/shared/ui/`)

- **Button** — variants: `primary` (orange fill), `secondary` (outline),
  `ghost`, `danger`. Height 52, radius `md`, full-width by default.
- **Card** — white surface, radius `lg`, 16px padding, soft shadow. The
  vehicle card (photo, plate chip, make/model, bounty in terracotta,
  distance, last-seen time) is the app's signature element — Airbnb-listing
  style with a large image and breathing room.
- **PlateChip** — renders a UK registration in plate styling.
- **BountyTag** — terracotta, e.g. "£500 bounty", always formatted from
  pence via the shared money formatter.
- **SafetyNotice** — reusable banner with the "report, don't approach"
  copy; required on sighting flows (see SECURITY_AND_TRUST.md).
- **EmptyState** — friendly illustration + one-line explanation + action.
- **AppTabBar** — bottom navigation: `surface` bar, hairline `border` top
  edge, no shadow; 24pt icons (`sizes.icon`) over always-visible `tabLabel`
  text; active `primary`, inactive `textSecondary`; badges in `accentText`
  terracotta (dot or 1–9/"9+" pill) — a sanctioned exception to the value-only
  accent rule (a terracotta badge stays distinct from the orange primary and
  needs no per-component override). Bar body is `sizes.tabBar` (56) tall
  plus safe area; press feedback is a subtle scale (`motion.tabPressScale`).

## Screen conventions

- Map screens: light map style (muted natural tones), custom orange pins;
  selected pin grows and shows a floating vehicle card, Airbnb-style.
- Forms: one topic per screen step (the posting flow is a stepper —
  car details → photos → last seen → bounty → verification), progress
  shown, big touch targets, inline validation.
- Loading: skeleton placeholders in `surfaceSubtle`, no spinners on lists.
- Accessibility: minimum 44pt touch targets, WCAG AA contrast against the
  near-white background (check orange/terracotta on `#F7F7F7`), labels on all interactive
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

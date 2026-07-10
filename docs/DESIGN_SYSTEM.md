# Design System — Warm, Spacious, Trustworthy

Visual direction: **Airbnb-inspired**. Spacious layouts, generous white
space, soft rounded cards, warm light natural colours, friendly type.
The subject matter (car theft) is stressful — the design's job is to feel
calm, capable, and human. Never alarmist, never "police app" dark-and-red.

All values below live as tokens in `src/shared/theme/`. UI code imports
tokens; it never hard-codes hex values, pixel sizes, or font names.

## Colour palette

| Token | Hex | Use |
|---|---|---|
| `background` | `#FAF7F2` | app background — warm off-white |
| `surface` | `#FFFFFF` | cards, sheets, inputs |
| `surfaceSubtle` | `#F3EEE6` | secondary surfaces, chips |
| `surfaceSubtlePressed` | `#E9E2D5` | pressed state of subtle-surface fills |
| `primary` | `#5B755D` | sage green — primary buttons, links, active states (AA at label size on `background`) |
| `primaryPressed` | `#4C634E` | pressed/hover state of primary |
| `accent` | `#C97B5D` | terracotta — bounty fills, highlights, badges, large type |
| `accentText` | `#A05A3B` | terracotta for label/body-size text (AA on `background`) |
| `textPrimary` | `#2B2926` | warm near-black for headings/body |
| `textSecondary` | `#6F6A62` | captions, metadata |
| `border` | `#E7E0D6` | hairlines, input borders |
| `borderStrong` | `#B8AE9E` | small elements that must stay visible (progress tracks) |
| `success` | `#4F8A5B` | recovery confirmed, payout complete |
| `warning` | `#C9973B` | pending verification, expiring posts |
| `danger` | `#B4553F` | destructive actions, errors (muted, not alarm-red) |
| `dangerPressed` | `#96462F` | pressed state of danger |
| `textOnPrimary` | `#FFFFFF` | text/icons on `primary` and `danger` fills |
| `overlay` | `rgba(43,41,38,0.45)` | modal scrim |

Rules: the accent terracotta is reserved for bounty/value moments so it
keeps its meaning. Danger red appears only on destructive/error UI — never
as decoration on "stolen" content.

## Typography

- Font: **Inter** (via `@expo-google-fonts/inter`); system fallback.
- Scale (size / line height / weight):
  - `display` 32/38, Bold — big moments ("Car recovered 🎉")
  - `title` 24/30, SemiBold — screen titles
  - `heading` 18/24, SemiBold — card titles, section heads
  - `body` 16/24, Regular — default text
  - `caption` 13/18, Regular — metadata, timestamps
  - `label` 14/18, Medium — buttons, form labels
  - `tabLabel` 11/14, Medium — **tab-bar item labels only**; the single
    sanctioned size below `caption` (matches platform tab conventions)
- Sentence case everywhere. No ALL CAPS except number plates, which render
  in a plate-style chip (bold, letter-spaced, `surfaceSubtle` background).

## Spacing, radii, elevation

- Spacing scale (4pt base): `4, 8, 12, 16, 24, 32, 48`. Screens use 24px
  horizontal padding. Be generous — when in doubt, add space.
- Radii: `sm` 8 (chips), `md` 12 (inputs, buttons), `lg` 16 (cards),
  `xl` 24 (sheets, modals).
- Elevation: soft and subtle only —
  `shadowColor #2B2926, opacity 0.06, radius 12, offset (0, 4)`.
  No hard drop shadows.

## Core components (live in `src/shared/ui/`)

- **Button** — variants: `primary` (sage fill), `secondary` (outline),
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
  terracotta (dot or 1–9/"9+" pill). Bar body is `sizes.tabBar` (56) tall
  plus safe area; press feedback is a subtle scale (`motion.tabPressScale`).

## Screen conventions

- Map screens: light map style (muted natural tones), custom sage pins;
  selected pin grows and shows a floating vehicle card, Airbnb-style.
- Forms: one topic per screen step (the posting flow is a stepper —
  car details → photos → last seen → bounty → verification), progress
  shown, big touch targets, inline validation.
- Loading: skeleton placeholders in `surfaceSubtle`, no spinners on lists.
- Motion: 200–250ms ease-out; subtle scale on card press (0.98).
- Accessibility: minimum 44pt touch targets, WCAG AA contrast against the
  warm background (check greens on `#FAF7F2`), labels on all interactive
  elements, support dynamic type.

## Tone of voice (microcopy)

Calm, human, direct. "We'll notify people nearby" not "ALERT DISPATCHED".
Empathy at the start ("Sorry this happened — let's get the details"),
clarity in the middle, warmth at the end. Safety copy is the one place we
are firm and unmissable.

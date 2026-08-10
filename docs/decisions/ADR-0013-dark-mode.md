# ADR-0013 — Dark mode: soft charcoal, three-way preference

**Status:** accepted · **Date:** 2026-08-09 · **Extends:** [ADR-0006](ADR-0006-monochrome-theme.md)

## Context

The app has shipped light-only since inception. `src/shared/theme/colors.ts`
held a **single** palette, and on 2026-08-09 three things were deliberately
pinned to light after a real defect: reading the device colour scheme restyled
only the chrome we *don't* paint — react-navigation's background and the status
bar — so a dark-mode device got **white status-bar icons on a `#F7F7F7`
background**. The clock and battery were invisible. The note left in
`src/app/_layout.tsx` said "Revisit all three together if real dark mode ever
lands." This is that revisit.

Three owner decisions were confirmed before implementing:

1. **Three-way preference** — System / Light / Dark, defaulting to System,
   persisted, surfaced in Profile → Settings. Not OS-following only: someone
   who wants a light app on a dark phone should get one.
2. **Soft charcoal, not true black.** The design system's opening line is
   *"never alarmist, never 'police app' dark-and-red"*, and a pure `#000` page
   with maximum-contrast ink is precisely that app.
3. **One pass, no partial rollout.** A half-migrated app flashes white on
   whichever screens were missed, which reads as broken rather than unfinished.

## Decision

### Why this was a migration and not a value swap

ADR-0005 and ADR-0006 were both *value swaps*: token names stayed, so the whole
app cascaded for free. **This one could not be**, and the reason is worth
recording because it is not obvious.

`StyleSheet.create({ color: colors.textPrimary })` at module scope copies the
hex **string** at the moment the module first evaluates. Nothing later can reach
it — not mutating the palette object, not remounting the tree, because the sheet
was built at *import* time, not at mount. **126 files** held colours that way
(678 references), plus a handful of module-level plain objects with the same
freeze (`Button`'s `VARIANT_STYLES`, `StatusBadge`'s tables,
`centerRowMeta.ts`).

So each of those files defers its style build:

```ts
const makeStyles = (c: Palette) =>
  StyleSheet.create({ card: { backgroundColor: c.surface } });

export function Card() {
  const styles = useThemedStyles(makeStyles);
```

Alternatives ruled out, all for cause: `DynamicColorIOS`/`PlatformColor` is
iOS-only, returns an opaque native object that Reanimated's `interpolateColor`,
the Google Maps style JSON and our own contrast tests cannot read, and follows
the OS only — so it cannot serve a manual override. A root `key` remount and
in-place palette mutation both fail on the module-evaluation point above.

### The dark palette

Soft charcoal with an elevated surface ladder mirroring the light theme's
(page darkest, cards a step up, chips a step up again).

**The inversion:** `primary`/`accent` become near-**white** and `textOnPrimary`
becomes near-**black**. ADR-0006's monochrome rule is unchanged — one accent,
photography carries the colour — it simply flips. Pressed states flip with it:
light's `primary` lightens on press because it cannot go darker; dark's darkens
because it cannot go lighter.

| Token | Light | Dark | vs bg | vs surface |
|---|---|---|---|---|
| `background` | `#F7F7F7` | `#141414` | — | — |
| `surface` | `#FFFFFF` | `#1E1E1E` | — | — |
| `surfaceSubtle` | `#EEEEEE` | `#2A2A2A` | — | — |
| `surfaceSubtlePressed` | `#E0E0E0` | `#363636` | — | — |
| `primary` | `#1A1A1A` | `#F2F2F2` | 16.5 AAA | 14.9 |
| `primaryPressed` | `#333333` | `#D6D6D6` | — | — |
| `accent` / `accentText` | `#1A1A1A` | `#F2F2F2` | 16.5 AAA | 14.9 |
| `textPrimary` | `#222222` | `#EDEDED` | 15.7 AAA | 14.2 |
| `textSecondary` | `#6A6A6A` | `#A3A3A3` | 7.3 AAA | 6.6 |
| `textOnPrimary` | `#FFFFFF` | `#141414` | 16.5 on `primary` | — |
| `border` | `#DDDDDD` | `#333333` | 1.5 decorative | 1.3 |
| `borderStrong` | `#949494` | `#6E6E6E` | 3.6 ≥3 | 3.3 ≥3 |
| `success` | `#4F8A5B` | `#6FBF7F` | 8.3 | 7.5 |
| `warning` | `#A9762A` | `#E0A64B` | 8.5 | 7.7 |
| `danger` | `#C0281E` | `#F2685C` | 6.1 AA | 5.5 |
| `dangerPressed` | `#A21F16` | `#D9544A` | — | — |
| `surfaceInverse` | `#222222` | `#EDEDED` | inverts — see below | |
| `surfaceInversePressed` | `#3A3A3A` | `#CFCFCF` | — | — |
| `overlay` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.65)` | deepened | |
| `mapZoneFill` | `rgba(26,26,26,0.10)` | `rgba(242,242,242,0.12)` | ink inverts | |
| `mapZoneStroke` | `rgba(26,26,26,0.35)` | `rgba(242,242,242,0.40)` | | |

Semantic hues are **lightened, not reused**: `#4F8A5B` / `#A9762A` / `#C0281E`
are tuned to sit on near-white and fall to 2–3:1 on charcoal.

### One token split into two

`surfaceInverse` was doing two incompatible jobs, and a dark page exposed it:

- **"Inverse of the page"** — the map pill, the map pins. These must **flip**.
  A dark pin bubble on the dark basemap measures ~1.2:1 and simply vanishes.
- **"Chrome sitting on photography"** — the photo viewer's close button, the
  camera counter, the hero photo-count pill. These must **stay dark in both
  schemes**. A white close button over a bright photo is wrong in every theme.

So `surfaceInverse` keeps the first meaning and flips, and a new
`surfaceOverMedia` / `surfaceOverMediaPressed` / `textOnMedia` trio holds the
second and is **identical in both palettes**. `overlay` splits the same way:
it now means "scrim over the page" (and deepens on dark), while the new
`mediaScrim` covers gradients over photos and does not change.

### Shadows decoupled from ink

`shadows.ts` used `shadowColor: colors.textPrimary`. A shadow is cast by a light
source, not by ink — and that coupling would have turned every card shadow into
a white glow once ink inverted. It is now a literal `#000000` with opacity
nudged `0.06 → 0.05` and `0.18 → 0.16` so light mode is visually unchanged.

Keeping `shadows` **theme-invariant** has a large knock-on benefit: every one of
the ~126 style factories takes a single `(c: Palette)` argument rather than a
whole theme object. In dark mode the shadows barely register, which is correct —
elevation there is carried by the surface ladder, not by shadow.

### Preference resolution

One source of truth. The preference is pushed into `Appearance.setColorScheme()`
(`'system'` → `'unspecified'`), and the **effective** scheme is read back via
`useColorScheme()`. We never branch on the preference directly to pick colours.
That keeps our palette and the OS-drawn chrome we don't paint — keyboards,
alerts, native pickers — in agreement, which is exactly what was wrong before.

`setColorScheme` does **not** persist across launches, so the stored preference
is re-applied on every boot.

### Architecture note: the barrel must stay pure

`ThemeProvider` and `themePreferenceStorage` are **not** exported from
`src/shared/theme/index.ts`. They reach AsyncStorage and Appearance, and the
barrel is imported by ~139 source files and nearly every test — exporting them
made **91 suites fail to load** with "NativeModule: AsyncStorage is null".
Contexts and hooks live in the side-effect-free `paletteContext.tsx`; the
provider is imported by `src/app/_layout.tsx` alone.

Relatedly, the palette context **defaults to the light palette** rather than
null. That is what lets ~108 test files keep rendering components bare with no
provider and no edits — the same reasoning as `useOptionalToast`.

## Consequences

- **A new native binary is required.** `app.json` `userInterfaceStyle` moves
  `"light"` → `"automatic"`, which cannot change at runtime.
- **The cold-start splash follows the DEVICE, not the preference.** A user who
  picks Dark on a light phone gets a light splash for the moment before JS
  boots. Native splashes cannot see an in-app preference; accepted.
- The splash gains a `dark` variant (`#141414`). The splash image is still the
  Expo template's white mark — invisible on the light splash today and
  accidentally visible on the dark one. Unchanged here; tracked with the other
  placeholder art (`BrandLoader`'s `TODO(art)`).
- **Known gap, recorded not fixed:** light `borderStrong` (`#949494`) measures
  **2.83:1** on `#F7F7F7`, while `colors.ts` describes it as "≥3:1 on the
  background". Real, shipped, and not introduced here — found by pointing the
  new computed contrast test at the existing palette. `#8F8F8F` would clear it
  (3.02). Not changed under a dark-mode ADR because it would silently restyle
  every wizard progress track and sparkline in the app. Pinned by a test in
  `src/shared/theme/colors.test.ts` that fails the moment it is fixed.
- Contrast is now **computed, not asserted**: `colors.test.ts` re-derives every
  ratio in this table for both palettes, so changing a value re-checks the
  promise instead of updating an expectation.

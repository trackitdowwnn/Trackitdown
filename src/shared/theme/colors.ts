/**
 * WHAT:  Colour tokens for the app, straight from docs/DESIGN_SYSTEM.md.
 * WHY:   UI code imports these names and never hard-codes hex values, so a
 *        palette change happens in one place and stays on-brand. MONOCHROME
 *        scheme (2026-07-24): cool near-white surfaces + grey ink, the primary
 *        action + bounty/value both rendered in near-BLACK (the previous Arches
 *        orange / terracotta warmth was dropped at the owner's request);
 *        semantic status hues (success/warning/danger) stay distinct;
 *        photography carries the colour.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour palette);
 *        docs/decisions/ADR-0005-airbnb-orange-theme.md (the superseded
 *          orange theme — this monochrome pass replaces its primary/accent).
 */

export const colors = {
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceSubtle: '#EEEEEE',
  // Pressed state of surfaceSubtle fills (chips) — border stays for hairlines.
  surfaceSubtlePressed: '#E0E0E0',
  // Soft near-black — the single primary accent (buttons, active states, links,
  // selection rings/checks). Monochrome scheme; white-on-primary is ~16:1 (AAA),
  // and primary-as-text on the near-white background is far above AA.
  primary: '#1A1A1A',
  // Pressed lightens (can't go darker than near-black) so a tap still registers.
  primaryPressed: '#333333',
  // Bounty/value fill + large value type. Monochrome: shares the near-black, so
  // the bounty reads as "value" via its bold black fill (white text) + weight,
  // not hue. accent is fills/large type only.
  accent: '#1A1A1A',
  // Bounty TEXT at label/body sizes on the near-white background — near-black,
  // far above AA. (Was a darkened terracotta; now monochrome.)
  accentText: '#1A1A1A',
  textPrimary: '#222222',
  textSecondary: '#6A6A6A',
  border: '#DDDDDD',
  // Stronger hairline for small elements that must stay visible (e.g. the
  // wizard's empty progress track) — ≥3:1 on the background.
  //
  // ⚠️ #8F8F8F, not #949494. The comment above had claimed ≥3:1 since this
  // token was written and #949494 measured 2.832 on the page — the claim was
  // the thing that was wrong, and colors.test.ts recorded the gap rather than
  // fixing it because changing a light token under a dark-mode change would
  // have been a silent visual edit to 43 call sites. Fixed deliberately
  // 2026-08-25, on its own, now that five new Switch tracks ship on it:
  // 3.019 on background, 3.234 on surface. The comment is true now.
  borderStrong: '#8F8F8F',
  success: '#4F8A5B',
  // Amber for pending/expiring — dot/icon/border only, never body text.
  warning: '#A9762A',
  // Clearer muted red for destructive/error UI — the one hue that survived the
  // monochrome swap for actions, so destructive actions stay unmistakably
  // distinct from the near-black primary (a destructive tap must never read as
  // the primary action).
  danger: '#C0281E',
  dangerPressed: '#A21F16',
  textOnPrimary: '#FFFFFF',
  // The rare dark floating surface (feed map pill, photo viewer). Same ink as
  // textPrimary but named as a SURFACE so a text-colour tweak never silently
  // restyles a fill.
  surfaceInverse: '#222222',
  surfaceInversePressed: '#3A3A3A',
  overlay: 'rgba(0,0,0,0.45)',
  // The spotter's alert zone drawn on a map (features/notifications). FILL and
  // STROKE only — never text, never a border on a text container. Named tokens
  // rather than inline rgba: the map circle sits over photography-adjacent map
  // tiles, so its alpha is a palette decision, not a component detail.
  // Derived from `primary` so the zone reads as "yours" like every other
  // selection ring in the app.
  mapZoneFill: 'rgba(26,26,26,0.10)',
  mapZoneStroke: 'rgba(26,26,26,0.35)',
  // --- Chrome over PHOTOGRAPHY (added 2026-08-09 for dark mode) -------------
  // Identical to surfaceInverse/overlay today, and deliberately so: this is a
  // SPLIT of one token that was doing two incompatible jobs, not a new colour.
  //
  // `surfaceInverse` means "the inverse of the page" — the map pill, the map
  // pins. Those must FLIP with the theme or a dark pin lands on a dark map and
  // disappears. These three mean "chrome sitting on a photo", which must stay
  // dark in BOTH schemes: a white close button over a bright photo is wrong in
  // every theme. One token could not answer for both once a dark page existed.
  surfaceOverMedia: '#222222',
  surfaceOverMediaPressed: '#3A3A3A',
  textOnMedia: '#FFFFFF',
  /** A scrim over a PHOTO (gradients behind photo chrome) — not over the page.
   *  Unlike `overlay` it does not deepen on dark, because the thing beneath it
   *  is the photo, whose brightness owes nothing to the theme. */
  mediaScrim: 'rgba(0,0,0,0.45)',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * The shape every palette satisfies. `colors` (light) is the reference, so a
 * token added there fails to compile until `darkColors` answers for it too —
 * which is the only thing standing between us and a half-themed app.
 */
export type Palette = { readonly [K in ColorToken]: string };

/**
 * DARK palette — soft charcoal, not true black (owner call 2026-08-09).
 *
 * The design system's first line is "never alarmist, never 'police app'
 * dark-and-red", and a pure #000 page with maximum-contrast ink is exactly that
 * app. So the page is #141414 and cards sit ABOVE it at #1E1E1E, mirroring the
 * light theme's surface hierarchy rather than flattening it — the same
 * "spacious and calm" intent, inverted.
 *
 * THE INVERSION TO UNDERSTAND: in light, `primary`/`accent` are near-BLACK and
 * `textOnPrimary` is white. Here they swap — the action colour is near-WHITE
 * and the text on it is near-black. The monochrome rule is unchanged (one
 * accent, photography carries the colour); it simply flips.
 *
 * Every text token clears WCAG AA (4.5:1) against BOTH `background` and
 * `surface`; `primary`/`accentText`/`textPrimary` clear AAA. `borderStrong`
 * clears the 3:1 non-text-graphic floor against both (3.6 / 3.3) — that is not
 * incidental: StatsSparkline.test.tsx computes contrast live and asserts ≥3
 * against each, so a darker value here fails CI.
 *
 * The semantic hues are LIGHTENED rather than reused: #4F8A5B / #A9762A /
 * #C0281E are tuned to sit on near-white and drop to 2-3:1 on charcoal.
 */
export const darkColors = {
  background: '#141414',
  surface: '#1E1E1E',
  surfaceSubtle: '#2A2A2A',
  surfaceSubtlePressed: '#363636',
  // Near-white: the single accent, inverted. 16.5:1 on the page (AAA).
  primary: '#F2F2F2',
  // Pressed DARKENS here — the mirror of light mode's "can't go darker, so
  // lighten". A near-white can't go lighter, so it dims.
  primaryPressed: '#D6D6D6',
  accent: '#F2F2F2',
  accentText: '#F2F2F2',
  textPrimary: '#EDEDED',
  textSecondary: '#A3A3A3',
  border: '#333333',
  borderStrong: '#6E6E6E',
  success: '#6FBF7F',
  warning: '#E0A64B',
  danger: '#F2685C',
  dangerPressed: '#D9544A',
  // Near-BLACK on the near-white primary fill — the flip of light mode's white.
  textOnPrimary: '#141414',
  // "The inverse of the PAGE" — so on a dark page it becomes near-white. The
  // decisive case is the map pin: the dark basemap makes a dark pin bubble
  // vanish (~1.2:1), so pins must invert. Chrome that sits on PHOTOGRAPHY does
  // NOT come here — that is surfaceOverMedia, which stays dark in both schemes.
  surfaceInverse: '#EDEDED',
  surfaceInversePressed: '#CFCFCF',
  // Heavier than light mode's 0.45: a black scrim over an already-dark page
  // barely separates the sheet from what it covers.
  overlay: 'rgba(0,0,0,0.65)',
  // Inverted to a LIGHT ink — near-black at 10% over a dark basemap is invisible.
  mapZoneFill: 'rgba(242,242,242,0.12)',
  mapZoneStroke: 'rgba(242,242,242,0.40)',
  // IDENTICAL to light on purpose — see the note on the light palette. A photo
  // is as bright in dark mode as in light, so its chrome does not flip.
  surfaceOverMedia: '#222222',
  surfaceOverMediaPressed: '#3A3A3A',
  textOnMedia: '#FFFFFF',
  mediaScrim: 'rgba(0,0,0,0.45)',
} as const satisfies Palette;

/** The palette for a scheme. `null`/undefined (scheme not yet resolved) → light. */
export function paletteFor(scheme: 'light' | 'dark' | null | undefined): Palette {
  return scheme === 'dark' ? darkColors : colors;
}

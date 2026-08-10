/**
 * WHAT:  Elevation tokens — the design system's single soft shadow, plus the
 *        deeper "lifted" variant used when an element rises toward the user.
 * WHY:   docs/DESIGN_SYSTEM.md mandates one soft shadow (never hard drop
 *        shadows) and forbids magic values in components; the floating map
 *        overlays (address pill, option card) and the centre pin's lift-on-pan
 *        need these numbers named in one place. `lifted` is a proportional
 *        deepening of `soft` so the two read as the same light source.
 * LINKS: docs/DESIGN_SYSTEM.md (Spacing, radii, elevation; Motion);
 *        src/shared/ui/LocationPicker.tsx.
 */

/**
 * Shadows are cast by a LIGHT SOURCE, not by ink — so the colour is a literal
 * black here rather than `colors.textPrimary`, which is what it used to be.
 *
 * That coupling was invisible until dark mode: `textPrimary` inverts to
 * near-white on a dark page, which would have turned every card shadow into a
 * white glow. Naming black directly also keeps `shadows` THEME-INVARIANT, and
 * that has a large knock-on benefit — every one of the ~126 migrated style
 * factories takes a single `(c: Palette)` argument instead of a whole theme
 * object, so `shadows.soft` keeps working untouched in all of them.
 *
 * Opacities are nudged down (0.06 → 0.05, 0.18 → 0.16) so that swapping
 * #222222 for a true black leaves light mode looking the same; pure black is
 * marginally denser at equal alpha. In dark mode these barely register, which
 * is correct: elevation there is carried by the surface ladder
 * (background < surface < surfaceSubtle), not by shadow.
 *
 * A deliberate non-token literal, in the same spirit as the documented
 * exemption in src/features/vehicles/post/lib/carColours.ts.
 */
const SHADOW_CAST = '#000000';

export const shadows = {
  /** The one sanctioned resting shadow: soft and subtle. */
  soft: {
    shadowColor: SHADOW_CAST,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    // Android renders shadows via elevation only; kept modest to match iOS.
    elevation: 3,
  },
  /** The deeper shadow an element casts WHILE lifted toward the user (the pin
   *  badge as the map pans beneath it) — ALSO sanctioned at rest for small
   *  white circles floating over photography (header buttons, map expand
   *  badge), which need the depth to stay legible on a busy image. */
  lifted: {
    shadowColor: SHADOW_CAST,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
} as const;

export type ShadowToken = keyof typeof shadows;

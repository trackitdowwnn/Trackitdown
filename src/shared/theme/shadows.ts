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

import { colors } from './colors';

export const shadows = {
  /** The one sanctioned resting shadow: soft and subtle. */
  soft: {
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.06,
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
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
} as const;

export type ShadowToken = keyof typeof shadows;

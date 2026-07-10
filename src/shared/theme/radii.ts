/**
 * WHAT:  Corner-radius tokens from docs/DESIGN_SYSTEM.md.
 * WHY:   Soft, consistent rounding across chips, inputs, cards and sheets;
 *        `md` is the standard for inputs and buttons.
 * LINKS: docs/DESIGN_SYSTEM.md (Spacing, radii, elevation).
 */

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  /** Fully round (circles, pills): RN has no 50% radius, so "big enough". */
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radii;

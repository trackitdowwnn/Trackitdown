/**
 * WHAT:  Spacing scale (4pt base) from docs/DESIGN_SYSTEM.md.
 * WHY:   One named scale keeps layouts on the grid and generous; UI never
 *        invents pixel gaps.
 * LINKS: docs/DESIGN_SYSTEM.md (Spacing, radii, elevation).
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

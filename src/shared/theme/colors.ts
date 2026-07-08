/**
 * WHAT:  Colour tokens for the app, straight from docs/DESIGN_SYSTEM.md.
 * WHY:   UI code imports these names and never hard-codes hex values, so a
 *        palette change happens in one place and stays on-brand (warm,
 *        trustworthy, never "police app" red).
 * LINKS: docs/DESIGN_SYSTEM.md (Colour palette).
 */

export const colors = {
  background: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceSubtle: '#F3EEE6',
  // One shade darker than the original #5F7A61 so label-size sage text passes
  // WCAG AA (4.5:1) on the warm background; white on it stays ~5.1:1.
  primary: '#5B755D',
  primaryPressed: '#4C634E',
  accent: '#C97B5D',
  // Darkened terracotta for TEXT at label/body sizes — accent itself is only
  // ~3:1 on the warm background (fine for fills/large type, fails AA for text).
  accentText: '#A05A3B',
  textPrimary: '#2B2926',
  textSecondary: '#6F6A62',
  border: '#E7E0D6',
  // Stronger hairline for small elements that must stay visible (e.g. the
  // wizard's empty progress track) while staying lighter than any fill.
  borderStrong: '#B8AE9E',
  success: '#4F8A5B',
  warning: '#C9973B',
  danger: '#B4553F',
  dangerPressed: '#96462F',
  textOnPrimary: '#FFFFFF',
  overlay: 'rgba(43,41,38,0.45)',
} as const;

export type ColorToken = keyof typeof colors;

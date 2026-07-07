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
  primary: '#5F7A61',
  primaryPressed: '#4C634E',
  accent: '#C97B5D',
  textPrimary: '#2B2926',
  textSecondary: '#6F6A62',
  border: '#E7E0D6',
  success: '#4F8A5B',
  warning: '#C9973B',
  danger: '#B4553F',
  overlay: 'rgba(43,41,38,0.45)',
} as const;

export type ColorToken = keyof typeof colors;

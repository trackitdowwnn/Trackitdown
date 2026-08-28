/**
 * WHAT:  Barrel for the design-system tokens.
 * WHY:   UI imports from '@/shared/theme' (one path) rather than reaching into
 *        individual token files.
 * LINKS: docs/DESIGN_SYSTEM.md.
 */

// `colors` (the light palette) is deliberately NOT re-exported. Components must
// take the ACTIVE palette from useThemedStyles/usePalette — importing the light
// one directly is how a screen silently stays light in dark mode, and that
// mistake is invisible at runtime. Removing it turns the compiler into an
// exhaustive check: anything still reaching for it fails to build.
// The palettes themselves are importable from './colors' for the theme
// internals and for tests that assert on specific values.
export { paletteFor, type ColorToken, type Palette } from './colors';
// Contexts + hooks only. ThemeProvider and themePreferenceStorage are
// DELIBERATELY absent: they reach AsyncStorage and Appearance, and this barrel
// is imported by ~139 files and nearly every test — exporting them from here
// made 91 suites fail to load on a null AsyncStorage native module. Import
// ThemeProvider directly from './ThemeProvider' (only src/app/_layout.tsx does).
export { usePalette, useThemeControls, type ThemeControls } from './paletteContext';
export type { ThemePreference } from './themePreferenceTypes';
export { useThemedStyles } from './useThemedStyles';
export { mapStyle, mapStyleDark, mapStyleFor } from './mapStyle';
export { motion, type MotionToken } from './motion';
export { spacing, type SpacingToken } from './spacing';
export { radii, type RadiusToken } from './radii';
export { shadows, type ShadowToken } from './shadows';
export { cardSurface } from './surfaces';
export { sizes, type SizeToken } from './sizes';
export { opacity, type OpacityToken } from './opacity';
export {
  displayFontScaleCap,
  listRowStackFontScale,
  mapPinFontScaleCap,
  tabLabelFontScaleCap,
  typography,
  type TypographyToken,
} from './typography';

/**
 * WHAT:  The ThemePreference union — 'system' | 'light' | 'dark'.
 * WHY:   Its own file so the pure context module can name the type without
 *        importing themePreferenceStorage, which pulls in AsyncStorage and
 *        would drag a native module into every test that touches the theme
 *        barrel (it did — 91 suites failed to load before this split).
 *        A type-only import would erase at runtime, but the storage module is
 *        also the natural home for the VALUES, so the type moves here and both
 *        sides import it.
 * LINKS: src/shared/theme/themePreferenceStorage.ts (persistence);
 *        src/shared/theme/paletteContext.tsx (the pure consumer).
 */

export type ThemePreference = 'system' | 'light' | 'dark';

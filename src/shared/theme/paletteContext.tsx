/**
 * WHAT:  The palette + theme-preference contexts and their hooks. PURE — this
 *        module imports nothing but React and the token file.
 * WHY:   Split out from ThemeProvider deliberately. The theme barrel is
 *        imported by ~139 files and, transitively, by nearly every test in the
 *        suite; the moment the barrel reached AsyncStorage (which the provider
 *        needs to remember the preference) 91 suites stopped even LOADING with
 *        "NativeModule: AsyncStorage is null". Tests don't mock storage they
 *        never knowingly asked for.
 *
 *        So the split is by SIDE EFFECT, not by tidiness: contexts and hooks
 *        live here and are safe for anything to import; the provider — which
 *        touches AsyncStorage and Appearance — lives next door and is imported
 *        by exactly one file, src/app/_layout.tsx.
 *
 *        The palette context DEFAULTS TO THE LIGHT PALETTE rather than null,
 *        which is what lets ~108 test files keep rendering components bare with
 *        no provider and no changes. Same instinct as useOptionalToast in
 *        shared/ui/Toast.tsx: a missing provider means "a test harness", never
 *        a user-facing gap, because the real one is mounted at the root.
 * LINKS: src/shared/theme/ThemeProvider.tsx (supplies these);
 *        src/shared/theme/useThemedStyles.ts; src/shared/theme/colors.ts.
 */

import { createContext, useContext } from 'react';

import { colors, type Palette } from './colors';
import type { ThemePreference } from './themePreferenceTypes';

export const PaletteContext = createContext<Palette>(colors);

export interface ThemeControls {
  /** What the user chose — NOT necessarily what is rendered (see `scheme`). */
  preference: ThemePreference;
  /** The scheme actually in effect once the preference is applied. */
  scheme: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
}

/**
 * Defaulted, not null — for the same reason PaletteContext is.
 *
 * SettingsScreen reads this for its Appearance chooser (ProfileScreen did,
 * until the three-way chooser replaced its two-state switch on 2026-08-24),
 * and its tests (like ~108 others) render bare with no provider. A throwing hook would fail them
 * all. The default is inert: 'system' is the true default preference, 'light'
 * is what an unresolved scheme renders as, and the setter is a no-op because in
 * the only situation this default is reachable — a test harness — there is
 * nothing to set. The real provider is mounted at the app root.
 */
export const ThemeControlsContext = createContext<ThemeControls>({
  preference: 'system',
  scheme: 'light',
  // Warns rather than silently succeeding. The palette half of this default is
  // a VALID render — light is a real theme — but a no-op setter is not: if the
  // provider were ever dropped from _layout.tsx, the Appearance screen would
  // look like it worked and change nothing. Tests never call it, so this stays
  // quiet in the only place the default is legitimately reached.
  setPreference: () => {
    if (__DEV__) {
      console.warn('setPreference called with no ThemeProvider above it.');
    }
  },
});

/** The active palette. Safe anywhere — light when no provider is above. */
export function usePalette(): Palette {
  return useContext(PaletteContext);
}

/** The preference + setter, for the Appearance screen and the Profile row. */
export function useThemeControls(): ThemeControls {
  return useContext(ThemeControlsContext);
}

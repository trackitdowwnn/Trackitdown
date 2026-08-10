/**
 * WHAT:  ThemeProvider — resolves the System/Light/Dark preference into the
 *        active palette and supplies both contexts to the app.
 * WHY:   NOT exported from the theme barrel, and imported by exactly one file
 *        (src/app/_layout.tsx). It reaches AsyncStorage and Appearance, and the
 *        barrel is pulled in by ~139 source files and nearly every test — when
 *        this module was reachable from the barrel, 91 suites failed to LOAD on
 *        "NativeModule: AsyncStorage is null". The hooks components actually
 *        use live in the side-effect-free paletteContext.tsx instead.
 *
 *        ONE SOURCE OF TRUTH for the scheme: the preference is pushed into
 *        Appearance.setColorScheme(), and the EFFECTIVE scheme is read back via
 *        useColorScheme(). We never branch on the preference directly to pick
 *        colours. That keeps our palette and the OS-drawn chrome we don't paint
 *        (keyboards, alerts, native pickers) in agreement — setColorScheme is
 *        documented as applying "to the application and all native elements
 *        within it", which is precisely the chrome that looked wrong before the
 *        app was pinned to light.
 * LINKS: src/shared/theme/paletteContext.tsx (the contexts + hooks);
 *        src/shared/theme/themePreferenceStorage.ts (persistence);
 *        src/app/_layout.tsx (mounts this ABOVE BottomSheetModalProvider, so
 *        content re-parented into gorhom's portal host still sees the palette).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { paletteFor } from './colors';
import { PaletteContext, ThemeControlsContext } from './paletteContext';
import { loadThemePreference, saveThemePreference } from './themePreferenceStorage';
import type { ThemePreference } from './themePreferenceTypes';

/**
 * Push a preference at the OS-level override.
 *
 * 'system' maps to 'unspecified' — that is how Appearance spells "stop
 * overriding"; passing null does nothing.
 */
function applyPreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts at 'system' and is corrected once storage answers. The window this
  // risks is one frame at cold start for someone who chose an override — the
  // same frame the native splash is still covering.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Appearance.setColorScheme does NOT survive a restart, so the stored
  // preference is re-applied on every boot, not only when it changes.
  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((stored) => {
      if (cancelled) return;
      setPreferenceState(stored);
      applyPreference(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    // Optimistic, and the write is fire-and-forget: a failed save costs the
    // preference at next launch, never this session's choice.
    setPreferenceState(next);
    applyPreference(next);
    void saveThemePreference(next);
  }, []);

  // The EFFECTIVE scheme. Narrowed explicitly: ColorSchemeName also admits
  // 'unspecified' and null, and either must land on light — reading an
  // unresolved scheme as dark would flash the app inverted on launch.
  const reported = useColorScheme();
  const scheme: 'light' | 'dark' = reported === 'dark' ? 'dark' : 'light';

  const palette = useMemo(() => paletteFor(scheme), [scheme]);
  const controls = useMemo(
    () => ({ preference, scheme, setPreference }),
    [preference, scheme, setPreference],
  );

  return (
    <ThemeControlsContext.Provider value={controls}>
      <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>
    </ThemeControlsContext.Provider>
  );
}

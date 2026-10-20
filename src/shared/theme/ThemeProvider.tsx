/**
 * WHAT:  ThemeProvider — resolves the System/Light/Dark preference into the
 *        active palette and supplies the palette, controls and READY contexts
 *        to the app. READY gates launch: the root layout keeps the native
 *        splash up until the saved choice is in effect (≤ THEME_READY_MAX_MS).
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

import { setAppNightMode } from './appNightMode';
import { paletteFor } from './colors';
import { PaletteContext, ThemeControlsContext, ThemeReadyContext } from './paletteContext';
import { loadThemePreference, saveThemePreference } from './themePreferenceStorage';
import type { ThemePreference } from './themePreferenceTypes';

/** The longest launch waits for the saved preference to take effect before
 *  showing the app anyway. Storage answers in a few ms and the scheme follows
 *  in the same render, so this only ever fires if storage never answers or the
 *  OS does not take the override. */
export const THEME_READY_MAX_MS = 1000;

/**
 * Push a preference at the OS-level override — twice, for two lifetimes:
 *
 * - Appearance.setColorScheme: THIS run (AppCompat, in-process, forgotten on
 *   restart). 'system' maps to 'unspecified' — that is how Appearance spells
 *   "stop overriding"; passing null does nothing.
 * - setAppNightMode: the NEXT launch's splash, which Android draws before any
 *   JS runs (per-app night mode, Android 12+, persisted; a no-op on builds
 *   without the native module). Owner, 2026-10-20: the splash opened black on
 *   a dark phone with the app on Light.
 */
function applyPreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  setAppNightMode(preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts at 'system' and is corrected once storage answers. The native
  // splash covers that window: the layout waits for `ready` below.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  // Whether storage has answered (see `ready` below).
  const [loaded, setLoaded] = useState(false);

  // Appearance.setColorScheme does NOT survive a restart, so the stored
  // preference is re-applied on every boot, not only when it changes.
  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((stored) => {
      if (cancelled) return;
      setPreferenceState(stored);
      applyPreference(stored);
      setLoaded(true);
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

  // READY once the stored preference has been read AND `scheme` reflects it.
  // Appearance.setColorScheme updates the JS-side scheme synchronously, so this
  // normally lands in the very render that applies the stored choice; the
  // `applied` check only holds launch if the OS does not take the override
  // (then the backstop decides). The root layout holds the native
  // splash until this is true, so the opening screen's first frame is already
  // in the user's theme (owner, 2026-10-20). Latched: a later change in flight
  // must never read as "not ready" — the layout would unmount the app.
  const [gaveUp, setGaveUp] = useState(false);
  const [ready, setReady] = useState(false);
  const applied = preference === 'system' || scheme === preference;
  if (!ready && ((loaded && applied) || gaveUp)) setReady(true);

  // The backstop: the splash must never wait on a read or an event that does
  // not come. Past this, the app shows in whatever scheme it has.
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setGaveUp(true), THEME_READY_MAX_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const palette = useMemo(() => paletteFor(scheme), [scheme]);
  const controls = useMemo(
    () => ({ preference, scheme, setPreference }),
    [preference, scheme, setPreference],
  );

  return (
    <ThemeReadyContext.Provider value={ready}>
      <ThemeControlsContext.Provider value={controls}>
        <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>
      </ThemeControlsContext.Provider>
    </ThemeReadyContext.Provider>
  );
}

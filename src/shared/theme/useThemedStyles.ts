/**
 * WHAT:  useThemedStyles — turns a module-level `makeStyles(palette)` factory
 *        into the stylesheet for the palette currently in effect.
 * WHY:   `StyleSheet.create({ color: colors.textPrimary })` at module scope
 *        copies the HEX STRING once, when the module is first imported. No
 *        later theme change can reach it — mutating the palette object does
 *        nothing, and neither does remounting, because the sheet was built at
 *        import time, not at mount. That is why dark mode is a migration and
 *        not a config flag.
 *
 *        The fix is to defer the build: keep the factory at module scope (so
 *        its identity is stable and the memo only recomputes when the palette
 *        actually changes) and call it from inside the component.
 *
 *        Usage — the shape every migrated file follows:
 *
 *          const makeStyles = (c: Palette) =>
 *            StyleSheet.create({ card: { backgroundColor: c.surface } });
 *
 *          export function Card() {
 *            const styles = useThemedStyles(makeStyles);
 *            ...
 *          }
 *
 *        Not limited to stylesheets: the same call migrates the module-level
 *        colour MAPS that have the identical freezing problem — Button's
 *        VARIANT_STYLES, StatusBadge's STATUS_BADGES, centerRowMeta.
 * LINKS: src/shared/theme/ThemeProvider.tsx (supplies the palette);
 *        src/shared/theme/colors.ts (Palette).
 */

import { useMemo } from 'react';

import type { Palette } from './colors';
// paletteContext, NOT ThemeProvider: this hook is imported by every migrated
// component, so it must not drag AsyncStorage into their tests.
import { usePalette } from './paletteContext';

export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const palette = usePalette();
  // `factory` is in the deps for correctness, but every caller defines it at
  // module scope, so in practice this recomputes only when the palette flips.
  return useMemo(() => factory(palette), [factory, palette]);
}

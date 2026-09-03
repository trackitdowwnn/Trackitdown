/**
 * WHAT:  The map list sheet's snap geometry — where it rests, and how far it
 *        has risen above peek.
 * WHY:   Pure numbers, shared by the SHEET (which snaps to them) and the SCREEN
 *        (which derives its map insets and its sheet-driven zoom from them).
 *        They lived in MapListSheet.tsx, which means anything wanting the
 *        geometry had to load the component — and through it the supabase
 *        client, via the vehicle card the sheet renders.
 *
 *        That made MapSearchScreen untestable in the specific way that matters:
 *        stubbing MapListSheet to keep the native list out of jest also made
 *        MAP_SHEET_SNAP_PERCENTS undefined, so the screen threw on its first
 *        render — a mock failure wearing the costume of a screen bug. Geometry
 *        is not a component concern, so it moved rather than being duplicated
 *        into a test as literals (which is the mocked-constant mistake
 *        TESTING.md records an incident about).
 *
 *        MapListSheet re-exports both names, so every existing importer is
 *        unchanged.
 * LINKS: src/features/search-map/components/MapListSheet.tsx (re-exports);
 *        src/features/search-map/screens/MapSearchScreen.tsx (the consumer
 *          this move exists for); docs/design-refs/map/.
 */

/** Peek shows the handle + label; half is browsing; full is list mode. */
export const MAP_SHEET_SNAP_PERCENTS = [15, 48, 88] as const;
export const MAP_SHEET_PEEK_PERCENT = MAP_SHEET_SNAP_PERCENTS[0];

/**
 * How far the sheet has risen ABOVE peek, as a fraction of the screen — the
 * camera inset the sheet-driven ZOOM uses. Zero at peek.
 *
 * NOT the same number as how much the sheet OCCLUDES (that is the screen's
 * insetsForSheet, and it is 15% at peek): framing and zooming want different
 * insets. Framing must dodge the sheet or it centres results behind it. Zooming
 * measured off the reference does not: docs/design-refs/map/ holds the same map
 * at two snap positions, and the camera scale between them is 0.59 where exact
 * ground-preservation would give 0.50. Solving for what IS preserved puts the
 * bottom edge ~14.6% of the screen below the sheet's top — its peek height.
 */
export function sheetZoomFraction(index: number): number {
  const percent = MAP_SHEET_SNAP_PERCENTS[index] ?? MAP_SHEET_PEEK_PERCENT;
  return Math.max(0, percent - MAP_SHEET_PEEK_PERCENT) / 100;
}

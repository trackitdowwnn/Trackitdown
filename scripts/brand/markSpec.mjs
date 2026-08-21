/**
 * WHAT:  The brand mark's geometry and colours — the single source of truth for
 *        every launcher, splash, favicon and notification asset. Pure data plus
 *        one pure function (`coverage`); no I/O, no dependencies.
 * WHY:   The mark is five concentric circles, so its "artwork" is five numbers.
 *        Keeping them here rather than in a binary means the icon can be
 *        re-tuned by editing a radius and re-running, and means the constraints
 *        that shaped it (below) can be ASSERTED rather than remembered.
 * LINKS: scripts/brand/renderMark.mjs (turns this into pixels);
 *        scripts/generate-brand-assets.mjs (writes the PNGs);
 *        scripts/brand/markSpec.test.mjs (asserts the constraints);
 *        docs/decisions/ADR-0015-brand-mark.md; docs/DESIGN_SYSTEM.md.
 *
 * THE MARK: concentric "alert rings" — a solid centre with rings radiating out.
 * It is the alert-radius circle the map already draws (mapZoneFill /
 * mapZoneStroke), so the icon depicts what the app DOES rather than being
 * another car silhouette.
 *
 * WHY TWO RINGS AND NOT THREE — the arithmetic, so nobody re-opens it:
 *   Android's adaptive icon is a 108dp canvas whose guaranteed-visible region is
 *   a 66dp circle (61.1%); the margin exists because launchers translate the
 *   foreground during parallax. At a 48dp launcher cell that leaves a 29.3dp
 *   circle to draw in — a radial budget of 14.65dp. A dot plus three rings
 *   spends that on seven alternating bands, putting EVERY element on the
 *   1.5-2.0dp legibility floor at once and shrinking the centre to a ~5dp
 *   speck. Seven bands across 4.6mm is texture, not structure: it reads as a
 *   smudge, and it inverts the story by making the centre — "here is the car" —
 *   the weakest element. Two rings plus a generous dot is not a compromise of
 *   the concept; concentricity is what carries "radiating".
 */

// --- Colour -----------------------------------------------------------------
// Mirrors src/shared/theme/colors.ts. Drift is caught by markSpec.test.mjs,
// which text-scrapes that file — this script is run by bare `node` and cannot
// import TypeScript.
/** `colors.primary` — the mark itself. */
export const INK = '#1A1A1A';
/** `colors.surface` — the plate an opaque asset sits on. */
export const PAPER = '#FFFFFF';
/** `darkColors.primary` — the mark on the dark splash. */
export const INK_DARK = '#F2F2F2';
/** Android TINTS the notification glyph; any non-white pixel becomes a blob. */
export const INK_NOTIFICATION = '#FFFFFF';

// --- Geometry ---------------------------------------------------------------
/**
 * Bands as fractions of the mark's OUTER radius (so R = 1). Each is a filled
 * annulus; `inner: 0` makes it a disc.
 *
 * Strokes THIN outward (0.195 -> 0.156) and gaps WIDEN outward (0.169 ->
 * 0.195): a wave losing energy as it travels. That graduation is the thing
 * three identical rings could never say.
 */
export const FULL_MARK = [
  { inner: 0, outer: 0.2857 }, // centre — the car
  { inner: 0.4545, outer: 0.6494 }, // ring 1, stroke 0.1948
  { inner: 0.8442, outer: 1.0 }, // ring 2, stroke 0.1558
];

/**
 * The notification glyph only. At Android's 24dp status bar the full mark's
 * outer ring falls to 1.4dp — under the floor — so it drops to one ring.
 * Simplifying at small sizes is what Apple and Google both do; the point is
 * that it is bounded to ONE asset and enforced by a test, not left to taste.
 */
export const REDUCED_MARK = [
  { inner: 0, outer: 0.4 },
  { inner: 0.68, outer: 1.0 },
];

// --- Targets ----------------------------------------------------------------
/**
 * One entry per generated file.
 *   fill        mark diameter as a fraction of the canvas.
 *   paper       set => the asset is OPAQUE (composited onto this colour).
 *   minRenderPx the smallest size this asset is ever DRAWN at, which is what
 *               the legibility floor is checked against — not the file size.
 *   safeFraction  Android's 61.1% crop, asserted where it applies.
 *
 * Every target renders NATIVELY at its own size from the same function. Nothing
 * is downsampled from a master, which is why the 48px favicon and the 96px
 * notification glyph come out sharp.
 */
export const ANDROID_SAFE_FRACTION = 66 / 108; // 0.6111 — see the header.

export const TARGETS = [
  {
    file: 'icon.png',
    size: 1024,
    mark: FULL_MARK,
    fill: 0.703,
    ink: INK,
    paper: PAPER, // App Store Connect rejects alpha in the marketing icon.
    minRenderPx: 29, // iOS Settings row, the smallest place it is drawn.
  },
  {
    file: 'android-icon-foreground.png',
    size: 1024,
    mark: FULL_MARK,
    fill: 0.602, // <= ANDROID_SAFE_FRACTION, asserted in the tests.
    ink: INK,
    paper: null,
    minRenderPx: 48,
    safeFraction: ANDROID_SAFE_FRACTION,
  },
  {
    // Only the ALPHA is consumed (Android tints it for themed icons). Ink stays
    // near-black rather than white so a pipeline that naively flattens onto
    // white still shows the mark instead of nothing.
    file: 'android-icon-monochrome.png',
    size: 1024,
    mark: FULL_MARK,
    fill: 0.602,
    ink: INK,
    paper: null,
    minRenderPx: 48,
    safeFraction: ANDROID_SAFE_FRACTION,
  },
  {
    file: 'notification-icon.png',
    size: 96,
    mark: REDUCED_MARK, // see REDUCED_MARK — 24dp status bar.
    fill: 0.75,
    ink: INK_NOTIFICATION,
    paper: null,
    minRenderPx: 24,
  },
  {
    // OPAQUE on purpose: a transparent near-black mark vanishes into Chrome's
    // dark tab strip. minRenderPx is 48, not 16 — a browser downscaling this to
    // a 16px tab softens ring 2 to sub-pixel, which is declared rather than
    // designed around. A 16px reduced-mark variant is a follow-up.
    file: 'favicon.png',
    size: 48,
    mark: FULL_MARK,
    fill: 0.703,
    ink: INK,
    paper: PAPER,
    minRenderPx: 48,
  },
  {
    file: 'splash-icon-light.png',
    size: 512,
    mark: FULL_MARK,
    fill: 0.875, // The splash has no crop and no neighbours; let it breathe.
    ink: INK,
    paper: null,
    minRenderPx: 76, // the plugin's imageWidth.
  },
  {
    file: 'splash-icon-dark.png',
    size: 512,
    mark: FULL_MARK,
    fill: 0.875,
    ink: INK_DARK,
    paper: null,
    minRenderPx: 76,
  },
];

// --- The rasteriser's one primitive -----------------------------------------
/**
 * Analytic coverage of one band at distance `d` from the centre, anti-aliased
 * with a 1px linear ramp on each edge. Returns 0..1.
 *
 * WHY ANALYTIC RATHER THAN SUPERSAMPLING: 4x SSAA yields only 17 discrete alpha
 * levels and visibly stair-steps on shallow curves; this gives full 8-bit AA at
 * 1x the cost. It also degrades honestly — when a stroke is thinner than a
 * pixel the two ramps multiply and the ring ATTENUATES to grey rather than
 * dropping out, which is what keeps the favicon readable as it shrinks.
 */
export function coverage(d, inner, outer) {
  const outerEdge = Math.min(Math.max(outer + 0.5 - d, 0), 1);
  if (inner <= 0) return outerEdge;
  const innerEdge = Math.min(Math.max(d - inner + 0.5, 0), 1);
  return outerEdge * innerEdge;
}

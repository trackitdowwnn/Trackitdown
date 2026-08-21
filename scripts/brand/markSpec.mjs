/**
 * WHAT:  The brand mark's geometry and colours — the single source of truth for
 *        every launcher, splash, favicon and notification asset. Pure data plus
 *        the primitives that draw it; no I/O, no dependencies.
 * WHY:   The mark is three shapes, so its "artwork" is a dozen numbers. Holding
 *        them here rather than in a binary is what lets every asset be rendered
 *        NATIVELY at its own size (sharper than downscaling a master), lets the
 *        Android crop be corrected per-target, and lets the constraints that
 *        shape it be ASSERTED rather than remembered.
 * LINKS: assets/brand/trackitdown-icon.svg (the supplied master vector, which
 *          this file transcribes — edit BOTH together);
 *        scripts/brand/renderMark.mjs (turns this into pixels);
 *        scripts/generate-brand-assets.mjs (writes the PNGs);
 *        scripts/brand/markSpec.test.mjs (asserts the constraints);
 *        docs/decisions/ADR-0016-brand-mark-v2.md; docs/DESIGN_SYSTEM.md.
 *
 * THE MARK: a "T" monogram with a baseline dot, black on white. Supplied by the
 * owner as a finished design (trackitdown-icon-pack, 2026-08-21); the geometry
 * below is a faithful transcription of its SVG, verified pixel-wise against the
 * pack's own 1024px export.
 *
 * TWO FAULTS IN THE SUPPLIED PACK ARE CORRECTED HERE, and only these two:
 *   1. The mark overflowed Android's guaranteed-visible circle by 55px, so
 *      launcher masks would have clipped the dot and the crossbar's corner. It
 *      is scaled down for the Android layers only (see the fills below).
 *   2. Its ink sat 13px right and 19px above the canvas centre. The geometry
 *      below is expressed about the ink's OWN centre, so every target centres
 *      it optically.
 * The shapes, proportions and colours are otherwise untouched.
 */

// --- Colour -----------------------------------------------------------------
// From the pack's README: "Colours: background #FFFFFF, mark #000000."
// Note this is BLACKER than the app's own near-black `colors.primary` (#1A1A1A)
// — deliberately, because it is the designer's value and an icon is not UI.
/** The mark. */
export const INK = '#000000';
/** The tile behind it, on opaque targets. */
export const PAPER = '#FFFFFF';
/** The splash mark in DARK mode — the tile is #141414 there, so ink inverts. */
export const INK_DARK = '#FFFFFF';
/** Android TINTS the notification glyph; any non-white pixel becomes a blob. */
export const INK_NOTIFICATION = '#FFFFFF';

// --- Geometry ---------------------------------------------------------------
/**
 * The mark, in units of HALF ITS OWN WIDTH (S), about the centre of its ink
 * bounding box. So x spans exactly −1..+1, and y spans ±0.9549 (the mark is
 * slightly wider than tall).
 *
 * Transcribed from the master SVG's 1024 viewBox:
 *   crossbar  rect 237,218 550x166 r83
 *   stem      rect 429,218 166x550 r83
 *   dot       circle 736,691 r77
 * with the ink bbox (237..813, 218..768) mapped so its centre is the origin and
 * S = 288 (half of 576). Both bars have r = half their thickness, i.e. they are
 * pills, not merely rounded rectangles — that is what gives the mark its
 * softness and it must be preserved if anything here is re-tuned.
 */
export const MARK = {
  bars: [
    // crossbar
    { cx: -0.045139, cy: -0.666667, hw: 0.954861, hh: 0.288194, r: 0.288194 },
    // stem
    { cx: -0.045139, cy: 0.0, hw: 0.288194, hh: 0.954861, r: 0.288194 },
  ],
  dots: [{ cx: 0.732639, cy: 0.6875, r: 0.267361 }],
};

/**
 * Minimum feature sizes, in units of S, that must survive at a target's
 * smallest render size — what the legibility test measures.
 */
export const FEATURES = {
  /** Bar thickness. Both bars are the same gauge. */
  barThickness: MARK.bars[0].hh * 2,
  dotDiameter: MARK.dots[0].r * 2,
  /** The breathing room between the stem and the dot. If this closes the mark
   *  reads as one blob rather than a T with a full stop. */
  stemToDotGap: MARK.dots[0].cx - MARK.dots[0].r - (MARK.bars[1].cx + MARK.bars[1].hw),
};

/** A feature thinner than this many rendered px stops reading. */
export const LEGIBILITY_FLOOR_PX = 1.5;

// --- Targets ----------------------------------------------------------------
/**
 * One entry per generated file.
 *   fill        mark WIDTH as a fraction of the canvas
 *   paper       set => the asset is OPAQUE (composited onto this colour)
 *   minRenderPx the smallest size this asset is ever DRAWN at, which is what the
 *               legibility floor is checked against — not the file size
 *   safeFraction  Android's 61.1% crop, asserted where it applies
 *
 * WHY THE ANDROID FILL IS SMALLER THAN THE iOS ONE, twice over:
 *   1. THE CROP. The binding constraint is not width but the DIAGONAL reach of
 *      the dot, which sits low-right and reaches 1.272S from centre — so a mark
 *      even 0.48 of the canvas wide already touches the safe circle. The pack's
 *      README suggests 66%; that would be clipped.
 *   2. THE MASK. Fitting the cap is not the same as looking right. The launcher
 *      masks to a circle 61% of the canvas wide, so the mark's apparent size is
 *      fill/0.61, not fill. 0.40 reads as 66% of the visible circle — matching
 *      the iOS tile's weight, which is why the two were reduced together.
 */
export const ANDROID_SAFE_FRACTION = 66 / 108; // 0.6111 — the guaranteed-visible circle

export const TARGETS = [
  {
    file: 'icon.png',
    size: 1024,
    // 0.52, down from 0.62 (2026-08-21, owner's call: it read as crowded).
    // Generous margin is one of the clearest signals of a considered icon.
    // The FLOOR on going smaller is the iOS Settings row at 29px, where the
    // stem-to-dot gap is the tightest feature: 0.52 renders it at 1.68px,
    // 0.48 at 1.55px, and 0.44 at 1.42px — under the 1.5px floor and a failing
    // build. So there is roughly one more step available here and no more.
    fill: 0.52,
    ink: INK,
    paper: PAPER, // App Store Connect rejects alpha in the marketing icon.
    minRenderPx: 29, // iOS Settings row, the smallest place it is drawn.
  },
  {
    file: 'android-icon-foreground.png',
    size: 1024,
    // 0.40, down from 0.47 (2026-08-21). The safe zone caps this at ~0.48, but
    // fitting the cap is not the same as looking right: the launcher then MASKS
    // to a circle only 61% of the canvas wide, so a mark at 0.47 filled 77% of
    // what you actually see. At 0.40 it fills 66% — the same visual weight the
    // iOS tile now has, which is why the two moved together.
    fill: 0.4,
    ink: INK,
    paper: null,
    minRenderPx: 48,
    safeFraction: ANDROID_SAFE_FRACTION,
  },
  {
    // Only the ALPHA is consumed (Android tints it for themed icons). Ink stays
    // black rather than white so a pipeline that naively flattens onto white
    // still shows the mark instead of nothing.
    file: 'android-icon-monochrome.png',
    size: 1024,
    // Tracks the foreground EXACTLY — the themed icon is the same mark at the
    // same size, and a mismatch would show up only for the users who turn
    // themed icons on, which is the worst possible place to hide one.
    fill: 0.4,
    ink: INK,
    paper: null,
    minRenderPx: 48,
    safeFraction: ANDROID_SAFE_FRACTION,
  },
  {
    file: 'notification-icon.png',
    size: 96,
    fill: 0.72,
    ink: INK_NOTIFICATION,
    paper: null,
    minRenderPx: 24,
  },
  {
    // OPAQUE on purpose: a transparent black mark vanishes into a dark browser
    // tab strip, and a white plate is what browsers expect.
    file: 'favicon.png',
    size: 48,
    // Keeps step with icon.png — same composition on the same white tile, so
    // the two should never drift apart.
    fill: 0.52,
    ink: INK,
    paper: PAPER,
    minRenderPx: 48,
  },
  {
    file: 'splash-icon-light.png',
    size: 512,
    fill: 0.78, // The splash has no crop and no neighbours; let it breathe.
    ink: INK,
    paper: null,
    minRenderPx: 76, // the expo-splash-screen plugin's imageWidth.
  },
  {
    file: 'splash-icon-dark.png',
    size: 512,
    fill: 0.78,
    ink: INK_DARK,
    paper: null,
    minRenderPx: 76,
  },
];

// --- Signed distance functions ----------------------------------------------
// Composable primitives, all returning distance in pixels: negative inside,
// positive outside, zero on the edge. union = min. Coverage comes from a 1px
// analytic ramp (see `coverage`), which is full 8-bit anti-aliasing at 1x cost
// — better than 4x supersampling, which yields only 17 discrete alpha levels
// and stair-steps on shallow curves.

export function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Rounded box. `r` is the corner radius, inset from the half-extents. */
export function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/**
 * The mark's signed distance at a point, in pixels.
 * @param {number} cx,cy  the tile centre in px
 * @param {number} S      the mark's half-width in px
 */
export function sdMark(px, py, mark, cx, cy, S) {
  let d = Infinity;
  for (const b of mark.bars) {
    d = Math.min(d, sdRoundedBox(px, py, cx + b.cx * S, cy + b.cy * S, b.hw * S, b.hh * S, b.r * S));
  }
  for (const k of mark.dots) {
    d = Math.min(d, sdCircle(px, py, cx + k.cx * S, cy + k.cy * S, k.r * S));
  }
  return d;
}

/**
 * Coverage 0..1 from a signed distance, with a 1px linear ramp across the edge.
 * Degrades honestly: a sub-pixel feature attenuates to grey rather than
 * dropping out, which is what keeps the favicon readable as it shrinks.
 */
export function coverage(d) {
  return Math.min(Math.max(0.5 - d, 0), 1);
}

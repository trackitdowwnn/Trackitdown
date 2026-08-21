/**
 * WHAT:  The brand mark's geometry for the APP side — the same "T" monogram the
 *        launcher icon uses, in a form React Native can render.
 * WHY:   `scripts/brand/markSpec.mjs` is a plain .mjs build script run by bare
 *        `node`; Metro cannot import it and it cannot import TypeScript, so the
 *        numbers have to exist twice. This is the mirror, and
 *        `scripts/brand/markGeometry.drift.test.mjs` fails the build if the two
 *        ever disagree — a duplicated constant without a drift check is how the
 *        app ends up wearing a different logo from its own icon.
 * LINKS: assets/brand/trackitdown-icon.svg (the master vector);
 *        scripts/brand/markSpec.mjs (the build-side twin — edit BOTH);
 *        src/shared/ui/BrandMark.tsx (the only consumer);
 *        docs/decisions/ADR-0016-brand-mark-v2.md.
 */

/** A pill bar: a rounded box whose corner radius is half its thickness. */
export interface MarkBar {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  r: number;
}

/** The baseline dot. */
export interface MarkDot {
  cx: number;
  cy: number;
  r: number;
}

/**
 * The mark in units of HALF ITS OWN WIDTH (S), about the centre of its ink
 * bounding box — so x spans exactly −1..+1 and y spans ±0.954861.
 *
 * Transcribed from the master SVG's 1024 viewBox (crossbar 237,218 550×166 r83;
 * stem 429,218 166×550 r83; dot 736,691 r77), normalised so the ink's own
 * centre is the origin and S = 288. Expressing it about the INK's centre rather
 * than the canvas's is what fixes the supplied pack's 13px/19px offset.
 */
export const MARK_BARS: readonly MarkBar[] = [
  // crossbar
  { cx: -0.045139, cy: -0.666667, hw: 0.954861, hh: 0.288194, r: 0.288194 },
  // stem
  { cx: -0.045139, cy: 0.0, hw: 0.288194, hh: 0.954861, r: 0.288194 },
];

export const MARK_DOTS: readonly MarkDot[] = [{ cx: 0.732639, cy: 0.6875, r: 0.267361 }];

/**
 * The mark's height as a multiple of its half-width S. The mark is slightly
 * wider than tall, so a caller sizing by WIDTH needs this to reserve the right
 * vertical space.
 */
export const MARK_ASPECT = 0.954861;

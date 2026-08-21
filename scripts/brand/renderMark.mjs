/**
 * WHAT:  Renders the brand mark to a raw RGBA8888 buffer. Pure — no I/O, no
 *        dependencies — so the PNG encoder stays a separate concern.
 * WHY:   The mark is composed signed-distance shapes, which have closed-form
 *        anti-aliasing, so this needs no vector rasteriser at all. Keeping it
 *        pure is what lets the test suite re-render in memory and compare
 *        against the committed PNGs pixel-for-pixel.
 * LINKS: scripts/brand/markSpec.mjs (the geometry and colours it draws);
 *        scripts/generate-brand-assets.mjs (the only caller that writes files);
 *        scripts/brand/assets.test.mjs.
 */

import { MARK, coverage, sdMark } from './markSpec.mjs';

/** '#1A1A1A' -> { r: 26, g: 26, b: 26 }. */
function parseHex(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Draw one target.
 *
 * @param {object} opts
 * @param {number} opts.size      canvas edge in px (always square)
 * @param {number} opts.fill      mark WIDTH as a fraction of the canvas
 * @param {string} opts.ink       mark colour
 * @param {string|null} opts.paper  background; null => transparent
 * @returns {{data: Buffer, width: number, height: number}} RGBA8888
 */
export function renderRgba({ size, fill, ink, paper }) {
  const data = Buffer.alloc(size * size * 4);
  const inkRgb = parseHex(ink);
  const paperRgb = paper ? parseHex(paper) : null;
  const centre = size / 2;
  // `fill` is the mark's WIDTH fraction; S is its half-width, which is the unit
  // every part in markSpec.MARK is expressed in.
  const S = (fill * size) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Pixel CENTRE, which is what makes the edge ramp symmetric.
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * size + x) * 4;
      const a = coverage(sdMark(px, py, MARK, centre, centre, S));

      if (paperRgb) {
        // Opaque: composite ink over paper and force full alpha. `a` is the
        // blend factor rather than the output alpha.
        data[i] = Math.round(lerp(paperRgb.r, inkRgb.r, a));
        data[i + 1] = Math.round(lerp(paperRgb.g, inkRgb.g, a));
        data[i + 2] = Math.round(lerp(paperRgb.b, inkRgb.b, a));
        data[i + 3] = 255;
      } else {
        // Transparent, STRAIGHT (non-premultiplied) alpha — and ink written to
        // EVERY pixel including fully transparent ones. Leaving transparent
        // pixels black produces dark fringes the moment anything resamples the
        // image, which prebuild does when it generates five Android densities.
        data[i] = inkRgb.r;
        data[i + 1] = inkRgb.g;
        data[i + 2] = inkRgb.b;
        data[i + 3] = Math.round(a * 255);
      }
    }
  }

  return { data, width: size, height: size };
}

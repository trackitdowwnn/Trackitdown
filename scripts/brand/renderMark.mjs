/**
 * WHAT:  Renders the brand mark to a raw RGBA8888 buffer. Pure — no I/O, no
 *        dependencies — so it is directly testable and the PNG encoder stays a
 *        separate concern.
 * WHY:   The mark is concentric circles, which have a closed-form coverage
 *        function (markSpec.coverage), so this needs no vector rasteriser at
 *        all. Keeping it pure is what lets the test suite re-render in memory
 *        and compare against the committed PNGs pixel-for-pixel.
 * LINKS: scripts/brand/markSpec.mjs (the geometry it draws);
 *        scripts/generate-brand-assets.mjs (the only caller that writes files);
 *        scripts/brand/assets.test.mjs.
 */

import { coverage } from './markSpec.mjs';

/** '#1A1A1A' -> { r: 26, g: 26, b: 26 }. */
function parseHex(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Draw one target.
 *
 * @param {object} opts
 * @param {number} opts.size    canvas edge in px (always square)
 * @param {{inner:number,outer:number}[]} opts.mark  bands, normalised to R = 1
 * @param {number} opts.fill    mark diameter as a fraction of the canvas
 * @param {string} opts.ink     mark colour
 * @param {string|null} opts.paper  background; null => transparent
 * @returns {{data: Buffer, width: number, height: number}} RGBA8888
 */
export function renderRgba({ size, mark, fill, ink, paper }) {
  const data = Buffer.alloc(size * size * 4);
  const inkRgb = parseHex(ink);
  const paperRgb = paper ? parseHex(paper) : null;
  const centre = size / 2;
  const R = (fill * size) / 2;

  // Bands scaled from normalised units into pixels, once.
  const bands = mark.map((b) => ({ inner: b.inner * R, outer: b.outer * R }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance from the PIXEL CENTRE, which is what makes the ramp symmetric.
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const d = Math.sqrt(dx * dx + dy * dy);

      let a = 0;
      for (const band of bands) {
        const c = coverage(d, band.inner, band.outer);
        if (c > a) a = c; // union — the bands never overlap, so max is exact
      }

      const i = (y * size + x) * 4;
      if (paperRgb) {
        // Opaque: composite ink over paper and force full alpha. `a` is the
        // blend factor rather than the output alpha.
        data[i] = Math.round(paperRgb.r + (inkRgb.r - paperRgb.r) * a);
        data[i + 1] = Math.round(paperRgb.g + (inkRgb.g - paperRgb.g) * a);
        data[i + 2] = Math.round(paperRgb.b + (inkRgb.b - paperRgb.b) * a);
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

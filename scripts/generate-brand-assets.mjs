/**
 * WHAT:  Generates every brand PNG — launcher icons, splash marks, favicon and
 *        the notification glyph — into assets/images/. Run: `npm run assets:brand`.
 * WHY:   The assets are DERIVED, not drawn: the source of truth is the geometry
 *        in markSpec.mjs, so the icon is re-tunable by editing a radius instead
 *        of by opening a design tool nobody here has. jimp is used ONLY as a PNG
 *        encoder — all drawing is our own float maths in renderMark.mjs — so the
 *        pipeline has exactly one trivially-auditable dependency and no native
 *        binary to install behind a corporate TLS proxy.
 * LINKS: scripts/brand/markSpec.mjs, scripts/brand/renderMark.mjs;
 *        scripts/brand/assets.test.mjs (asserts the output matches this);
 *        app.json + app.config.ts (the config that consumes the files);
 *        docs/decisions/ADR-0015-brand-mark.md.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

import { TARGETS } from './brand/markSpec.mjs';
import { renderRgba } from './brand/renderMark.mjs';

const require = createRequire(import.meta.url);
const Jimp = require('jimp-compact');

const OUT_DIR = path.join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'images');

/** Encode an RGBA buffer as a PNG on disk. jimp's callback API, promisified. */
function writePng({ data, width, height }, file) {
  return new Promise((resolve, reject) => {
    new Jimp({ data, width, height }, (err, image) => {
      if (err) return reject(err);
      image.write(file, (writeErr) => (writeErr ? reject(writeErr) : resolve()));
    });
  });
}

async function main() {
  for (const target of TARGETS) {
    const rgba = renderRgba(target);
    const out = path.join(OUT_DIR, target.file);
    await writePng(rgba, out);
    const kind = target.gradient ? 'gradient/opaque' : target.paper ? 'opaque' : 'transparent';
    console.log(`  ${target.file.padEnd(32)} ${target.size}x${target.size}  ${kind}  ${target.ink}`);
  }
  console.log(`\n${TARGETS.length} brand assets written to assets/images/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

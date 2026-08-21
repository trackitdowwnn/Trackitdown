/**
 * WHAT:  Pixel-level tests for the committed brand PNGs. Run: `npm run test:assets`.
 * WHY:   The geometry tests prove the SPEC is sound; these prove the FILES on
 *        disk match it. Between them sits every way an asset silently goes
 *        wrong: an alpha channel that gets an App Store submission rejected, a
 *        non-white notification glyph that renders as a blob, a mark that
 *        overflows the Android crop and is clipped only on other people's
 *        phones. None of those are visible in a code review.
 * LINKS: scripts/brand/markSpec.mjs, scripts/brand/renderMark.mjs;
 *        scripts/generate-brand-assets.mjs (what produced these files);
 *        docs/decisions/ADR-0015-brand-mark.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { ANDROID_SAFE_FRACTION, TARGETS } from './markSpec.mjs';
import { renderRgba } from './renderMark.mjs';

const require = createRequire(import.meta.url);
const Jimp = require('jimp-compact');

const IMAGES = path.join(fileURLToPath(new URL('../..', import.meta.url)), 'assets', 'images');

/** Dimensions + colour type straight from the PNG IHDR — no decode needed. */
function pngHeader(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] };
}

const read = (file) => Jimp.read(path.join(IMAGES, file));

test('every declared asset exists at its exact size', () => {
  for (const target of TARGETS) {
    const file = path.join(IMAGES, target.file);
    assert.ok(fs.existsSync(file), `${target.file} is missing — run \`npm run assets:brand\``);
    const { width, height } = pngHeader(file);
    assert.equal(width, target.size, `${target.file} width`);
    assert.equal(height, target.size, `${target.file} height`);
  }
});

test('opaque assets have NO transparency anywhere', async () => {
  // App Store Connect rejects alpha in the marketing icon, and a transparent
  // favicon vanishes into a dark browser tab strip. Both fail late and
  // expensively, so they are asserted at source.
  for (const target of TARGETS.filter((t) => t.paper)) {
    const img = await read(target.file);
    let minAlpha = 255;
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanAlpha(x, y, i) {
      const a = this.bitmap.data[i + 3];
      if (a < minAlpha) minAlpha = a;
    });
    assert.equal(minAlpha, 255, `${target.file} contains transparency (min alpha ${minAlpha})`);
  }
});

test('transparent assets are genuinely transparent, with clear corners', async () => {
  for (const target of TARGETS.filter((t) => !t.paper)) {
    const img = await read(target.file);
    const { width: w, height: h } = img.bitmap;
    let min = 255;
    let max = 0;
    img.scan(0, 0, w, h, function scanAlpha(x, y, i) {
      const a = this.bitmap.data[i + 3];
      if (a < min) min = a;
      if (a > max) max = a;
    });
    assert.equal(min, 0, `${target.file} has no transparent pixels at all`);
    assert.equal(max, 255, `${target.file} never reaches full opacity — the mark is washed out`);
    for (const [x, y] of [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ]) {
      assert.equal(
        Jimp.intToRGBA(img.getPixelColor(x, y)).a,
        0,
        `${target.file} corner (${x},${y}) is not transparent`,
      );
    }
  }
});

test('the notification glyph is pure white wherever it is opaque', async () => {
  // Android TINTS the small icon. Any non-white pixel renders as a white blob,
  // and it only shows up on a real device in a real notification.
  const img = await read('notification-icon.png');
  const offending = [];
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanWhite(x, y, i) {
    const [r, g, b, a] = [0, 1, 2, 3].map((o) => this.bitmap.data[i + o]);
    if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) offending.push(`(${x},${y}) rgb(${r},${g},${b})`);
  });
  assert.deepEqual(offending.slice(0, 5), [], 'non-white pixels in the notification glyph');
});

test('no ink escapes the Android safe zone, measured on actual pixels', async () => {
  // Belt and braces over the geometry assertion: this catches a rendering bug
  // as well as a spec one.
  for (const target of TARGETS.filter((t) => t.safeFraction)) {
    const img = await read(target.file);
    const { width: size } = img.bitmap;
    const centre = size / 2;
    const limit = (ANDROID_SAFE_FRACTION * size) / 2;
    let furthest = 0;
    img.scan(0, 0, size, size, function scanRadius(x, y, i) {
      if (this.bitmap.data[i + 3] === 0) return;
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      if (d > furthest) furthest = d;
    });
    assert.ok(
      furthest <= limit + 1, // +1px tolerance for the anti-aliasing ramp
      `${target.file}: ink reaches r=${furthest.toFixed(1)}px but the safe zone ends at ${limit.toFixed(1)}px — this WILL be clipped by some OEM masks`,
    );
  }
});

test('the committed PNGs match what the generator produces now', async () => {
  // Compares DECODED PIXELS, never file bytes: zlib output is not stable across
  // Node versions, so a byte diff would fail spuriously between a local Node 24
  // and CI's Node 20. This is what proves the assets are in sync with the spec
  // rather than a stale copy someone forgot to regenerate.
  for (const target of TARGETS) {
    const expected = renderRgba(target);
    const actual = await read(target.file);
    assert.equal(actual.bitmap.data.length, expected.data.length, `${target.file} buffer size`);
    let diffs = 0;
    let firstDiff = null;
    for (let i = 0; i < expected.data.length; i++) {
      if (actual.bitmap.data[i] !== expected.data[i]) {
        diffs++;
        if (!firstDiff) {
          const px = Math.floor(i / 4);
          firstDiff = `pixel (${px % target.size},${Math.floor(px / target.size)}) channel ${i % 4}: file ${actual.bitmap.data[i]} vs spec ${expected.data[i]}`;
        }
      }
    }
    assert.equal(
      diffs,
      0,
      `${target.file} is stale — ${diffs} channel(s) differ from the spec. First: ${firstDiff}. Run \`npm run assets:brand\`.`,
    );
  }
});

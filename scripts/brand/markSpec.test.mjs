/**
 * WHAT:  Geometry and colour tests for the brand mark. Run: `npm run test:assets`.
 * WHY:   These catch a bad layout BEFORE any pixels exist, and they are the
 *        reason a future radius tweak cannot quietly break the icon. The
 *        legibility floor is the highest-value assertion here: without it,
 *        someone nudges a radius and the icon silently stops reading at 48dp on
 *        a launcher nobody on the team happens to use.
 * LINKS: scripts/brand/markSpec.mjs (the spec under test);
 *        scripts/brand/assets.test.mjs (the pixel-level counterpart);
 *        docs/decisions/ADR-0015-brand-mark.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_SAFE_FRACTION,
  FULL_MARK,
  INK,
  INK_DARK,
  PAPER,
  REDUCED_MARK,
  TARGETS,
  coverage,
} from './markSpec.mjs';

const REPO = path.join(fileURLToPath(new URL('../..', import.meta.url)));

/** A stroke below this many rendered px stops reading as a line. */
const LEGIBILITY_FLOOR_PX = 1.5;

test('bands are ordered, non-overlapping and separated', () => {
  for (const [name, mark] of [
    ['FULL_MARK', FULL_MARK],
    ['REDUCED_MARK', REDUCED_MARK],
  ]) {
    let previousOuter = -Infinity;
    for (const band of mark) {
      assert.ok(band.outer > band.inner, `${name}: band has non-positive stroke`);
      assert.ok(
        band.inner > previousOuter,
        `${name}: bands overlap or touch — a gap of zero merges two rings into one`,
      );
      previousOuter = band.outer;
    }
    assert.equal(previousOuter, 1, `${name}: outermost band must end at R = 1`);
  }
});

test('the Android foreground stays inside the 61.1% safe zone', () => {
  // The margin is not decorative: launchers translate the foreground layer
  // during parallax, and OEM masks crop to arbitrary shapes. Anything outside
  // this radius CAN be clipped on someone's phone and never on ours.
  for (const target of TARGETS.filter((t) => t.safeFraction)) {
    assert.ok(
      target.fill <= target.safeFraction,
      `${target.file}: mark fills ${(target.fill * 100).toFixed(1)}% but the safe zone is ${(
        target.safeFraction * 100
      ).toFixed(1)}%`,
    );
  }
  assert.ok(
    TARGETS.some((t) => t.safeFraction === ANDROID_SAFE_FRACTION),
    'no target is checked against the Android safe zone — the rule would be unenforced',
  );
});

test('every stroke clears the legibility floor at its smallest render size', () => {
  const failures = [];
  for (const target of TARGETS) {
    const R = (target.fill * target.minRenderPx) / 2;
    target.mark.forEach((band, i) => {
      const strokePx = (band.outer - band.inner) * R;
      if (strokePx < LEGIBILITY_FLOOR_PX) {
        failures.push(
          `${target.file} band ${i} renders at ${strokePx.toFixed(2)}px at ${target.minRenderPx}px`,
        );
      }
    });
    // Gaps matter as much as strokes: two rings 1px apart read as one thick ring.
    for (let i = 1; i < target.mark.length; i++) {
      const gapPx = (target.mark[i].inner - target.mark[i - 1].outer) * R;
      if (gapPx < LEGIBILITY_FLOOR_PX) {
        failures.push(
          `${target.file} gap ${i} renders at ${gapPx.toFixed(2)}px at ${target.minRenderPx}px`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], `below the ${LEGIBILITY_FLOOR_PX}px floor:\n  ${failures.join('\n  ')}`);
});

test('the notification glyph is simplified, not just scaled', () => {
  // At Android's 24dp status bar the full mark's outer ring falls to ~1.4dp.
  // This asserts the documented exception actually exists rather than someone
  // having quietly pointed the glyph back at FULL_MARK.
  const glyph = TARGETS.find((t) => t.file === 'notification-icon.png');
  assert.equal(glyph.mark, REDUCED_MARK);
  assert.ok(REDUCED_MARK.length < FULL_MARK.length);
});

test('colours have not drifted from the theme', () => {
  // This script is run by bare `node` and cannot import a .ts module, so the
  // palette is text-scraped. Crude, but it is a drift alarm and that is all it
  // needs to be — the same zero-dep posture as scripts/check-file-headers.mjs.
  const src = fs.readFileSync(path.join(REPO, 'src/shared/theme/colors.ts'), 'utf8');
  const light = src.slice(src.indexOf('export const colors'), src.indexOf('export const darkColors'));
  const dark = src.slice(src.indexOf('export const darkColors'));
  const pick = (block, key) => block.match(new RegExp(`\\b${key}:\\s*'(#[0-9A-Fa-f]{6})'`))?.[1];

  assert.equal(INK, pick(light, 'primary'), 'INK must equal colors.primary');
  assert.equal(PAPER, pick(light, 'surface'), 'PAPER must equal colors.surface');
  assert.equal(INK_DARK, pick(dark, 'primary'), 'INK_DARK must equal darkColors.primary');
});

test('coverage anti-aliases both edges and saturates between them', () => {
  // Well inside the band => fully covered; well outside => nothing.
  assert.equal(coverage(10, 5, 15), 1);
  assert.equal(coverage(20, 5, 15), 0);
  assert.equal(coverage(0, 5, 15), 0);
  // On an edge => half covered, which is what makes the curve smooth.
  assert.equal(coverage(15, 5, 15), 0.5);
  assert.equal(coverage(5, 5, 15), 0.5);
  // A disc (inner 0) has no inner edge to ramp.
  assert.equal(coverage(0, 0, 10), 1);
  // Sub-pixel strokes ATTENUATE rather than vanish — the property that keeps
  // the favicon readable as it shrinks.
  const thin = coverage(10, 9.8, 10.2);
  assert.ok(thin > 0 && thin < 1, `sub-pixel stroke should be partial, got ${thin}`);
});

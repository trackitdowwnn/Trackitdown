/**
 * WHAT:  Geometry and colour tests for the brand mark. Run: `npm run test:assets`.
 * WHY:   These catch a bad layout BEFORE any pixels exist. Two of them guard
 *        faults that were REAL in the supplied icon pack — ink outside Android's
 *        crop, and a mark that was not centred — so they are regression tests,
 *        not hypotheticals. The legibility floor is the highest-value one:
 *        without it, someone nudges a radius and the mark silently stops reading
 *        at 48dp on a launcher nobody on the team happens to use.
 * LINKS: scripts/brand/markSpec.mjs (the spec under test);
 *        assets/brand/trackitdown-icon.svg (the master this transcribes);
 *        scripts/brand/assets.test.mjs (the pixel-level counterpart);
 *        docs/decisions/ADR-0016-brand-mark-v2.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_SAFE_FRACTION,
  FEATURES,
  INK,
  INK_DARK,
  INK_NOTIFICATION,
  LEGIBILITY_FLOOR_PX,
  MARK,
  PAPER,
  TARGETS,
  coverage,
  sdCircle,
  sdMark,
  sdRoundedBox,
} from './markSpec.mjs';

const REPO = path.join(fileURLToPath(new URL('../..', import.meta.url)));

/** The mark's furthest ink from its own centre, in units of S. Sampled rather
 *  than derived, so it stays correct if the shapes change. */
function maxReachInS() {
  const STEP = 0.004;
  let furthest = 0;
  for (let y = -1.5; y <= 1.5; y += STEP) {
    for (let x = -1.5; x <= 1.5; x += STEP) {
      if (sdMark(x, y, MARK, 0, 0, 1) < 0) {
        const r = Math.hypot(x, y);
        if (r > furthest) furthest = r;
      }
    }
  }
  return furthest;
}

test('the mark is centred on its own ink', () => {
  // The supplied pack had its ink 13px right and 19px above the canvas centre.
  // The geometry here is expressed about the ink's OWN centre so every target
  // centres it optically; this asserts that normalisation held.
  const STEP = 0.004;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = -1.5; y <= 1.5; y += STEP) {
    for (let x = -1.5; x <= 1.5; x += STEP) {
      if (sdMark(x, y, MARK, 0, 0, 1) >= 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(Math.abs(minX + maxX) < 0.01, `mark is off-centre horizontally by ${(minX + maxX).toFixed(3)}S`);
  assert.ok(Math.abs(minY + maxY) < 0.01, `mark is off-centre vertically by ${(minY + maxY).toFixed(3)}S`);
  // ...and it spans exactly the -1..+1 the S unit is defined as.
  assert.ok(Math.abs(maxX - 1) < 0.01, `half-width should be 1S, measured ${maxX.toFixed(3)}`);
});

test('the transcription still matches the master SVG', () => {
  // markSpec is a TRANSCRIPTION of assets/brand/trackitdown-icon.svg. If the
  // designer supplies a new vector and only one of the two is updated, every
  // other test here still passes while the app ships the wrong logo. This is
  // the only check that would notice.
  const svg = fs.readFileSync(path.join(REPO, 'assets/brand/trackitdown-icon.svg'), 'utf8');
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="(\d+)"/g)];
  const circles = [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)];
  assert.equal(rects.length, 2, 'expected 2 bars in the master SVG');
  assert.equal(circles.length, 1, 'expected 1 dot in the master SVG');

  // Re-derive the normalisation the way markSpec did: ink bbox -> centre, S.
  const inkMinX = Math.min(...rects.map((r) => +r[1]), +circles[0][1] - +circles[0][3]);
  const inkMaxX = Math.max(...rects.map((r) => +r[1] + +r[3]), +circles[0][1] + +circles[0][3]);
  const S = (inkMaxX - inkMinX) / 2;
  const ox = (inkMinX + inkMaxX) / 2;

  rects.forEach((r, i) => {
    const cx = (+r[1] + +r[3] / 2 - ox) / S;
    const hw = +r[3] / 2 / S;
    assert.ok(Math.abs(MARK.bars[i].cx - cx) < 1e-4, `bar ${i} cx drifted from the SVG`);
    assert.ok(Math.abs(MARK.bars[i].hw - hw) < 1e-4, `bar ${i} hw drifted from the SVG`);
  });
  assert.ok(
    Math.abs(MARK.dots[0].r - +circles[0][3] / S) < 1e-4,
    'the dot radius drifted from the SVG',
  );
});

test('both bars are pills, not merely rounded rectangles', () => {
  // r === half the thickness is what gives the mark its softness. A smaller
  // radius is a different logo.
  for (const [i, bar] of MARK.bars.entries()) {
    const thinHalf = Math.min(bar.hw, bar.hh);
    assert.ok(
      Math.abs(bar.r - thinHalf) < 1e-4,
      `bar ${i}: r=${bar.r} should equal half its thickness (${thinHalf}) to stay a pill`,
    );
  }
});

test('nothing escapes the Android safe zone', () => {
  // The 61.1% guaranteed-visible circle is not decorative: launchers translate
  // the foreground during parallax and OEM masks crop to arbitrary shapes.
  // THE SUPPLIED PACK OVERFLOWED IT BY 55px — its README suggests a 66% fill,
  // which would be clipped, because the binding constraint is not width but the
  // DIAGONAL reach of the low-right dot.
  const reachInS = maxReachInS();
  for (const target of TARGETS.filter((t) => t.safeFraction)) {
    const reach = reachInS * (target.fill / 2); // as a fraction of the canvas
    const limit = target.safeFraction / 2;
    assert.ok(
      reach <= limit,
      `${target.file}: ink reaches ${(reach * 100).toFixed(1)}% of the canvas but the safe zone ends at ${(
        limit * 100
      ).toFixed(1)}%`,
    );
  }
  assert.ok(
    TARGETS.some((t) => t.safeFraction === ANDROID_SAFE_FRACTION),
    'no target is checked against the Android safe zone — the rule would be unenforced',
  );
});

test('every feature clears the legibility floor at its smallest render size', () => {
  const failures = [];
  for (const target of TARGETS) {
    const S = (target.fill * target.minRenderPx) / 2;
    const measured = {
      'bar thickness': FEATURES.barThickness * S,
      'dot diameter': FEATURES.dotDiameter * S,
      'stem-to-dot gap': FEATURES.stemToDotGap * S,
    };
    for (const [name, px] of Object.entries(measured)) {
      if (px < LEGIBILITY_FLOOR_PX) {
        failures.push(`${target.file}: ${name} renders at ${px.toFixed(2)}px at ${target.minRenderPx}px`);
      }
    }
  }
  assert.deepEqual(failures, [], `below the ${LEGIBILITY_FLOOR_PX}px floor:\n  ${failures.join('\n  ')}`);
});

test('the dot stays clear of the stem', () => {
  // If this closes, the mark reads as one blob rather than a T with a full stop.
  assert.ok(FEATURES.stemToDotGap > 0, 'the dot has collided with the stem');
});

test('the colours are the ones the pack specified', () => {
  // From the pack's README: "background #FFFFFF, mark #000000". Pinned so a
  // change is deliberate. Note the mark is BLACKER than the app's own near-black
  // colors.primary (#1A1A1A) — that is the designer's value, and an icon is not
  // UI, so ADR-0006's monochrome rule is respected rather than excepted.
  assert.equal(INK, '#000000');
  assert.equal(PAPER, '#FFFFFF');
  assert.equal(INK_DARK, '#FFFFFF', 'the dark splash must invert or it vanishes on #141414');
  assert.equal(INK_NOTIFICATION, '#FFFFFF', 'Android tints the small icon; anything else blobs');
});

test('the SDF primitives behave', () => {
  assert.equal(sdCircle(0, 0, 0, 0, 10), -10);
  assert.equal(sdCircle(10, 0, 0, 0, 10), 0);
  assert.equal(sdCircle(20, 0, 0, 0, 10), 10);

  assert.ok(sdRoundedBox(0, 0, 0, 0, 10, 5, 2) < 0);
  assert.ok(sdRoundedBox(10, 5, 0, 0, 10, 5, 2) > 0, 'the corner should be cut by the radius');
  assert.equal(sdRoundedBox(10, 0, 0, 0, 10, 5, 2), 0, 'the flat edge should be exactly on');

  assert.equal(coverage(-5), 1);
  assert.equal(coverage(5), 0);
  assert.equal(coverage(0), 0.5);
  const partial = coverage(0.25);
  assert.ok(partial > 0 && partial < 1, `sub-pixel edge should be partial, got ${partial}`);
});

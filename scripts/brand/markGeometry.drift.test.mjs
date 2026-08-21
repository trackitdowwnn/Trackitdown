/**
 * WHAT:  Fails the build if the app-side mark geometry drifts from the
 *        build-side one. Run: `npm run test:assets`.
 * WHY:   The numbers exist TWICE and have to — `scripts/brand/markSpec.mjs` is
 *        a .mjs build script run by bare `node`, and
 *        `src/shared/brand/markGeometry.ts` is TypeScript compiled by Metro;
 *        neither can import the other. A duplicated constant with no drift
 *        check is precisely how an app ends up wearing a different logo from
 *        its own launcher icon, and nothing else in the suite would notice:
 *        the icon tests only read markSpec, and the component tests only read
 *        markGeometry. Both would stay green while the two diverged.
 * LINKS: scripts/brand/markSpec.mjs; src/shared/brand/markGeometry.ts;
 *        src/shared/ui/BrandMark.tsx; docs/decisions/ADR-0016-brand-mark-v2.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARK } from './markSpec.mjs';

const REPO = path.join(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Pull the numbers out of the TS mirror by text. It cannot be imported here
 * (bare `node`, no type stripping guaranteed on CI's Node 20), and a parser
 * would be more machinery than the job needs — the same zero-dependency
 * posture as scripts/check-file-headers.mjs.
 */
function readMirror() {
  const src = fs.readFileSync(path.join(REPO, 'src/shared/brand/markGeometry.ts'), 'utf8');
  const numbers = (block) =>
    [...block.matchAll(/(cx|cy|hw|hh|r):\s*(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])]);

  const barsBlock = src.slice(src.indexOf('MARK_BARS'), src.indexOf('MARK_DOTS'));
  const dotsBlock = src.slice(src.indexOf('MARK_DOTS'), src.indexOf('MARK_ASPECT'));
  const aspect = Number(src.match(/MARK_ASPECT\s*=\s*([\d.]+)/)?.[1]);

  // Five keys per bar, three per dot.
  const barNums = numbers(barsBlock);
  const dotNums = numbers(dotsBlock);
  const chunk = (arr, n) =>
    Array.from({ length: arr.length / n }, (_, i) => Object.fromEntries(arr.slice(i * n, i * n + n)));

  return { bars: chunk(barNums, 5), dots: chunk(dotNums, 3), aspect };
}

test('the app-side mark geometry matches the build-side spec', () => {
  const mirror = readMirror();

  assert.equal(mirror.bars.length, MARK.bars.length, 'bar count differs between spec and mirror');
  assert.equal(mirror.dots.length, MARK.dots.length, 'dot count differs between spec and mirror');

  MARK.bars.forEach((bar, i) => {
    for (const key of ['cx', 'cy', 'hw', 'hh', 'r']) {
      assert.ok(
        Math.abs(bar[key] - mirror.bars[i][key]) < 1e-6,
        `bar ${i} ${key}: spec ${bar[key]} vs app ${mirror.bars[i][key]} — the icon and the in-app mark have diverged`,
      );
    }
  });

  MARK.dots.forEach((dot, i) => {
    for (const key of ['cx', 'cy', 'r']) {
      assert.ok(
        Math.abs(dot[key] - mirror.dots[i][key]) < 1e-6,
        `dot ${i} ${key}: spec ${dot[key]} vs app ${mirror.dots[i][key]} — the icon and the in-app mark have diverged`,
      );
    }
  });
});

test('MARK_ASPECT matches the mark the spec actually describes', () => {
  // The mirror sizes its SVG viewBox from this, so a wrong value squashes or
  // stretches the logo in the app while the icon stays correct.
  const { aspect } = readMirror();
  const top = Math.min(...MARK.bars.map((b) => b.cy - b.hh), ...MARK.dots.map((d) => d.cy - d.r));
  const bottom = Math.max(...MARK.bars.map((b) => b.cy + b.hh), ...MARK.dots.map((d) => d.cy + d.r));
  const halfHeight = (bottom - top) / 2;
  assert.ok(
    Math.abs(aspect - halfHeight) < 1e-5,
    `MARK_ASPECT is ${aspect} but the spec's half-height is ${halfHeight.toFixed(6)}`,
  );
});

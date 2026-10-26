/**
 * WHAT:  The PDF's copy of the "T" mark matches the app's.
 * WHY:   ./brandMark.ts is a copy (Edge Functions can't import src/); a change
 *        to the mark in one place only would put a different logo on the
 *        data export.
 * LINKS: ./brandMark.ts; src/shared/brand/markGeometry.ts.
 */

import * as app from '../../../src/shared/brand/markGeometry';

import { MARK_ASPECT, MARK_BARS, MARK_DOTS } from './brandMark';

it('is the same mark the app draws', () => {
  expect(MARK_BARS).toEqual(app.MARK_BARS);
  expect(MARK_DOTS).toEqual(app.MARK_DOTS);
  expect(MARK_ASPECT).toBe(app.MARK_ASPECT);
});

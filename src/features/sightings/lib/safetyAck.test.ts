/**
 * WHAT:  Tests for safetyAck — the in-memory proof that the report safety
 *        sheet was just confirmed: it counts for the same post, for 30
 *        seconds, and reading it doesn't use it up.
 * WHY:   It is what lets the report screen skip the sheet. Counting for the
 *        wrong post, or for longer than a push-and-mount, would let one
 *        confirm open the camera on a report nobody was warned about.
 * LINKS: src/features/sightings/lib/safetyAck.ts.
 */

import { hasFreshSafetyAck, markSafetyAck, resetSafetyAck } from './safetyAck';

const T = 1_000_000;

beforeEach(() => resetSafetyAck());

describe('safetyAck', () => {
  it('is absent until the sheet is confirmed', () => {
    expect(hasFreshSafetyAck('p1', T)).toBe(false);
  });

  it('counts for the same post, read as often as needed, for 30 seconds', () => {
    markSafetyAck('p1', T);
    // StrictMode reads it twice: both must see it.
    expect(hasFreshSafetyAck('p1', T + 1)).toBe(true);
    expect(hasFreshSafetyAck('p1', T + 29_999)).toBe(true);
    expect(hasFreshSafetyAck('p1', T + 30_000)).toBe(false);
  });

  it('does not count if the clock has gone backwards since', () => {
    markSafetyAck('p1', T);
    expect(hasFreshSafetyAck('p1', T - 1)).toBe(false);
  });

  it('never counts for another post', () => {
    markSafetyAck('p1', T);
    expect(hasFreshSafetyAck('p2', T + 1)).toBe(false);
  });

  it('the latest confirm replaces the last', () => {
    markSafetyAck('p1', T);
    markSafetyAck('p2', T + 5);
    expect(hasFreshSafetyAck('p1', T + 6)).toBe(false);
    expect(hasFreshSafetyAck('p2', T + 6)).toBe(true);
  });
});

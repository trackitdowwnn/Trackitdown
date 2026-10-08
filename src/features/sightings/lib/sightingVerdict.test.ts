/**
 * WHAT:  Tests for the owner's verdict vocabulary: every status maps to its
 *        own label (or none), and which statuses are a confirmation or gone.
 * WHY:   A two-way branch once labelled a REJECTED sighting "Marked helpful";
 *        the map is total so that can't recur, and these pin each entry.
 * LINKS: src/features/sightings/lib/sightingVerdict.ts.
 */

import { isConfirmedVerdict, isGoneSighting, sightingVerdictLabel } from './sightingVerdict';

describe('sightingVerdictLabel', () => {
  it.each([
    ['unverified', null],
    ['helpful', 'Confirmed'],
    ['credited', 'Credited'],
    ['not_mine', 'Not your car'],
    ['withdrawn', null],
  ] as const)('%s → %s', (status, label) => {
    expect(sightingVerdictLabel(status)).toBe(label);
  });
});

describe('isConfirmedVerdict', () => {
  it('is true only for a confirmation', () => {
    expect(isConfirmedVerdict('helpful')).toBe(true);
    expect(isConfirmedVerdict('credited')).toBe(true);
    expect(isConfirmedVerdict('not_mine')).toBe(false);
    expect(isConfirmedVerdict('unverified')).toBe(false);
    expect(isConfirmedVerdict('withdrawn')).toBe(false);
  });
});

describe('isGoneSighting', () => {
  it('is true only for a withdrawn sighting', () => {
    expect(isGoneSighting('withdrawn')).toBe(true);
    expect(isGoneSighting('not_mine')).toBe(false);
    expect(isGoneSighting('unverified')).toBe(false);
  });
});

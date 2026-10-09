/**
 * WHAT:  Tests for the owner's verdict vocabulary: every status maps to its
 *        own label (or none), which statuses are a confirmation or gone, the
 *        timeline card's pill ("Needs your answer" while undecided), and the
 *        seen-at rule (an in-app photo's time, never a library one's).
 * WHY:   A two-way branch once labelled a REJECTED sighting "Marked helpful";
 *        the map is total so that can't recur, and these pin each entry.
 * LINKS: src/features/sightings/lib/sightingVerdict.ts.
 */

import {
  isConfirmedVerdict,
  isGoneSighting,
  sightingCardStatus,
  sightingSeenAt,
  sightingVerdictLabel,
} from './sightingVerdict';

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

describe('sightingCardStatus', () => {
  it.each([
    ['unverified', { label: 'Needs your answer', tone: 'warning' }],
    ['helpful', { label: 'Confirmed', tone: 'primary' }],
    ['credited', { label: 'Credited', tone: 'primary' }],
    ['not_mine', { label: 'Not your car', tone: 'neutral' }],
    ['withdrawn', null],
  ] as const)('%s → %j', (status, expected) => {
    expect(sightingCardStatus(status)).toEqual(expected);
  });
});

describe('sightingSeenAt', () => {
  const photo = (source: 'live' | 'gallery', capturedAt: string) => ({
    path: `${capturedAt}.jpg`,
    lat: null,
    lng: null,
    accuracyM: null,
    capturedAt,
    source,
  });
  const createdAt = '2026-10-08T10:00:00Z';

  it('is the first in-app photo’s capture time, even behind a library photo', () => {
    expect(
      sightingSeenAt({
        createdAt,
        photos: [photo('gallery', '2026-09-01T08:00:00Z'), photo('live', '2026-10-08T09:55:00Z')],
      }),
    ).toBe('2026-10-08T09:55:00Z');
  });

  it('is when it was sent when every photo is from the library — or there are none', () => {
    expect(sightingSeenAt({ createdAt, photos: [photo('gallery', '2026-09-01T08:00:00Z')] })).toBe(
      createdAt,
    );
    expect(sightingSeenAt({ createdAt, photos: [] })).toBe(createdAt);
  });
});

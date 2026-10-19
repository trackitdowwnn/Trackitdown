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
  sightingVerdictView,
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

describe('sightingVerdictView', () => {
  it.each([
    [
      'unverified',
      { label: null, tone: null, decide: true, canChange: false, offerRecovery: false },
    ],
    [
      'helpful',
      { label: 'Confirmed', tone: 'primary', decide: false, canChange: false, offerRecovery: true },
    ],
    [
      'credited',
      { label: 'Credited', tone: 'primary', decide: false, canChange: false, offerRecovery: false },
    ],
    [
      'not_mine',
      {
        label: 'Not your car',
        tone: 'neutral',
        decide: false,
        canChange: true,
        offerRecovery: false,
      },
    ],
    [
      'withdrawn',
      { label: null, tone: null, decide: false, canChange: false, offerRecovery: false },
    ],
  ] as const)('%s → %j', (status, expected) => {
    expect(sightingVerdictView(status)).toEqual(expected);
  });

  it('⚠️ only "Not my car" can be changed — "Yes" is permanent', () => {
    const changeable = (
      ['unverified', 'helpful', 'credited', 'not_mine', 'withdrawn'] as const
    ).filter((status) => sightingVerdictView(status).canChange);
    expect(changeable).toEqual(['not_mine']);
  });

  it('asks the question exactly while undecided — never alongside a label', () => {
    for (const status of ['unverified', 'helpful', 'credited', 'not_mine', 'withdrawn'] as const) {
      const view = sightingVerdictView(status);
      expect(view.decide && view.label !== null).toBe(false);
    }
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

  it.each([
    ['days before it was sent', '2026-10-01T10:00:00Z'],
    ['more than an hour before', '2026-10-08T08:30:00Z'],
    ['in the future', '2026-10-08T12:00:00Z'],
    ['unparseable', 'not a time'],
  ])('⚠️ is when it was sent if the phone’s clock put the photo %s', (_, capturedAt) => {
    expect(sightingSeenAt({ createdAt, photos: [photo('live', capturedAt)] })).toBe(createdAt);
  });

  it('believes a capture up to an hour before sending, and a few minutes of clock drift', () => {
    expect(sightingSeenAt({ createdAt, photos: [photo('live', '2026-10-08T09:05:00Z')] })).toBe(
      '2026-10-08T09:05:00Z',
    );
    expect(sightingSeenAt({ createdAt, photos: [photo('live', '2026-10-08T10:03:00Z')] })).toBe(
      '2026-10-08T10:03:00Z',
    );
  });

  it('compares instants, so the clocks going back (25 Oct) cannot move the hour window', () => {
    // Sent at 01:30 GMT, after the clocks went back at 02:00 BST (01:00 UTC).
    // The photo was taken 45 minutes earlier, at 01:45 BST, which is LATER on
    // the wall clock than 01:30 but earlier in fact, so it must be believed.
    const sentAfterChange = '2026-10-25T01:30:00Z';
    const takenBeforeChange = '2026-10-25T00:45:00Z';
    expect(
      sightingSeenAt({ createdAt: sentAfterChange, photos: [photo('live', takenBeforeChange)] }),
    ).toBe(takenBeforeChange);
  });

  it('is when it was sent when every photo is from the library — or there are none', () => {
    expect(sightingSeenAt({ createdAt, photos: [photo('gallery', '2026-09-01T08:00:00Z')] })).toBe(
      createdAt,
    );
    expect(sightingSeenAt({ createdAt, photos: [] })).toBe(createdAt);
  });
});

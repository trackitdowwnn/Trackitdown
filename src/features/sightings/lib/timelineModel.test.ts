/**
 * WHAT:  Tests for the timeline maths — newest-first ordering with day
 *        headers, the newest-dot flag, the "N earlier" copy, and the
 *        movement hint's distance/bearing/threshold rules.
 * WHY:   Ordering is the product decision (recency first — a live theft is
 *        read newest-down), and the movement hint is navigation arithmetic
 *        shown to a person in distress: a wrong bearing is worse than none.
 *        The <2-located and same-place guards keep the hint honest — it
 *        must say nothing rather than "0.0 mi north".
 * LINKS: src/features/sightings/lib/timelineModel.ts; docs/TESTING.md.
 */

import type { OwnerSighting } from '../types';
import {
  buildTimelineItems,
  distanceMiles,
  earlierCountLabel,
  locatedTrail,
  movementHint,
  originAnchor,
  terminalAnchor,
  timelineDayLabel,
  trailRegion,
  windDirection,
} from './timelineModel';

const NOW = new Date('2026-07-29T18:00:00Z');

const sighting = (
  id: string,
  createdAt: string,
  photo?: { lat: number; lng: number },
): OwnerSighting => ({
  id,
  createdAt,
  status: 'unverified',
  contextFlags: [],
  note: null,
  areaLabel: null,
  locationUnavailable: !photo,
  parkedLikelihood: null,
  direction: null,
  peoplePresence: null,
  confirmedFeatures: [],
  photos: photo
    ? [{ path: `p/${id}.jpg`, lat: photo.lat, lng: photo.lng, accuracyM: 10, capturedAt: createdAt }]
    : [{ path: `p/${id}.jpg`, lat: null, lng: null, accuracyM: null, capturedAt: createdAt }],
  spotter: {
    firstName: 'Beth',
    sightingsReported: 3,
    sightingsHelpful: 1,
    recoveriesCredited: 0,
    memberSince: '2026-04-01T00:00:00Z',
  },
});

describe('buildTimelineItems', () => {
  it('orders newest-first with a day header before each day', () => {
    const items = buildTimelineItems(
      [
        sighting('old', '2026-07-27T12:00:00Z'),
        sighting('new', '2026-07-29T12:00:00Z'),
        sighting('mid', '2026-07-28T12:00:00Z'),
      ],
      (s) => s.createdAt,
      NOW,
    );

    expect(
      items.map((i) => (i.kind === 'day' ? `[${i.label}]` : i.entry.id)),
    ).toEqual(['[Today]', 'new', '[Yesterday]', 'mid', '[Mon 27 Jul]', 'old']);
  });

  it('flags exactly the newest entry for the emphasised dot', () => {
    const items = buildTimelineItems(
      [sighting('a', '2026-07-29T10:00:00Z'), sighting('b', '2026-07-29T12:00:00Z')],
      (s) => s.createdAt,
      NOW,
    );

    const flags = items.flatMap((i) => (i.kind === 'entry' ? [[i.entry.id, i.newest]] : []));
    expect(flags).toEqual([
      ['b', true],
      ['a', false],
    ]);
  });

  it('groups same-day entries under one header', () => {
    const items = buildTimelineItems(
      [sighting('a', '2026-07-29T10:00:00Z'), sighting('b', '2026-07-29T12:00:00Z')],
      (s) => s.createdAt,
      NOW,
    );

    expect(items.filter((i) => i.kind === 'day')).toHaveLength(1);
  });

  it('works over any entry shape via the accessor — both faces, one truth', () => {
    const publicEntries = [{ sightedAt: '2026-07-29T12:00:00Z' }, { sightedAt: '2026-07-28T09:00:00Z' }];
    const items = buildTimelineItems(publicEntries, (e) => e.sightedAt, NOW);

    expect(items.map((i) => i.kind)).toEqual(['day', 'entry', 'day', 'entry']);
  });
});

describe('timelineDayLabel', () => {
  it('says Today / Yesterday, then short weekday-day-month', () => {
    expect(timelineDayLabel('2026-07-29T09:00:00Z', NOW)).toBe('Today');
    expect(timelineDayLabel('2026-07-28T09:00:00Z', NOW)).toBe('Yesterday');
    expect(timelineDayLabel('2026-07-21T09:00:00Z', NOW)).toBe('Tue 21 Jul');
  });
});

describe('earlierCountLabel', () => {
  it('never renders a zero', () => {
    expect(earlierCountLabel(0)).toBeNull();
    expect(earlierCountLabel(-1)).toBeNull();
  });

  it('pluralises honestly', () => {
    expect(earlierCountLabel(1)).toBe('…and 1 earlier sighting');
    expect(earlierCountLabel(4)).toBe('…and 4 earlier sightings');
  });
});

describe('movement hint', () => {
  // ~0.9 mi of latitude per 1/69 degree; use real-ish London points.
  const HOLLOWAY = { lat: 51.5527, lng: -0.1132 };
  const ARCHWAY = { lat: 51.5653, lng: -0.135 }; // ~NNW of Holloway, ~1.2 mi

  it('reads earliest located → latest located, with distance and wind', () => {
    const hint = movementHint([
      sighting('first', '2026-07-28T10:00:00Z', HOLLOWAY),
      sighting('latest', '2026-07-29T10:00:00Z', ARCHWAY),
    ]);

    expect(hint).toMatch(/^Most recent sighting is \d+\.\d mi (north|north-west|north-east) of the first$/);
  });

  it('needs two LOCATED sightings — unlocated ones are ignored', () => {
    expect(
      movementHint([
        sighting('located', '2026-07-29T10:00:00Z', HOLLOWAY),
        sighting('nofix', '2026-07-28T10:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('says nothing when the car has not moved (same place twice)', () => {
    expect(
      movementHint([
        sighting('a', '2026-07-28T10:00:00Z', HOLLOWAY),
        sighting('b', '2026-07-29T10:00:00Z', HOLLOWAY),
      ]),
    ).toBeNull();
  });

  it('uses chronology, not array order', () => {
    // Same data, reversed array — the direction must not flip.
    const forward = movementHint([
      sighting('first', '2026-07-28T10:00:00Z', HOLLOWAY),
      sighting('latest', '2026-07-29T10:00:00Z', ARCHWAY),
    ]);
    const reversed = movementHint([
      sighting('latest', '2026-07-29T10:00:00Z', ARCHWAY),
      sighting('first', '2026-07-28T10:00:00Z', HOLLOWAY),
    ]);

    expect(forward).toBe(reversed);
  });
});

describe('geo primitives', () => {
  it('haversine sanity: one degree of latitude ≈ 69 miles', () => {
    const d = distanceMiles({ lat: 51, lng: 0 }, { lat: 52, lng: 0 });
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });

  it('wind sanity: due north / east / south-west', () => {
    expect(windDirection({ lat: 51, lng: 0 }, { lat: 52, lng: 0 })).toBe('north');
    expect(windDirection({ lat: 51, lng: 0 }, { lat: 51, lng: 1 })).toBe('east');
    expect(windDirection({ lat: 52, lng: 0 }, { lat: 51, lng: -1 })).toBe('south-west');
  });
});

describe('anchor nodes', () => {
  it('origin uses the theft moment and coarse area', () => {
    const origin = originAnchor(
      {
        status: 'active',
        lastSeenAt: '2026-07-28T03:00:00Z',
        lastSeenArea: 'Camden',
        createdAt: '2026-07-28T09:00:00Z',
      },
      NOW,
    );
    expect(origin.label).toBe('Reported stolen');
    expect(origin.sublabel).toContain('near Camden');
    expect(origin.sublabel).toContain('Yesterday');
  });

  it('origin falls back to the report time when lastSeenAt is unknown, and to time-only when the area is', () => {
    const origin = originAnchor(
      { status: 'active', lastSeenAt: null, createdAt: '2026-07-29T09:00:00Z' },
      NOW,
    );
    expect(origin.sublabel).toContain('Today');
    expect(origin.sublabel).not.toContain('near');
  });

  it('terminal maps recovered statuses to the celebration and archival ends to quiet', () => {
    expect(terminalAnchor('recovered')).toEqual({ label: 'Recovered 🎉', tone: 'celebrate' });
    expect(terminalAnchor('recovered_no_spotter')).toEqual({
      label: 'Recovered 🎉',
      tone: 'celebrate',
    });
    expect(terminalAnchor('expired')).toEqual({ label: 'Post expired', tone: 'quiet' });
    expect(terminalAnchor('cancelled')).toEqual({ label: 'Post closed', tone: 'quiet' });
  });

  it('an open arc has NO terminal: active and in-flight claims stay unterminated', () => {
    expect(terminalAnchor('active')).toBeNull();
    expect(terminalAnchor('recovery_claimed')).toBeNull();
    expect(terminalAnchor('draft')).toBeNull();
  });
});

describe('trail (owner map)', () => {
  it('walks located sightings OLDEST-first and drops un-located ones', () => {
    const trail = locatedTrail([
      sighting('new', '2026-07-29T12:00:00Z', { lat: 51.76, lng: -0.33 }),
      sighting('unlocated', '2026-07-28T12:00:00Z'),
      sighting('old', '2026-07-27T12:00:00Z', { lat: 51.75, lng: -0.34 }),
    ]);
    expect(trail.map((point) => point.sightingId)).toEqual(['old', 'new']);
  });

  it('frames the trail with padding and never zooms tighter than a neighbourhood', () => {
    const region = trailRegion([
      { lat: 51.75, lng: -0.34 },
      { lat: 51.76, lng: -0.3 },
    ]);
    expect(region).not.toBeNull();
    expect(region!.latitude).toBeCloseTo(51.755);
    expect(region!.longitude).toBeCloseTo(-0.32);
    expect(region!.longitudeDelta).toBeCloseTo(0.04 * 1.5);
    // A single point must not frame a doorstep.
    const single = trailRegion([{ lat: 51.75, lng: -0.34 }]);
    expect(single!.latitudeDelta).toBeGreaterThanOrEqual(0.02);
    // No points → no region (the map simply doesn't render).
    expect(trailRegion([])).toBeNull();
  });
});

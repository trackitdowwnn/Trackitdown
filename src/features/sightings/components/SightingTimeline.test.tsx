/**
 * WHAT:  Tests for the sighting timeline: railFlags (each connector styled as
 *        one unit — dashed into a sighting with no location, faded into the
 *        theft, open at both ends); the owner face capping at its limit,
 *        newest first, with the honest "…and N earlier" and the theft at the
 *        foot; the public face rendering time and place only, with nothing
 *        tappable.
 * WHY:   The timeline had no test of its own — the section's tests covered
 *        it from outside. The rail's semantics (dashed = uncertain) and the
 *        public fence (ADR-0008) are rules, not decoration.
 * LINKS: src/features/sightings/components/SightingTimeline.tsx;
 *        docs/decisions/ADR-0008-public-sighting-entries.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { TimelineAnchorSource } from '../lib/timelineModel';
import type { OwnerSighting } from '../types';
import { OwnerSightingTimeline, PublicSightingTimeline, railFlags } from './SightingTimeline';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useReducedMotion: () => true,
  };
});

const anchors: TimelineAnchorSource = {
  status: 'active',
  lastSeenAt: '2026-07-20T03:00:00Z',
  lastSeenArea: 'Camden',
  createdAt: '2026-07-20T08:00:00Z',
};

const sighting = (id: string, createdAt: string, extra: Partial<OwnerSighting> = {}) =>
  ({
    id,
    createdAt,
    status: 'unverified',
    reviewedAt: null,
    contextFlags: [],
    note: null,
    areaLabel: `Street ${id}`,
    locationUnavailable: false,
    parkedLikelihood: null,
    direction: null,
    peoplePresence: null,
    confirmedFeatures: [],
    photos: [],
    spotter: {
      firstName: 'Beth',
      sightingsReported: 3,
      sightingsHelpful: 1,
      recoveriesCredited: 0,
      memberSince: '2026-04-01T00:00:00Z',
    },
    ...extra,
  }) as OwnerSighting;

describe('railFlags', () => {
  it('leaves the plan’s two ends open', () => {
    const flags = railFlags([{ kind: 'entry' }, { kind: 'entry' }]);
    expect(flags[0].noTop).toBe(true);
    expect(flags[1].noBottom).toBe(true);
    expect(flags[0].noBottom).toBeUndefined();
  });

  it('dashes the WHOLE connector into a sighting with no location — through the day stop between', () => {
    const flags = railFlags([
      { kind: 'entry' },
      { kind: 'day' },
      { kind: 'entry', uncertain: true },
    ]);
    expect(flags[0].dashedBottom).toBe(true);
    expect(flags[1]).toMatchObject({ dashedTop: true, dashedBottom: true });
    expect(flags[2].dashedTop).toBe(true);
    expect(flags[2].dashedBottom).toBeUndefined();
  });

  it('fades the connector into the theft', () => {
    const flags = railFlags([{ kind: 'entry' }, { kind: 'origin' }]);
    expect(flags[0].fadeBottom).toBe(true);
    expect(flags[1].fadeTop).toBe(true);
  });

  it('an uncertain FIRST row has no connector to dash', () => {
    const flags = railFlags([{ kind: 'entry', uncertain: true }, { kind: 'entry' }]);
    expect(flags[0].dashedTop).toBeUndefined();
  });
});

describe('owner face', () => {
  const four = [
    sighting('s1', '2026-07-21T10:00:00Z'),
    sighting('s4', '2026-07-24T10:00:00Z'),
    sighting('s2', '2026-07-22T10:00:00Z'),
    sighting('s3', '2026-07-23T10:00:00Z'),
  ];

  it('shows the newest up to its limit, says what it cut, and ends at the theft', async () => {
    const view = await render(
      <OwnerSightingTimeline
        sightings={four}
        photoUrls={{}}
        limit={3}
        onEntryPress={jest.fn()}
        anchors={anchors}
      />,
    );
    expect(view.getByTestId('timeline-entry-s4')).toBeTruthy();
    expect(view.getByTestId('timeline-entry-s2')).toBeTruthy();
    expect(view.queryByTestId('timeline-entry-s1')).toBeNull();
    expect(view.getByText('…and 1 earlier sighting')).toBeTruthy();
    expect(view.getByText('Reported stolen')).toBeTruthy();
  });

  it('counts each card against the whole list for screen readers', async () => {
    const view = await render(
      <OwnerSightingTimeline sightings={four} photoUrls={{}} limit={3} onEntryPress={jest.fn()} />,
    );
    expect(view.getByTestId('timeline-entry-s4').props.accessibilityLabel).toMatch(
      /Sighting 1 of 4\./,
    );
  });

  it('opens the sighting tapped', async () => {
    const onEntryPress = jest.fn();
    const view = await render(
      <OwnerSightingTimeline sightings={four} photoUrls={{}} onEntryPress={onEntryPress} />,
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('timeline-entry-s3'));
    });
    expect(onEntryPress).toHaveBeenCalledWith(expect.objectContaining({ id: 's3' }));
  });
});

describe('public face', () => {
  it('⚠️ renders time and place only — nothing tappable', async () => {
    const view = await render(
      <PublicSightingTimeline
        data={{
          entries: [
            {
              sightedAt: '2026-07-24T10:00:00Z',
              locality: 'Holloway',
              snapLat: 51.5,
              snapLng: -0.1,
            },
          ],
          earlierCount: 0,
        }}
        anchors={anchors}
      />,
    );
    expect(view.getByText('Sighted near Holloway')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByText(/Needs your answer|Confirmed|Seen near/)).toBeNull();
  });
});

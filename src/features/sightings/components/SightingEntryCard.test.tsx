/**
 * WHAT:  Tests for SightingEntryCard — the owner's photo-first timeline card:
 *        the in-app photo leads, "+N" for the rest, an empty box while a link
 *        is on its way and a frame mark with no photos; the place alone (no
 *        "Seen near"), or the honest "Location couldn't be captured"; the
 *        clock time alone (no "ago" on screen) — the in-app photo's, or when
 *        it was sent if the phone's clock is implausible; "Saw N of M marks"
 *        only when known; "Needs your answer" as an amber tag, answered
 *        states as a quiet line; the chevron; nothing else on the card (no
 *        context pills, no note, no spotter); one spoken label; the tap.
 * WHY:   Redesigned 2026-10-09 (too busy, never said what was waiting on the
 *        owner) and again 2026-10-20 at the owner's request (cleaner, an
 *        amber tag, the marks seen). These pin both halves: what it shows,
 *        and what it no longer shows.
 * LINKS: src/features/sightings/components/SightingEntryCard.tsx;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { formatClock } from '@/shared/lib';
import { paletteFor } from '@/shared/theme';

import type { OwnerSighting } from '../types';
import { SightingEntryCard } from './SightingEntryCard';

const livePhoto = {
  path: 'live.jpg',
  lat: 53.48,
  lng: -2.24,
  accuracyM: 8,
  capturedAt: '2026-10-08T09:55:00Z',
  source: 'live' as const,
};
const libraryPhoto = {
  path: 'library.jpg',
  lat: null,
  lng: null,
  accuracyM: null,
  capturedAt: '2026-09-01T08:00:00Z',
  source: 'gallery' as const,
};

function sighting(overrides: Partial<OwnerSighting> = {}): OwnerSighting {
  return {
    id: 's1',
    createdAt: '2026-10-08T10:00:00Z',
    status: 'unverified',
    reviewedAt: null,
    contextFlags: ['parked'],
    note: 'Outside the bakery',
    areaLabel: 'Deansgate, Manchester',
    locationUnavailable: false,
    parkedLikelihood: 'settled',
    direction: null,
    peoplePresence: 'nobody',
    confirmedFeatures: [],
    photos: [livePhoto],
    spotter: {
      firstName: 'Beth',
      sightingsReported: 3,
      sightingsHelpful: 1,
      recoveriesCredited: 0,
      memberSince: '2026-04-01T00:00:00Z',
    },
    ...overrides,
  };
}

const URLS = { 'live.jpg': 'https://x/live.jpg', 'library.jpg': 'https://x/library.jpg' };

const renderCard = async (
  s: OwnerSighting = sighting(),
  photoUrls: Record<string, string> = URLS,
) => {
  const onPress = jest.fn();
  const view = await render(
    <SightingEntryCard
      sighting={s}
      photoUrls={photoUrls}
      position={1}
      count={4}
      onPress={onPress}
    />,
  );
  return Object.assign(view, { onPress });
};

/** The thumb's photo source, serialised (expo-image may wrap it), or
 *  undefined when no photo is drawn. */
const thumbUri = (view: Awaited<ReturnType<typeof renderCard>>) => {
  const photo = view.queryByTestId('timeline-entry-photo-s1');
  return photo ? JSON.stringify(photo.props.source) : undefined;
};

describe('the photo', () => {
  it('leads with the in-app photo, even when a library photo came first', async () => {
    const view = await renderCard(sighting({ photos: [libraryPhoto, livePhoto] }));
    expect(thumbUri(view)).toContain('https://x/live.jpg');
    expect(thumbUri(view)).not.toContain('library');
  });

  it('says how many more there are — and nothing for a single photo', async () => {
    const three = await renderCard(sighting({ photos: [livePhoto, libraryPhoto, livePhoto] }));
    expect(three.getByText('+2')).toBeTruthy();
    const one = await renderCard();
    expect(one.queryByText(/^\+/)).toBeNull();
  });

  it('is an empty box while its link is on the way — not a broken image, not "no photos"', async () => {
    const view = await renderCard(sighting(), {});
    expect(thumbUri(view)).toBeUndefined();
    expect(view.getByTestId('timeline-entry-thumb-s1')).toBeTruthy();
    expect(view.queryByTestId('timeline-entry-no-photo-s1')).toBeNull();
  });

  it('shows a frame mark when the sighting has no photos', async () => {
    const view = await renderCard(sighting({ photos: [] }));
    expect(thumbUri(view)).toBeUndefined();
    expect(view.getByTestId('timeline-entry-no-photo-s1')).toBeTruthy();
  });
});

describe('the time', () => {
  it('is when the in-app photo was taken — the clock alone, the rail names the day', async () => {
    const view = await renderCard();
    // Taken 09:55, sent 10:00: the card says 09:55 — and no "2h ago" beside it.
    expect(view.getByText(formatClock(livePhoto.capturedAt))).toBeTruthy();
    expect(view.queryByText(new RegExp(formatClock('2026-10-08T10:00:00Z')))).toBeNull();
    expect(view.queryByText(/ago/)).toBeNull();
    expect(view.queryByText(/Today|Yesterday/)).toBeNull();
  });

  it('⚠️ falls back to when it was sent if the phone’s clock is implausible', async () => {
    const view = await renderCard(
      sighting({ photos: [{ ...livePhoto, capturedAt: '2026-10-01T09:55:00Z' }] }),
    );
    expect(view.getByText(formatClock('2026-10-08T10:00:00Z'))).toBeTruthy();
  });
});

describe('the marks they saw', () => {
  const dent = { id: 'm1', description: 'Dent' };
  const box = { id: 'm2', description: 'Roof box' };

  it('says "Saw 2 of 3 marks" beside the time when the report recorded what it asked', async () => {
    const view = await renderCard(
      sighting({ confirmedFeatures: [dent, box], offeredFeatureIds: ['m1', 'm2', 'm3'] }),
    );
    expect(view.getByText(`${formatClock(livePhoto.capturedAt)} · Saw 2 of 3 marks`)).toBeTruthy();
  });

  it.each<[string, string[] | null]>([
    ['an older report (unknown)', null],
    ['a report that showed no marks', []],
  ])('⚠️ claims no count for %s', async (_, offered) => {
    const view = await renderCard(
      sighting({ confirmedFeatures: [dent], offeredFeatureIds: offered }),
    );
    expect(view.queryByText(/marks/)).toBeNull();
  });
});

describe('the words', () => {
  it('leads with the place — no "Seen near" on every card', async () => {
    const view = await renderCard();
    expect(view.getByText('Deansgate, Manchester')).toBeTruthy();
    expect(view.queryByText(/Seen near/)).toBeNull();
  });

  it('says honestly when the location couldn’t be captured', async () => {
    const view = await renderCard(sighting({ locationUnavailable: true, areaLabel: null }));
    expect(view.getByText('Location couldn’t be captured')).toBeTruthy();
  });

  it.each([
    ['unverified', 'Needs your answer'],
    ['helpful', 'Confirmed'],
    ['credited', 'Credited'],
    ['not_mine', 'Not your car'],
  ] as const)('a %s sighting wears "%s"', async (status, label) => {
    const view = await renderCard(sighting({ status }));
    expect(view.getByTestId('timeline-entry-status-s1')).toBeTruthy();
    expect(view.getByText(label)).toBeTruthy();
  });

  it('⚠️ "Needs your answer" is an amber TAG; an answered status is a quiet line', async () => {
    const waiting = await renderCard();
    const tag = StyleSheet.flatten(waiting.getByTestId('timeline-entry-status-s1').props.style);
    expect(tag.backgroundColor).toBe(paletteFor('light').warningSubtle);

    const answered = await renderCard(sighting({ status: 'helpful' }));
    const line = StyleSheet.flatten(answered.getByTestId('timeline-entry-status-s1').props.style);
    expect(line.backgroundColor).toBeUndefined();
  });

  it('⚠️ never says "helpful" — the old tag’s word for a confirmation', async () => {
    const view = await renderCard(sighting({ status: 'helpful' }));
    expect(view.queryByText(/helpful/i)).toBeNull();
  });

  it('carries nothing else: no context pills, no note, no spotter — the sighting page has them', async () => {
    const view = await renderCard();
    expect(view.queryByText(/Parked/)).toBeNull();
    expect(view.queryByText(/bakery/)).toBeNull();
    expect(view.queryByText(/Beth/)).toBeNull();
  });
});

describe('the card', () => {
  it('is one button with one spoken label', async () => {
    const view = await renderCard();
    const card = view.getByTestId('timeline-entry-s1');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toMatch(
      /^Deansgate, Manchester, .+, Needs your answer\. Sighting 1 of 4\. Opens details\.$/,
    );
    // Spoken in words — "5m" reads as "five metres". And the "ago" IS spoken:
    // a screen reader hears no day stop.
    expect(card.props.accessibilityLabel).not.toMatch(/\d+[mhdw] ago/);
  });

  it('speaks the marks they saw when it knows them', async () => {
    const view = await renderCard(
      sighting({
        confirmedFeatures: [{ id: 'm1', description: 'Dent' }],
        offeredFeatureIds: ['m1', 'm2'],
      }),
    );
    expect(view.getByTestId('timeline-entry-s1').props.accessibilityLabel).toContain(
      'saw 1 of 2 marks, Needs your answer.',
    );
  });

  it('shows a chevron — the cue that the card opens — hidden from screen readers', async () => {
    const view = await renderCard();
    const chevron = view.getByTestId('timeline-entry-chevron-s1', { includeHiddenElements: true });
    expect(chevron.props.accessibilityElementsHidden).toBe(true);
  });

  it('opens the sighting', async () => {
    const view = await renderCard();
    await act(async () => {
      fireEvent.press(view.getByTestId('timeline-entry-s1'));
    });
    expect(view.onPress).toHaveBeenCalledTimes(1);
  });
});

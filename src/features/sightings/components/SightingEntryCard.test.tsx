/**
 * WHAT:  Tests for SightingEntryCard — the owner's photo-first timeline card:
 *        the in-app photo leads, "+N" for the rest, an empty box while a link
 *        is on its way and a frame mark with no photos; the place (or the
 *        honest "Location couldn't be captured"); the time — the in-app
 *        photo's clock time, or when it was sent if the phone's clock is
 *        implausible; the status for every state, "Needs your answer" while
 *        undecided; nothing else on the card (no context pills, no spotter);
 *        one spoken label; the tap.
 * WHY:   The card was redesigned (2026-10-09) because it was too busy and
 *        never said which sightings were waiting on the owner. These pin both
 *        halves: what it shows, and what it no longer shows.
 * LINKS: src/features/sightings/components/SightingEntryCard.tsx;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { formatClock } from '@/shared/lib';

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
  it('is when the in-app photo was taken — the clock only, the rail names the day', async () => {
    const view = await renderCard();
    // Taken 09:55, sent 10:00: the card says 09:55.
    expect(view.getByText(new RegExp(` · ${formatClock(livePhoto.capturedAt)}$`))).toBeTruthy();
    expect(view.queryByText(new RegExp(formatClock('2026-10-08T10:00:00Z')))).toBeNull();
    expect(view.queryByText(/Today|Yesterday/)).toBeNull();
  });

  it('⚠️ falls back to when it was sent if the phone’s clock is implausible', async () => {
    const view = await renderCard(
      sighting({ photos: [{ ...livePhoto, capturedAt: '2026-10-01T09:55:00Z' }] }),
    );
    expect(view.getByText(new RegExp(` · ${formatClock('2026-10-08T10:00:00Z')}$`))).toBeTruthy();
  });
});

describe('the words', () => {
  it('leads with where it was seen', async () => {
    const view = await renderCard();
    expect(view.getByText('Seen near Deansgate, Manchester')).toBeTruthy();
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
      /^Seen near Deansgate, Manchester, .+, Needs your answer\. Sighting 1 of 4\. Opens details\.$/,
    );
    // Spoken in words — "5m" reads as "five metres".
    expect(card.props.accessibilityLabel).not.toMatch(/\d+[mhdw] ago/);
  });

  it('opens the sighting', async () => {
    const view = await renderCard();
    await act(async () => {
      fireEvent.press(view.getByTestId('timeline-entry-s1'));
    });
    expect(view.onPress).toHaveBeenCalledTimes(1);
  });
});

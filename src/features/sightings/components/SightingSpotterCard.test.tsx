/**
 * WHAT:  Tests for "Spotted by": the one record line (non-zero counts,
 *        sightings first, then when they joined — a bad date costs only that
 *        part), Message always on the card, and no "View profile".
 * WHY:   The card was cut to one line and one button (owner, 2026-10-19);
 *        Message used to come and go with the owner's answer.
 * LINKS: src/features/sightings/components/SightingSpotterCard.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { OwnerSighting } from '../types';
import { SightingSpotterCard, spotterRecordLine } from './SightingSpotterCard';

const spotter = (overrides: Partial<OwnerSighting['spotter']> = {}): OwnerSighting['spotter'] => ({
  firstName: 'Sam',
  sightingsReported: 12,
  sightingsHelpful: 4,
  recoveriesCredited: 1,
  memberSince: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('spotterRecordLine', () => {
  it('reads every non-zero count, then when they joined', () => {
    expect(spotterRecordLine(spotter())).toBe(
      '12 sightings · 4 confirmed by owners · 1 recovery · since July 2026',
    );
  });

  it('leaves out what is zero — but always says how many sightings', () => {
    expect(
      spotterRecordLine(
        spotter({ sightingsReported: 1, sightingsHelpful: 0, recoveriesCredited: 0 }),
      ),
    ).toBe('1 sighting · since July 2026');
  });

  it('an unparseable join date costs that part, never the line', () => {
    expect(spotterRecordLine(spotter({ memberSince: 'not a date' }))).toBe(
      '12 sightings · 4 confirmed by owners · 1 recovery',
    );
  });
});

describe('SightingSpotterCard', () => {
  it('always offers Message — and nothing that repeats the card', async () => {
    const onMessage = jest.fn();
    const view = await render(<SightingSpotterCard spotter={spotter()} onMessage={onMessage} />);
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Message Sam' }));
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(view.queryByText('View profile')).toBeNull();
    expect(view.queryByText(/^Member since/)).toBeNull();
  });
});

/**
 * WHAT:  Tests for the redesigned ReputationCard — narrative highlight rows
 *        (never raw zeros), emblem badges (icon for firsts, number for
 *        5/25 tiers), the single next-goal line with progress, and the
 *        warm fresh-account story.
 * WHY:   Reputation is server-maintained social proof (docs/DOMAIN.md); the
 *        card must tell exactly the story the counters permit — and a new
 *        user's empty card is most users' card, so its warmth is pinned.
 * LINKS: src/features/profile/components/ReputationCard.tsx;
 *        src/features/profile/lib/reputation.ts.
 */

import { render } from '@testing-library/react-native';

import { ReputationCard } from './ReputationCard';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: (c: unknown) => c },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});

const CREATED_AT = '2026-05-14T09:00:00Z';

describe('ReputationCard', () => {
  it('leads with narrative highlights, strongest first', async () => {
    const { getByText, queryByText } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );
    expect(getByText('Helped recover 1 car')).toBeTruthy();
    expect(getByText('4 sightings helped owners')).toBeTruthy();
    expect(getByText('7 sightings reported')).toBeTruthy();
    // No dashboard row, no zeros, no since-duplication with the header.
    expect(queryByText('Sightings')).toBeNull();
    expect(queryByText(/Spotting since/)).toBeNull();
  });

  it('earned badges render as emblems; the next goal shows once with progress', async () => {
    const { getByTestId, queryByTestId, getByText } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );
    expect(getByTestId('badge-earned-sightingsReported-1')).toBeTruthy();
    expect(getByTestId('badge-earned-sightingsReported-5')).toBeTruthy();
    expect(getByTestId('badge-earned-recoveriesCredited-1')).toBeTruthy();
    expect(queryByTestId('badge-earned-sightingsHelpful-5')).toBeNull(); // not earned
    expect(getByText('Next badge: 5 helpful marks')).toBeTruthy();
    expect(getByText('4 of 5')).toBeTruthy();
  });

  it('5/25 tier emblems show the number, first badges the icon', async () => {
    const { getByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 5, sightingsHelpful: 0, recoveriesCredited: 0 }}
        createdAt={CREATED_AT}
      />,
    );
    const tierEmblem = getByTestId('badge-earned-sightingsReported-5');
    expect(tierEmblem.props.accessibilityLabel).toBe('Badge earned: 5 sightings');
  });

  it('a fresh account gets the invitation and the first goal at zero — no zeros row', async () => {
    const { getByText, queryByText } = await render(
      <ReputationCard
        counters={{ sightingsReported: 0, sightingsHelpful: 0, recoveriesCredited: 0 }}
        createdAt={CREATED_AT}
      />,
    );
    expect(getByText('Your first sighting starts your spotter story.')).toBeTruthy();
    expect(getByText('Spotting since May 2026')).toBeTruthy();
    expect(getByText('Next badge: First sighting')).toBeTruthy();
    expect(getByText('0 of 1')).toBeTruthy();
    expect(queryByText('0')).toBeNull(); // never a bare zero anywhere
  });
});

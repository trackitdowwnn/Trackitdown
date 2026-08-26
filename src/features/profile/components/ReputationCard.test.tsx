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

  it('⚠️ publishes the WHOLE ladder, not just the next step', async () => {
    // The reference's lesson (Superhost): criteria are published, so you can
    // see what you are working toward AND what lies beyond it. This card used
    // to show earned emblems plus one "Next badge" line, so a spotter on 3
    // could not tell whether 3 was the end of the road.
    const { getByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );

    for (const rung of [1, 3, 10, 25]) {
      expect(getByTestId(`ladder-rung-${rung}`)).toBeTruthy();
    }
  });

  it('⚠️ says whether each rung is earned, because the marker cannot', async () => {
    // Earned vs unearned is a filled circle against a hollow one — colour and
    // shape, invisible to a screen reader. The state has to be in the label.
    const { getByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );

    expect(getByTestId('ladder-rung-3').props.accessibilityLabel).toBe(
      '3 confirmed sightings: earned',
    );
    expect(getByTestId('ladder-rung-10').props.accessibilityLabel).toBe(
      '10 confirmed sightings: 4 of 10',
    );
    expect(getByTestId('ladder-rung-25').props.accessibilityLabel).toBe(
      '25 confirmed sightings: not yet earned',
    );
  });

  it('puts the progress bar on the rung in play and nowhere else', async () => {
    // On an earned rung it would be full and on a distant one empty — both of
    // which the marker already says.
    // ⚠️ QUERIED BY testID, NOT BY TEXT. Each rung is an `accessible` wrapper
    // carrying its state in an accessibilityLabel, so "4 of 10" exists twice in
    // the tree — once as the visible caption and once inside the label. Text
    // queries find both, which says nothing about how many bars there are.
    const { getAllByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );

    expect(getAllByTestId('next-badge')).toHaveLength(1);
    expect(getAllByTestId('next-badge')[0].props.children.join('')).toBe('4 of 10');
  });

  it('⚠️ badges come from CONFIRMED sightings only', async () => {
    // The accepted cost of one ladder: reported sightings and recoveries no
    // longer earn anything. This spotter has 7 reported and 1 recovery and is
    // still on the first rung.
    const { getByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 7, sightingsHelpful: 0, recoveriesCredited: 1 }}
        createdAt={CREATED_AT}
      />,
    );

    expect(getByTestId('ladder-rung-1').props.accessibilityLabel).toBe(
      'First confirmed sighting: 0 of 1',
    );
  });

  it('a fresh account gets the invitation and the ladder at zero', async () => {
    const { getByText, getByTestId } = await render(
      <ReputationCard
        counters={{ sightingsReported: 0, sightingsHelpful: 0, recoveriesCredited: 0 }}
        createdAt={CREATED_AT}
      />,
    );
    expect(getByText('Your first sighting starts your spotter story.')).toBeTruthy();
    expect(getByText('Spotting since May 2026')).toBeTruthy();
    // The ladder is the same four rungs on day one — published criteria means
    // a brand-new spotter can see the whole road, not a locked door.
    expect(getByTestId('ladder-rung-25')).toBeTruthy();
    expect(getByTestId('next-badge').props.children.join('')).toBe('0 of 1');
  });
});

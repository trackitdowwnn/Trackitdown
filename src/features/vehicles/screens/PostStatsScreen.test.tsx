/**
 * WHAT:  Tests for the stats screen — the four states (loading, error, not
 *        found, ready) and the two that carry the design decisions: a listing
 *        with nothing yet, and one with activity.
 * WHY:   The sparse case is the one that matters. Most listings show zero
 *        sightings for most of their life, on a screen belonging to someone
 *        whose car was stolen this week — so "no sightings" must render as a
 *        sentence, never as a 0 next to a chart, and the reach numbers must
 *        still be there to say the listing IS out being seen. That ordering is
 *        the whole design and it is only visible in a test like this one.
 *
 *        `notFound` is asserted separately from `error` on purpose: the RPC
 *        returns null both for a post the caller does not own and for one that
 *        does not exist, so an owner who just deleted a listing must see "not
 *        found", not "something went wrong".
 * LINKS: ./PostStatsScreen.tsx; ../hooks/usePostStats.ts;
 *        supabase/migrations/20260807130000_post_stats.sql.
 */

import { render } from '@testing-library/react-native';

import type { PostStats } from '../api/postStatsApi';
import { PostStatsScreen } from './PostStatsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: () => {},
}));

let mockState: { status: string; stats: PostStats | null } = { status: 'loading', stats: null };
const mockRetry = jest.fn();
jest.mock('../hooks/usePostStats', () => ({
  usePostStats: () => ({ ...mockState, retry: mockRetry }),
}));

const stats = (over: Partial<PostStats> = {}): PostStats => ({
  spottersAlerted: 128,
  createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  expiresAt: new Date(Date.now() + 78 * 86_400_000).toISOString(),
  sightingsTotal: 0,
  sightingsUnverified: 0,
  sightingsHelpful: 0,
  sightingsCredited: 0,
  sightingsNotMine: 0,
  firstSightingAt: null,
  lastSightingAt: null,
  sightingsByDay: [],
  conversations: 0,
  messages: 0,
  ...over,
});

const today = () => new Date().toISOString().slice(0, 10);

describe('PostStatsScreen states', () => {
  it('shows a shaped placeholder while loading, not a spinner', async () => {
    mockState = { status: 'loading', stats: null };

    const { getByTestId } = await render(<PostStatsScreen postId="p1" />);

    expect(getByTestId('stats-skeleton')).toBeTruthy();
  });

  it('offers a retry on error', async () => {
    mockState = { status: 'error', stats: null };

    const { getByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText(/couldn’t load/i)).toBeTruthy();
  });

  // A post that is not yours and a post that does not exist are the same null
  // from the server, by design. Neither is an error the owner can retry.
  it('says NOT FOUND rather than "something went wrong"', async () => {
    mockState = { status: 'notFound', stats: null };

    const { getByText, queryByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText(/not found/i)).toBeTruthy();
    expect(queryByText(/couldn’t load/i)).toBeNull();
  });

  // Headers are hidden app-wide (_layout.tsx `headerShown: false`), so the way
  // back is drawn by the screen. It has to exist in EVERY state — the notFound
  // and error branches are the ones where a stranded reader has nothing else,
  // and they are exactly the branches an early draft rendered without it.
  it.each(['loading', 'error', 'notFound', 'ready'] as const)(
    'draws a back control in the %s state',
    async (status) => {
      mockState = { status, stats: status === 'ready' ? stats() : null };

      const { getByTestId } = await render(<PostStatsScreen postId="p1" />);

      expect(getByTestId('stats-back')).toBeTruthy();
    },
  );

  it('offers a way out of the dead end, not a retry that cannot succeed', async () => {
    mockState = { status: 'notFound', stats: null };

    const { getByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText('Go back')).toBeTruthy();
  });
});

describe('a listing with nothing yet — the common case', () => {
  beforeEach(() => {
    mockState = { status: 'ready', stats: stats() };
  });

  // The point of the whole layout: reach is true even when the outcome is not.
  it('still leads with what the app DID', async () => {
    const { getByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText('128')).toBeTruthy();
    expect(getByText('spotters alerted')).toBeTruthy();
  });

  it('writes the absence as a sentence, never as a zero', async () => {
    const { getByText, queryByTestId } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText(/No sightings reported yet/)).toBeTruthy();
    // No big "0" under the Sightings heading, and no empty chart under it.
    expect(queryByTestId('stats-sightings-total')).toBeNull();
    expect(queryByTestId('stats-sparkline')).toBeNull();
  });

  // The same rule, one card down. "Conversations 0 / Messages 0" is the wall
  // of zeros this screen exists to avoid — caught by a test that was written
  // to assert the sightings block and found the contact block instead.
  it('writes "nobody has been in touch" as a sentence too', async () => {
    const { getByText, queryByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText(/No one has messaged you/)).toBeTruthy();
    expect(queryByText('Conversations')).toBeNull();
  });

  it('tells them how long it has been live and how long is left', async () => {
    const { getByText, getByLabelText } = await render(<PostStatsScreen postId="p1" />);

    // The age is a stat-band cell now (number over label), not a sentence —
    // so the spoken label is what a reader actually gets.
    expect(getByLabelText('Live for 12 days')).toBeTruthy();
    expect(getByText('days live')).toBeTruthy();
    expect(getByText(/78 days left/)).toBeTruthy();
  });

  // A draft never went live, so it has no clock. "0 days left" would read as
  // "about to be deleted" to someone whose car is still missing.
  it('omits the countdown entirely when there is no expiry', async () => {
    mockState = { status: 'ready', stats: stats({ expiresAt: null }) };

    const { queryByText, getByLabelText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByLabelText('Live for 12 days')).toBeTruthy();
    expect(queryByText(/days left/)).toBeNull();
  });

  // Degrade by omission (profile/REFERENCE_SPEC): the band drops the cell it
  // has nothing to say about rather than showing a floored zero.
  it('drops the alert cell entirely when the count is below the floor', async () => {
    mockState = { status: 'ready', stats: stats({ spottersAlerted: 0 }) };

    const { queryByTestId, getByTestId } = await render(<PostStatsScreen postId="p1" />);

    expect(queryByTestId('stat-alerted')).toBeNull();
    expect(getByTestId('stat-live')).toBeTruthy();
  });
});

describe('a listing with activity', () => {
  it('shows the total and the honest status split', async () => {
    mockState = {
      status: 'ready',
      stats: stats({
        sightingsTotal: 3,
        sightingsUnverified: 1,
        sightingsHelpful: 1,
        sightingsCredited: 1,
        firstSightingAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        lastSightingAt: new Date(Date.now() - 86_400_000).toISOString(),
        sightingsByDay: [{ day: today(), count: 3 }],
        conversations: 1,
        messages: 2,
      }),
    };

    const { getByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText('3')).toBeTruthy();
    expect(getByText(/1 credited · 1 helpful · 1 unverified/)).toBeTruthy();
    expect(getByText(/First .* · latest /)).toBeTruthy();
  });

  // Singular reads as a report, not as a data point.
  it('reads a single sighting as one event, not a range', async () => {
    const at = new Date(Date.now() - 86_400_000).toISOString();
    mockState = {
      status: 'ready',
      stats: stats({
        sightingsTotal: 1,
        sightingsUnverified: 1,
        firstSightingAt: at,
        lastSightingAt: at,
        sightingsByDay: [{ day: today(), count: 1 }],
      }),
    };

    const { getByText, queryByText } = await render(<PostStatsScreen postId="p1" />);

    expect(getByText(/^Reported /)).toBeTruthy();
    expect(queryByText(/latest/)).toBeNull();
  });

  // Every sighting older than the chart window: a flat row of empty bars would
  // claim there was never any activity, which the first/last line disproves.
  it('drops the chart when all activity predates the window', async () => {
    mockState = {
      status: 'ready',
      stats: stats({
        sightingsTotal: 2,
        sightingsUnverified: 2,
        firstSightingAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        lastSightingAt: new Date(Date.now() - 99 * 86_400_000).toISOString(),
        sightingsByDay: [{ day: '2026-01-01', count: 2 }],
      }),
    };

    const { queryByTestId, getByText } = await render(<PostStatsScreen postId="p1" />);

    expect(queryByTestId('stats-sparkline')).toBeNull();
    expect(getByText('2')).toBeTruthy();
  });

  // The positive half of the pair above. Without it, both chart assertions are
  // "queryByTestId returns null", which is also what a typo returns — this is
  // the test that proves the testID is real and the chart renders at all.
  it('draws the chart when the activity is inside the window', async () => {
    mockState = {
      status: 'ready',
      stats: stats({
        sightingsTotal: 2,
        sightingsUnverified: 2,
        firstSightingAt: new Date(Date.now() - 86_400_000).toISOString(),
        lastSightingAt: new Date().toISOString(),
        sightingsByDay: [{ day: today(), count: 2 }],
      }),
    };

    const { getByTestId } = await render(<PostStatsScreen postId="p1" />);

    expect(getByTestId('stats-sparkline')).toBeTruthy();
  });
});

/**
 * WHAT:  Tests for MapPins — pill vs mini rendering, selection promoting a
 *        mini to a pill, presses firing from both, and the marker key staying
 *        stable when only emphasis changes.
 * WHY:   That last one is the regression guard for a real performance trap.
 *        Emphasis flips on every pan (the top-N set churns), so if it ever
 *        gets folded back into the React key, dozens of markers remount per
 *        pan and each re-arms 500ms of tracksViewChanges — the exact Android
 *        jank MapPins was written to avoid. It cannot be caught by eye in a
 *        simulator; it has to be asserted.
 * LINKS: src/features/search-map/components/MapPins.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { MapPinItem, MapPost } from '../types';
import { MapPins } from './MapPins';

// The real marker needs react-native-maps; render a plain View that keeps the
// props we assert on. `testID` carries the key so we can watch it change.
jest.mock('@/shared/ui/AppMap', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable } = require('react-native');
  return {
    AppMapMarker: ({
      children,
      onPress,
      accessibilityLabel,
      accessible,
      zIndex,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
      accessible?: boolean;
      zIndex?: number;
    }) =>
      React.createElement(
        Pressable,
        {
          onPress,
          accessibilityLabel,
          accessible,
          testID: 'marker',
          // Paint order is invisible in a simulator as well as in jest, so it
          // has to come back out as an assertable prop.
          'data-zindex': zIndex,
        },
        children,
      ),
  };
});

const post = (id: string, bountyPence: number): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence,
  latitude: 51.75,
  longitude: -0.34,
});

const pin = (id: string, rank: number, bountyPence = 25000): MapPinItem => ({
  type: 'post',
  key: id,
  post: post(id, bountyPence),
  rank,
});

const renderPins = async (pins: MapPinItem[], selectedPostId: string | null = null) =>
  act(async () =>
    render(
      <MapPins
        pins={pins}
        selectedPostId={selectedPostId}
        onPressPost={jest.fn()}
      />,
    ),
  );

describe('one marker, one price', () => {
  // The price-less second tier went on 2026-08-07: a marker with no price on it
  // reads as a GROUP, because there is nothing else it could be saying. The
  // owner reported it as "grouping" four times before that landed. This is the
  // guard against a well-meaning reintroduction of a quiet tier.
  it('draws the bounty on EVERY marker, whatever its rank', async () => {
    const view = await renderPins([pin('a', 0, 25000), pin('b', 30, 4500)]);

    expect(view.getByText('£250')).toBeTruthy();
    expect(view.getByText('£45')).toBeTruthy();
  });

  it('keeps the full accessible label', async () => {
    const { getByLabelText } = await renderPins([pin('a', 5, 25000)]);

    expect(getByLabelText('£250 bounty — Ford Fiesta')).toBeTruthy();
  });

  it('fires onPressPost — a marker you cannot tap is a lie', async () => {
    const onPressPost = jest.fn();
    const view = await act(async () =>
      render(
        <MapPins
          pins={[pin('a', 9)]}
          selectedPostId={null}
          onPressPost={onPressPost}
        />,
      ),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('marker'));
    });

    expect(onPressPost).toHaveBeenCalledWith('a');
  });
});

describe('marker identity (the jank guard)', () => {
  // If selection ever returns to the React key, this fails — and the marker
  // would remount and re-arm 500ms of tracksViewChanges on every tap.
  it('does NOT remount a marker when only its selection changes', async () => {
    const view = await renderPins([pin('a', 0)]);
    const before = view.getByTestId('marker');

    await act(async () => {
      view.rerender(
        <MapPins
          pins={[pin('a', 0)]}
          selectedPostId="a"
          onPressPost={jest.fn()}
        />,
      );
    });

    // Same node instance = React reconciled rather than remounted.
    expect(view.getByTestId('marker')).toBe(before);
  });

  it('does NOT remount a marker when only its RANK changes', async () => {
    const view = await renderPins([pin('a', 0)]);
    const before = view.getByTestId('marker');

    // Rank churns on every pan as the in-view population changes.
    await act(async () => {
      view.rerender(
        <MapPins
          pins={[pin('a', 17)]}
          selectedPostId={null}
          onPressPost={jest.fn()}
        />,
      );
    });

    expect(view.getByTestId('marker')).toBe(before);
  });
});

describe('every post gets its own marker', () => {
  // Clustering was removed 2026-08-06 and the price-less tier 2026-08-07 —
  // nothing collapses or hides anything now.
  it('renders one marker per pin', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 1), pin('c', 2)]);

    expect(view.getAllByTestId('marker')).toHaveLength(3);
  });
});

describe('paint order and the assistive-tech path', () => {
  const zIndexOf = (node: { props: Record<string, unknown> }) => node.props['data-zindex'] as number;

  // Under heavy overlap — the normal case now that every marker is a full-width
  // pill — paint order is what decides which marker a tap HITS, and between
  // overlapping Android markers with equal zIndex that order is undefined.
  it('paints the highest bounty above the rest', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 1), pin('c', 2)]);

    const [first, second, third] = view.getAllByTestId('marker').map(zIndexOf);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
  });

  it('puts the SELECTED marker above everything', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 40)], 'b');

    const [top, selected] = view.getAllByTestId('marker').map(zIndexOf);
    expect(selected).toBeGreaterThan(top);
  });

  // Never 0: the iOS Google marker skips a falsy zIndex when it re-creates.
  it('never assigns a falsy z-index, however deep the rank', async () => {
    const view = await renderPins([pin('a', 5000)]);

    expect(zIndexOf(view.getByTestId('marker'))).toBeGreaterThan(0);
  });

  // ⚠️ The DRAWN set and the REACHABLE set deliberately differ. Every marker is
  // drawn and tappable, but leaving all of them individually focusable makes a
  // screen-reader user swipe through up to a hundred to get past the map — and
  // the sheet lists every car with more detail and a live count.
  it('keeps low-ranked markers out of the assistive-tech tree', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 90)]);

    const [top, deep] = view.getAllByTestId('marker');
    expect(top.props.accessible).toBe(true);
    expect(deep.props.accessible).toBe(false);
  });

  it('but a SELECTED low-ranked marker stays reachable', async () => {
    const view = await renderPins([pin('a', 90)], 'a');

    expect(view.getByTestId('marker').props.accessible).toBe(true);
  });
});

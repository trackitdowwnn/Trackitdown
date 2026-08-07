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
import { StyleSheet } from 'react-native';

import { colors, sizes } from '@/shared/theme';

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

const pin = (id: string, emphasis: 'full' | 'mini', bountyPence = 25000): MapPinItem => ({
  type: 'post',
  key: id,
  post: post(id, bountyPence),
  emphasis,
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

describe('pill vs mini', () => {
  it('draws the bounty on a full pin', async () => {
    const { getByText } = await renderPins([pin('a', 'full', 25000)]);

    expect(getByText('£250')).toBeTruthy();
  });

  it('draws NO price on a mini pin — that is the whole point of it', async () => {
    const { queryByText } = await renderPins([pin('a', 'mini', 25000)]);

    expect(queryByText('£250')).toBeNull();
  });

  // A selected dot would be nearly invisible on the map.
  it('promotes a selected mini back to a pill', async () => {
    const { getByText } = await renderPins([pin('a', 'mini', 25000)], 'a');

    expect(getByText('£250')).toBeTruthy();
  });

  // The label is not the visual — a screen reader user gets the bounty either
  // way, so demotion must never cost them information.
  it('keeps the full accessible label on a mini pin', async () => {
    const { getByLabelText } = await renderPins([pin('a', 'mini', 25000)]);

    expect(getByLabelText('£250 bounty — Ford Fiesta')).toBeTruthy();
  });

  // The reference draws the demoted pin as its price pill with the price
  // hidden — a lozenge, not a dot — so the two read as one family.
  it('draws the mini pin as a LOZENGE, not a circle', async () => {
    const view = await renderPins([pin('a', 'mini')]);

    const style = StyleSheet.flatten(view.getByTestId('mini-pin').props.style);
    expect(style.width).toBe(sizes.mapPinMiniWidth);
    expect(style.height).toBe(sizes.mapPinMiniHeight);
    expect(style.width).toBeGreaterThan(style.height);
  });

  // REGRESSION GUARD, and the one place this is written down in code: the
  // reference's demoted pin is WHITE, and copying that is the obvious
  // "match the screenshots" change to make. It cannot be made. mapStyle.ts
  // paints land #EEEEEE and roads #FFFFFF — a white 18×11 lozenge is invisible
  // on both, and at that size a hairline border is the entire mark. The ink
  // stays ours; only the anatomy is borrowed.
  it('never goes WHITE — it would vanish on our map style', async () => {
    const view = await renderPins([pin('a', 'mini')]);

    const style = StyleSheet.flatten(view.getByTestId('mini-pin').props.style);
    expect(style.backgroundColor).not.toBe(colors.surface);
  });

  // ...but it is not the blackest ink on the map either. Filling the DEMOTED
  // tier with `primary` outshouted the priced pill (a white fill + hairline)
  // and inverted the hierarchy the two tiers exist to express.
  it('is quieter than the priced tier, not louder', async () => {
    const view = await renderPins([pin('a', 'mini')]);

    const style = StyleSheet.flatten(view.getByTestId('mini-pin').props.style);
    expect(style.backgroundColor).toBe(colors.textSecondary);
    expect(style.backgroundColor).not.toBe(colors.primary);
  });

  it('fires onPressPost from a mini pin — a dot you cannot tap is a lie', async () => {
    const onPressPost = jest.fn();
    const view = await act(async () =>
      render(
        <MapPins
          pins={[pin('a', 'mini')]}
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
  // If emphasis ever returns to the React key, this fails — and dozens of
  // markers would remount on every pan in the real app.
  it('does NOT remount a marker when only its emphasis changes', async () => {
    const view = await renderPins([pin('a', 'full')]);
    const before = view.getByTestId('marker');

    await act(async () => {
      view.rerender(
        <MapPins
          pins={[pin('a', 'mini')]}
          selectedPostId={null}
          onPressPost={jest.fn()}
        />,
      );
    });

    // Same node instance = React reconciled rather than remounted.
    expect(view.getByTestId('marker')).toBe(before);
  });

  it('does NOT remount a marker when only its selection changes', async () => {
    const view = await renderPins([pin('a', 'full')]);
    const before = view.getByTestId('marker');

    await act(async () => {
      view.rerender(
        <MapPins
          pins={[pin('a', 'full')]}
          selectedPostId="a"
          onPressPost={jest.fn()}
        />,
      );
    });

    expect(view.getByTestId('marker')).toBe(before);
  });
});

describe('every post gets its own marker', () => {
  // Clustering was removed 2026-08-06 — nothing collapses any more, so the
  // renderer must draw one marker per pin however many there are.
  it('renders one marker per pin', async () => {
    const view = await renderPins([pin('a', 'full'), pin('b', 'mini'), pin('c', 'mini')]);

    expect(view.getAllByTestId('marker')).toHaveLength(3);
  });
});

describe('paint order and the assistive-tech path', () => {
  const zIndexOf = (node: { props: Record<string, unknown> }) => node.props['data-zindex'];

  // Paint order is invisible in a simulator AND in jest, and it decides which
  // of up to a hundred overlapping 44pt targets a tap resolves to.
  it('stacks selected above priced above demoted', async () => {
    const view = await renderPins([pin('a', 'full'), pin('b', 'mini'), pin('c', 'mini')], 'c');

    const [priced, demoted, selected] = view.getAllByTestId('marker');
    expect(zIndexOf(priced)).toBe(2);
    expect(zIndexOf(demoted)).toBe(1);
    expect(zIndexOf(selected)).toBe(3);
  });

  // Never 0: the iOS Google marker skips a falsy zIndex when it re-creates.
  it('never assigns a falsy z-index', async () => {
    const view = await renderPins([pin('a', 'mini')]);

    expect(zIndexOf(view.getByTestId('marker'))).toBeGreaterThan(0);
  });

  // Clustering used to bound the marker count. Without it, leaving every dot
  // individually focusable makes a screen-reader user swipe through up to a
  // hundred of them to reach the sheet — which lists them all with more detail.
  it('keeps demoted pins out of the assistive-tech tree', async () => {
    const view = await renderPins([pin('a', 'full'), pin('b', 'mini')]);

    const [priced, demoted] = view.getAllByTestId('marker');
    expect(priced.props.accessible).toBe(true);
    expect(demoted.props.accessible).toBe(false);
  });

  it('but a SELECTED demoted pin stays reachable', async () => {
    const view = await renderPins([pin('a', 'mini')], 'a');

    expect(view.getByTestId('marker').props.accessible).toBe(true);
  });
});

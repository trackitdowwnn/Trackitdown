/**
 * WHAT:  Tests for MapPins — one priced pill per post, the marker box
 *        containing its own shadow and keeping one footprint across selection,
 *        paint order, and WHAT MAY RE-ARM RASTERISATION: what is DRAWN must
 *        (selection, the price), what is not must not (rank, make/model) — and
 *        that it re-arms IN PLACE, never by remounting the marker.
 * WHY:   All three have bitten, in three different ways. RANK churns on every
 *        pan, so re-arming for it holds dozens of tracksViewChanges windows
 *        open per gesture — the Android jank this component exists to avoid.
 *        SELECTION and the PRICE are the opposite: a marker frozen with a
 *        stale bitmap shows the wrong fill, or the wrong money. And REMOUNTING
 *        to force either is the trap that looks like the fix: a recreated
 *        native marker wears react-native-maps' default RED PIN until it
 *        rasterises and swallows taps meanwhile (owner, on device 2026-09-23).
 *        None of the three can be caught by eye in a simulator.
 * LINKS: src/features/search-map/components/MapPins.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { shadows, sizes } from '@/shared/theme';

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
      tracksViewChanges,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
      accessible?: boolean;
      zIndex?: number;
      tracksViewChanges?: boolean;
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
          // So is the tracking window, and it is per-frame bitmap work — the
          // difference between a tap that feels instant and one that does not.
          tracksViewChanges,
        },
        children,
      ),
  };
});

const mockLightHaptic = jest.fn();
// ⚠️ The arrow is load-bearing. `jest.mock` is hoisted ABOVE the `const` above
// it, so `lightHaptic: mockLightHaptic` — the obvious simplification — throws a
// TDZ ReferenceError at module init. Calling it lazily defers the read.
jest.mock('@/shared/lib/haptics', () => ({
  lightHaptic: () => mockLightHaptic(),
}));

beforeEach(() => {
  mockLightHaptic.mockClear();
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

    expect(getByLabelText('£250 reward — Ford Fiesta')).toBeTruthy();
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

  it('ticks the finger on tap — a marker has no pressed state of its own', async () => {
    // Until the card springs up nothing acknowledges the tap: a marker is a
    // native map overlay, not a Pressable. The same light tick the app gives a
    // colour swatch or a watch toggle.
    const view = await renderPins([pin('a', 9)]);

    await act(async () => {
      fireEvent.press(view.getByTestId('marker'));
    });

    expect(mockLightHaptic).toHaveBeenCalledTimes(1);
  });

  it('⚠️ still ticks when the tapped marker is ALREADY selected', async () => {
    // Re-tapping a selected pin changes nothing on screen — the sheet snap
    // early-returns — so the tick is the only acknowledgement that the tap
    // landed. A well-meaning "don't re-fire on a no-op" guard would take the
    // feedback away from the one case that has nothing else.
    const view = await renderPins([pin('a', 9)], 'a');

    await act(async () => {
      fireEvent.press(view.getByTestId('marker'));
    });

    expect(mockLightHaptic).toHaveBeenCalledTimes(1);
  });
});

describe('⚠️ the marker box contains its own shadow', () => {
  // A marker's children are rasterised to the wrapper's BOUNDS, so a shadow
  // drawn outside them is cut off — which is how the selected pill came back
  // with its bottom clipped (owner, on device, 2026-09-22). The box must clear
  // the shadow's reach on every side, and SYMMETRICALLY: the anchor is the
  // box's centre, so buying the room at the bottom alone would slide every
  // pill north of the coordinate it is reporting.
  const wrapperOf = (view: Awaited<ReturnType<typeof renderPins>>) =>
    StyleSheet.flatten(
      (view.getByTestId('marker').children[0] as { props: { style?: unknown } }).props.style,
    ) as { padding?: number; minHeight?: number };

  const shadowReach = shadows.soft.shadowOffset.height + shadows.soft.shadowRadius;

  it('pads by the shadow\'s reach, on all four sides', async () => {
    const view = await renderPins([pin('a', 5, 25000)]);

    const wrapper = wrapperOf(view);
    expect(wrapper.padding).toBe(shadowReach);
    // Still at least a 44pt target — the padding only ever grows the box.
    expect(wrapper.minHeight).toBe(sizes.touchTarget);
  });

  it('pads the SELECTED marker the same way — it is the one that grows', async () => {
    const view = await act(async () =>
      render(<MapPins pins={[pin('a', 5, 25000)]} selectedPostId="a" onPressPost={jest.fn()} />),
    );

    expect(wrapperOf(view).padding).toBe(shadowReach);
  });

  // ⚠️ THE ONE THAT MATTERS. Selection swaps the pill's padding for a larger
  // one, which changed the marker VIEW's size — and an Android marker whose
  // icon resizes while it is being re-tracked comes back half drawn. With pins
  // overlapping, that read as the selected pill cut in half by its neighbours.
  // The unselected pill carries the difference as transparent margin, so the
  // drawn pill still grows while the FOOTPRINT never does.
  it('keeps the same outer footprint selected and unselected', async () => {
    const pillOf = (view: Awaited<ReturnType<typeof renderPins>>) => {
      const wrapper = view.getByTestId('marker').children[0] as {
        children: { props: { style?: unknown } }[];
      };
      return StyleSheet.flatten(wrapper.children[0].props.style) as {
        paddingHorizontal: number;
        paddingVertical: number;
        margin: number;
      };
    };

    const unselected = pillOf(await renderPins([pin('a', 5, 25000)]));
    const selected = pillOf(
      await act(async () =>
        render(<MapPins pins={[pin('a', 5, 25000)]} selectedPostId="a" onPressPost={jest.fn()} />),
      ),
    );

    // The drawn pill really does grow on selection...
    expect(selected.paddingHorizontal).toBeGreaterThan(unselected.paddingHorizontal);
    expect(selected.paddingVertical).toBeGreaterThan(unselected.paddingVertical);
    // ...and padding + margin — the space the marker actually occupies — is
    // identical, so the bitmap never needs re-measuring.
    expect(selected.paddingHorizontal + selected.margin).toBe(
      unselected.paddingHorizontal + unselected.margin,
    );
    expect(selected.paddingVertical + selected.margin).toBe(
      unselected.paddingVertical + unselected.margin,
    );
  });
});

/** Whether the marker is currently re-rasterising every frame. */
const trackingOf = (view: Awaited<ReturnType<typeof renderPins>>) =>
  view.getByTestId('marker').props.tracksViewChanges as boolean;

describe('⚠️ the tracking window (the other jank guard)', () => {
  // `tracksViewChanges` means 're-rasterise this custom view EVERY FRAME', so
  // the window is real bitmap work. It is armed on mount and again whenever
  // retrackKey changes, and it must NOT be cut short: freezing before the
  // native tracker has captured the view leaves react-native-maps' default
  // pin on screen — the red marker the owner saw flicker in (2026-09-23).
  it('tracks from mount and freezes once settled', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      expect(trackingOf(view)).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(trackingOf(view)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('marker identity (the jank guard)', () => {
  // ⚠️ REVERSED, then REVERSED BACK on 2026-09-23. For one day this asserted
  // that selection REMOUNTS the marker — the reasoning being that a repaint is
  // unreliable on Android, so destroying the marker guarantees a fresh icon.
  // It guarantees something else too: react-native-maps draws its DEFAULT RED
  // PIN on a freshly-created marker until the custom view has rasterised, and
  // the marker is not tappable while it is being recreated. The owner saw both
  // on device — "the red marker flicker into view then back to the price
  // marker", and taps that did not register.
  //
  // So a change to what is DRAWN re-arms `tracksViewChanges` IN PLACE (the
  // `retrackKey` prop) and the React key stays `pin.key`. The clipping that
  // sent us down the remount road had a different cause and a different fix:
  // the pill now keeps ONE FOOTPRINT across selection, asserted above.
  it('re-rasterises IN PLACE when selection changes — same marker, new bitmap', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const before = view.getByTestId('marker');
      expect(trackingOf(view)).toBe(false);

      await act(async () => {
        view.rerender(
          <MapPins
            pins={[pin('a', 0)]}
            selectedPostId="a"
            onPressPost={jest.fn()}
          />,
        );
      });

      // The SAME native marker — no destroy, so no red pin and no dead tap.
      expect(view.getByTestId('marker')).toBe(before);
      // ...drawing itself again, so the selected fill is what shows.
      expect(trackingOf(view)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('⚠️ re-rasterises when the PRICE changes — a frozen marker keeps its old bitmap', async () => {
    // The pill is rasterised once and frozen, so a reward the owner raised
    // landed in the React tree while the map kept showing the old figure. A
    // price that is wrong is worse than one that is late.
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0, 25000)]);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const before = view.getByTestId('marker');
      expect(view.getByText('£250')).toBeTruthy();
      expect(trackingOf(view)).toBe(false);

      await act(async () => {
        view.rerender(
          <MapPins pins={[pin('a', 0, 40000)]} selectedPostId={null} onPressPost={jest.fn()} />,
        );
      });

      expect(view.getByTestId('marker')).toBe(before);
      expect(trackingOf(view)).toBe(true);
      expect(view.getByText('£400')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does NOT re-rasterise for a change that is not DRAWN', async () => {
    // Make and model live in the accessibility label, never on the pill, so
    // React updates them in place — re-arming for them is pure bitmap work
    // with nothing to show for it.
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0, 25000)]);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const before = view.getByTestId('marker');

      const renamed = pin('a', 0, 25000);
      renamed.post = { ...renamed.post, model: 'Focus' };
      await act(async () => {
        view.rerender(
          <MapPins pins={[renamed]} selectedPostId={null} onPressPost={jest.fn()} />,
        );
      });

      expect(view.getByTestId('marker')).toBe(before);
      expect(trackingOf(view)).toBe(false);
      expect(view.getByLabelText('£250 reward — Ford Focus')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does NOT re-rasterise a marker when only its RANK changes', async () => {
    // The load-bearing half. Rank churns on every pan as the in-view
    // population changes, so re-arming here would hold dozens of tracking
    // windows open per gesture — worse than the jank this file guards.
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const before = view.getByTestId('marker');

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
      expect(trackingOf(view)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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

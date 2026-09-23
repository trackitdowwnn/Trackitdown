/**
 * WHAT:  Tests for MapPins — one priced pill per post, the marker box
 *        containing its own shadow and keeping one footprint across selection,
 *        paint order, and WHAT MAY ENTER THE REACT KEY: rank must not,
 *        selection must.
 * WHY:   Those last two pull in opposite directions and both have bitten.
 *        RANK churns on every pan, so folding it into the key remounts dozens
 *        of markers at once, each re-arming a tracksViewChanges window — the
 *        Android jank this component exists to avoid. SELECTION is the
 *        opposite case: repainting it in place is cheap and unreliable, and a
 *        marker that keeps its old bitmap has it clipped to the new bounds
 *        (owner's screenshot, 2026-09-22: pills tapped through still dark and
 *        cut off). One or two markers per tap is a price worth paying; dozens
 *        per pan is not. Neither can be caught by eye in a simulator.
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

/** The wrapper's onLayout — the signal that ends the tracking window. */
const layoutOf = (view: Awaited<ReturnType<typeof renderPins>>) =>
  (view.getByTestId('marker').children[0] as {
    props: { onLayout?: (event: unknown) => void };
  }).props.onLayout;

describe('⚠️ the tracking window (the other jank guard)', () => {
  // `tracksViewChanges` means "re-rasterise this custom view EVERY FRAME", so
  // the settle window is bitmap work, not an idle wait. It was a flat 500ms
  // per marker on mount — affordable — and then twice per TAP once selection
  // started remounting, which is what the owner felt as "very clunky". Layout
  // is the thing it was ever waiting for, so the window now ends two frames
  // past it and 500ms is only the ceiling for a marker that never reports one.
  it('keeps tracking until the marker has laid out', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      expect(view.getByTestId('marker').props.tracksViewChanges).toBe(true);

      // Most of the old window gone, still tracking: nothing has measured.
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      expect(view.getByTestId('marker').props.tracksViewChanges).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('freezes two FRAMES after the layout, not half a second later', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);

      await act(async () => {
        layoutOf(view)?.({ nativeEvent: { layout: { width: 80, height: 60 } } });
      });
      // Frames, not wall clock: 32ms is two frames only on a device actually
      // hitting 60fps, and the moment this matters — a batch mounting while
      // tiles load — is when a frame runs long.
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      await act(async () => {
        jest.advanceTimersByTime(1);
      });

      expect(view.getByTestId('marker').props.tracksViewChanges).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('⚠️ a second layout does not re-arm the window', async () => {
    // onLayout fires on every size change, and re-arming would undo the whole
    // point — a marker that resizes would go back to per-frame rasterising.
    // The guard is structural: the prop itself becomes undefined.
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);

      await act(async () => {
        layoutOf(view)?.({ nativeEvent: { layout: { width: 80, height: 60 } } });
      });

      expect(layoutOf(view)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still freezes on the ceiling when no layout is ever reported', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(view.getByTestId('marker').props.tracksViewChanges).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('marker identity (the jank guard)', () => {
  // ⚠️ REVERSED 2026-09-22, deliberately. This used to assert that selection
  // does NOT remount — the cheap in-place repaint. On Android that repaint is
  // not reliable: a marker whose appearance and size both change can keep its
  // old bitmap and have it clipped to the new bounds, which is what the owner
  // photographed (three tapped-through pills still dark, each cut off).
  // A remount is the only way to guarantee a fresh icon.
  //
  // The perf concern the old assertion protected was never about selection: it
  // was about RANK, which churns on every pan and would remount dozens of
  // markers at once. That half is the test below, and it is the load-bearing
  // one.
  it('remounts a marker when its selection changes — a fresh bitmap, not a repaint', async () => {
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

    expect(view.getByTestId('marker')).not.toBe(before);
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

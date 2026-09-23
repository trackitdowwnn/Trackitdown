/**
 * WHAT:  Tests for MapPins — one static priced pill per post, drawn once and
 *        never redrawn; the selection as ITS OWN marker on top; every marker
 *        born invisible; the marker box containing its shadow and keeping one
 *        footprint; paint order; and what may enter a React key (the price
 *        must, rank must not).
 * WHY:   Every way of changing a mounted marker's bitmap was shipped between
 *        2026-09-22 and 2026-09-23 and every one failed on the owner's phone:
 *        re-arming tracksViewChanges landed the highlight late, redraw() left
 *        two pills highlighted or drew only an outline, letting the pill's
 *        layout size the bitmap clipped it, and remounting flashed Google's
 *        red pin. The design that survived is "never change a bitmap": a
 *        static pill per car, a separate selection marker over the selected
 *        one, and opacity 0 until the view is captured. None of that can be
 *        seen in a simulator; each invariant here is one of those failures.
 * LINKS: src/features/search-map/components/MapPins.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { shadows, sizes } from '@/shared/theme';

import type { MapPinItem, MapPost } from '../types';
import { MapPins } from './MapPins';

const mockMarkerRender = jest.fn();
const mockLightHaptic = jest.fn();

// The real marker needs react-native-maps; render a plain View that keeps the
// props we assert on.
jest.mock('@/shared/ui/AppMap', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable } = require('react-native');
  return {
    AppMapMarker: function AppMapMarker({
      children,
      onPress,
      accessibilityLabel,
      accessibilityState,
      accessible,
      zIndex,
      opacity,
      tracksViewChanges,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
      accessibilityState?: { selected?: boolean };
      accessible?: boolean;
      zIndex?: number;
      opacity?: number;
      tracksViewChanges?: boolean;
    }) {
      // Which markers React re-rendered — the memo's whole point.
      mockMarkerRender(accessibilityLabel, accessibilityState?.selected === true);
      return React.createElement(
        Pressable,
        {
          onPress,
          accessibilityLabel,
          accessibilityState,
          accessible,
          testID: 'marker',
          // Paint order, the birth opacity and the tracking window are all
          // invisible in a simulator as well as in jest, so they come back
          // out as assertable props.
          'data-zindex': zIndex,
          opacity,
          tracksViewChanges,
        },
        children,
      );
    },
  };
});

// ⚠️ The arrow is load-bearing. `jest.mock` is hoisted ABOVE the `const` above
// it, so `lightHaptic: mockLightHaptic` — the obvious simplification — throws a
// TDZ ReferenceError at module init. Calling it lazily defers the read.
jest.mock('@/shared/lib/haptics', () => ({
  lightHaptic: () => mockLightHaptic(),
}));

beforeEach(() => {
  mockLightHaptic.mockClear();
  mockMarkerRender.mockClear();
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

type View = Awaited<ReturnType<typeof renderPins>>;
type MarkerNode = {
  props: {
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    accessible?: boolean;
    'data-zindex': number;
    opacity: number;
    tracksViewChanges: boolean;
  };
};

const markers = (view: View) => view.getAllByTestId('marker') as unknown as MarkerNode[];
const isSelection = (node: MarkerNode) => node.props.accessibilityState?.selected === true;
/** The static pills — never the selection marker. */
const statics = (view: View) => markers(view).filter((node) => !isSelection(node));
/** The selection marker, or undefined when nothing is selected. */
const selection = (view: View) => markers(view).find(isSelection);

/** Let the mount settle: the birth frame and the tracking window. */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
};

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
    const onTop = selection(view);
    if (onTop === undefined) throw new Error('no selection marker');

    await act(async () => {
      fireEvent.press(onTop as unknown as Parameters<typeof fireEvent.press>[0]);
    });

    expect(mockLightHaptic).toHaveBeenCalledTimes(1);
  });
});

describe('⚠️ the marker box contains its own shadow', () => {
  // A marker's children are rasterised to the wrapper's BOUNDS, so a shadow
  // drawn outside them is cut off. The box must clear the shadow's reach on
  // every side, and SYMMETRICALLY: the anchor is the box's centre, so buying
  // the room at the bottom alone would slide every pill north of the
  // coordinate it is reporting.
  const wrapperOf = (node: MarkerNode) =>
    StyleSheet.flatten(
      ((node as unknown as { children: { props: { style?: unknown } }[] }).children[0]).props.style,
    ) as { padding?: number; minHeight?: number };

  const shadowReach = shadows.soft.shadowOffset.height + shadows.soft.shadowRadius;

  // ⚠️ THE CLIPPING FIX, 2026-09-23. On the new architecture the Android
  // marker sizes its bitmap from its FIRST NATIVE CHILD's layout, and React
  // Native flattens a View that carries only layout styles — which this
  // wrapper does. Flattened, the first native child is the pill, so a pill
  // that changed size resized the bitmap to itself and was drawn, offset,
  // into that: cut off right and bottom, exactly as photographed.
  it('⚠️ is a REAL native view — the box the Android bitmap is sized from', async () => {
    const view = await renderPins([pin('a', 5, 25000)]);

    const wrapper = (markers(view)[0] as unknown as {
      children: { props: { collapsable?: boolean } }[];
    }).children[0];
    expect(wrapper.props.collapsable).toBe(false);
  });

  it('pads by the shadow\'s reach, on all four sides', async () => {
    const view = await renderPins([pin('a', 5, 25000)]);

    const wrapper = wrapperOf(markers(view)[0]);
    expect(wrapper.padding).toBe(shadowReach);
    // Still at least a 44pt target — the padding only ever grows the box.
    expect(wrapper.minHeight).toBe(sizes.touchTarget);
  });

  it('pads the SELECTION marker the same way — it is the one that grows', async () => {
    const view = await renderPins([pin('a', 5, 25000)], 'a');
    const onTop = selection(view);
    if (onTop === undefined) throw new Error('no selection marker');

    expect(wrapperOf(onTop).padding).toBe(shadowReach);
  });

  // ⚠️ The two markers must be CONCENTRIC. The selection marker's pill has
  // more padding; the static pill carries exactly that difference as
  // transparent margin, so both boxes are the same size and — the anchor
  // being a fraction of the box — both centres sit on the coordinate. Drop
  // the margin and the dark pill draws off-centre over a light edge.
  describe('keeps one footprint across the two pills', () => {
    const pillOf = (node: MarkerNode) => {
      const wrapper = (node as unknown as {
        children: { children: { props: { style?: unknown } }[] }[];
      }).children[0];
      return StyleSheet.flatten(wrapper.children[0].props.style) as {
        paddingHorizontal?: number;
        paddingVertical?: number;
        margin?: number;
      };
    };

    it('the static pill reserves the selection pill\'s growth as margin', async () => {
      const view = await renderPins([pin('a', 5, 25000)], 'a');
      const [staticPill, selectedPill] = [pillOf(statics(view)[0]), pillOf(selection(view)!)];

      const staticWidth = (staticPill.paddingHorizontal ?? 0) + (staticPill.margin ?? 0);
      const selectedWidth = (selectedPill.paddingHorizontal ?? 0) + (selectedPill.margin ?? 0);
      const staticHeight = (staticPill.paddingVertical ?? 0) + (staticPill.margin ?? 0);
      const selectedHeight = (selectedPill.paddingVertical ?? 0) + (selectedPill.margin ?? 0);

      expect(selectedWidth).toBe(staticWidth);
      expect(selectedHeight).toBe(staticHeight);
      // And the selection pill really is the larger DRAWN one.
      expect(selectedPill.paddingHorizontal).toBeGreaterThan(staticPill.paddingHorizontal ?? 0);
    });
  });
});

describe('⚠️ born invisible, then tracked, then frozen', () => {
  // A marker joins the map BEFORE its custom view is inserted, and until that
  // view is captured react-native-maps hands it Google's default RED PIN — the
  // flicker the owner saw on every remount. Alpha 0 goes into the marker's
  // creation options, so the pin is never drawn; the next frame reveals a
  // finished pill.
  it('mounts at opacity 0 and is revealed a frame later', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      expect(markers(view)[0].props.opacity).toBe(0);

      await act(async () => {
        jest.advanceTimersByTime(32);
      });

      expect(markers(view)[0].props.opacity).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // `tracksViewChanges` means 're-rasterise this custom view EVERY FRAME', so
  // the window is real bitmap work. It is armed on MOUNT ONLY, and it must
  // NOT be cut short: freezing before the native tracker has captured the
  // view leaves the default pin on screen for good.
  it('tracks from mount and freezes once settled', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      expect(markers(view)[0].props.tracksViewChanges).toBe(true);

      await settle();

      expect(markers(view)[0].props.tracksViewChanges).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('⚠️ the selection marker is born the same way — no red pin on a tap', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([pin('a', 0)]);
      await settle();

      await act(async () => {
        view.rerender(<MapPins pins={[pin('a', 0)]} selectedPostId="a" onPressPost={jest.fn()} />);
      });
      const onTop = selection(view);
      if (onTop === undefined) throw new Error('no selection marker');
      expect(onTop.props.opacity).toBe(0);
      expect(onTop.props.tracksViewChanges).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(32);
      });
      expect(selection(view)?.props.opacity).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('⚠️ selection is its own marker (the whole design)', () => {
  // Nothing drawn ever changes on a mounted marker. The selected car gets a
  // SECOND marker on top; moving the selection swaps that marker; clearing it
  // uncovers the static pill. See the header for the four ways editing a
  // mounted bitmap failed on device.
  it('adds ONE marker on top when a car is selected — the statics are untouched', async () => {
    jest.useFakeTimers();
    try {
      const three = [pin('a', 0), pin('b', 1), pin('c', 2)];
      const view = await renderPins(three);
      await settle();
      const before = statics(view);
      expect(before).toHaveLength(3);
      expect(selection(view)).toBeUndefined();

      await act(async () => {
        view.rerender(<MapPins pins={three} selectedPostId="b" onPressPost={jest.fn()} />);
      });

      expect(markers(view)).toHaveLength(4);
      const onTop = selection(view);
      if (onTop === undefined) throw new Error('no selection marker');
      expect(onTop.props.accessibilityLabel).toBe('£250 reward — Ford Fiesta');
      // The three static markers are the SAME nodes: no remount, no redraw.
      expect(statics(view)).toEqual(before);
      // Still frozen — the statics were not re-armed for this.
      expect(statics(view).every((node) => node.props.tracksViewChanges === false)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('⚠️ moving the selection swaps the marker on top — never two highlighted', async () => {
    // The owner, on device: "both markers are still highlighted". Impossible
    // by construction now — there is exactly one selection marker, and it is
    // keyed on the car, so a move is an unmount and a mount.
    jest.useFakeTimers();
    try {
      const three = [pin('a', 0), pin('b', 1), pin('c', 2)];
      const view = await renderPins(three, 'a');
      await settle();
      const staticsBefore = statics(view);
      const firstOnTop = selection(view);

      await act(async () => {
        view.rerender(<MapPins pins={three} selectedPostId="b" onPressPost={jest.fn()} />);
      });

      const highlighted = markers(view).filter(isSelection);
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]).not.toBe(firstOnTop);
      expect(statics(view)).toEqual(staticsBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clearing the selection uncovers the static pill — same node, nothing redrawn', async () => {
    jest.useFakeTimers();
    try {
      const one = [pin('a', 0)];
      const view = await renderPins(one, 'a');
      await settle();
      const staticBefore = statics(view)[0];

      await act(async () => {
        view.rerender(<MapPins pins={one} selectedPostId={null} onPressPost={jest.fn()} />);
      });

      expect(markers(view)).toHaveLength(1);
      expect(selection(view)).toBeUndefined();
      expect(statics(view)[0]).toBe(staticBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the covered static pill leaves the assistive-tech tree — one stop per car', async () => {
    const view = await renderPins([pin('a', 0)], 'a');

    expect(statics(view)[0].props.accessible).toBe(false);
    expect(selection(view)?.props.accessible).toBe(true);
    expect(selection(view)?.props.accessibilityState).toEqual({ selected: true });
  });

  it('⚠️ a tap re-renders the markers it touched, not the whole map', async () => {
    // Up to a hundred markers are mounted. PinMarker is memoised with stable
    // props precisely so a tap costs a couple of React renders rather than a
    // hundred — an inline onPress arrow at the call site would silently undo
    // that. Here: a is uncovered, b is covered, the selection marker mounts;
    // c has nothing to do.
    jest.useFakeTimers();
    try {
      const three = [pin('a', 0, 25000), pin('b', 1, 4500), pin('c', 2, 1000)];
      const onPressPost = jest.fn();
      const view = await act(async () =>
        render(<MapPins pins={three} selectedPostId="a" onPressPost={onPressPost} />),
      );
      // Let every marker's own birth (the reveal frame, the tracking window)
      // play out first — those are the markers re-rendering THEMSELVES, and
      // they must not be mistaken for the tap's cost.
      await settle();
      mockMarkerRender.mockClear();

      await act(async () => {
        view.rerender(<MapPins pins={three} selectedPostId="b" onPressPost={onPressPost} />);
      });

      const rendered = mockMarkerRender.mock.calls.map(([label]) => label as string);
      expect(rendered).not.toContain('£10 reward — Ford Fiesta');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('what may enter the key', () => {
  it('⚠️ a PRICE change is a new marker — a frozen pill keeps its old figure', async () => {
    // The pill is rasterised once and frozen, so a reward the owner raised
    // once landed in the React tree while the map kept showing the old
    // figure. A price that is wrong is worse than one that is late.
    const view = await renderPins([pin('a', 0, 25000)]);
    const before = markers(view)[0];
    expect(view.getByText('£250')).toBeTruthy();

    await act(async () => {
      view.rerender(
        <MapPins pins={[pin('a', 0, 40000)]} selectedPostId={null} onPressPost={jest.fn()} />,
      );
    });

    expect(markers(view)[0]).not.toBe(before);
    expect(view.getByText('£400')).toBeTruthy();
  });

  it('does NOT remount for a change that is not DRAWN', async () => {
    // Make and model live in the accessibility label, never on the pill, so
    // React updates them in place — keying on them would remount for nothing.
    const view = await renderPins([pin('a', 0, 25000)]);
    const before = markers(view)[0];

    const renamed = pin('a', 0, 25000);
    renamed.post = { ...renamed.post, model: 'Focus' };
    await act(async () => {
      view.rerender(
        <MapPins pins={[renamed]} selectedPostId={null} onPressPost={jest.fn()} />,
      );
    });

    expect(markers(view)[0]).toBe(before);
    expect(view.getByLabelText('£250 reward — Ford Focus')).toBeTruthy();
  });

  it('does NOT remount a marker when only its RANK changes', async () => {
    // The load-bearing half. Rank churns on every pan as the in-view
    // population changes, so remounting here would rebuild dozens of markers
    // per gesture — each flashing invisible and re-tracking. Worse than the
    // jank this file guards.
    const view = await renderPins([pin('a', 0)]);
    const before = markers(view)[0];

    await act(async () => {
      view.rerender(
        <MapPins pins={[pin('a', 17)]} selectedPostId={null} onPressPost={jest.fn()} />,
      );
    });

    expect(markers(view)[0]).toBe(before);
  });
});

describe('every post gets its own marker', () => {
  // Clustering was removed 2026-08-06 and the price-less tier 2026-08-07 —
  // nothing collapses or hides anything now.
  it('renders one marker per pin', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 1), pin('c', 2)]);

    expect(markers(view)).toHaveLength(3);
  });
});

describe('paint order and the assistive-tech path', () => {
  const zIndexOf = (node: MarkerNode) => node.props['data-zindex'];

  // Under heavy overlap — the normal case now that every marker is a full-width
  // pill — paint order is what decides which marker a tap HITS, and between
  // overlapping Android markers with equal zIndex that order is undefined.
  it('paints the highest bounty above the rest', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 1), pin('c', 2)]);

    const [first, second, third] = markers(view).map(zIndexOf);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
  });

  it('puts the SELECTION marker above everything', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 40)], 'b');

    const top = Math.max(...statics(view).map(zIndexOf));
    expect(zIndexOf(selection(view)!)).toBeGreaterThan(top);
  });

  // Never 0: the iOS Google marker skips a falsy zIndex when it re-creates.
  it('never assigns a falsy z-index, however deep the rank', async () => {
    const view = await renderPins([pin('a', 5000)]);

    expect(zIndexOf(markers(view)[0])).toBeGreaterThan(0);
  });

  // ⚠️ The DRAWN set and the REACHABLE set deliberately differ. Every marker is
  // drawn and tappable, but leaving all of them individually focusable makes a
  // screen-reader user swipe through up to a hundred to get past the map — and
  // the sheet lists every car with more detail and a live count.
  it('keeps low-ranked markers out of the assistive-tech tree', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 90)]);

    const [top, deep] = markers(view);
    expect(top.props.accessible).toBe(true);
    expect(deep.props.accessible).toBe(false);
  });

  it('the selected car is always reachable, however deep its rank', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 90)], 'b');

    expect(selection(view)?.props.accessible).toBe(true);
  });
});

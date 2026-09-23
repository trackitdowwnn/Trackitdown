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
import { Platform, StyleSheet } from 'react-native';

import { motion, shadows, sizes } from '@/shared/theme';

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
  function AppMapMarker({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    accessible,
    zIndex,
    animatedProps,
    image,
    tracksViewChanges,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    accessible?: boolean;
    zIndex?: number;
    animatedProps?: { opacity: number };
    image?: { uri: string };
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
        // out as assertable props. `animatedProps` is what the Reanimated
        // mock hands through: the worklet's return value at render time.
        'data-zindex': zIndex,
        animatedProps,
        image,
        tracksViewChanges,
      },
      children,
    );
  }
  return { AppMapMarker, AppMapMarkerAnimated: AppMapMarker };
});

// The project's Reanimated mock resolves `withTiming` to its target at once
// and shared values are plain objects, so a fade cannot be watched settle in
// jest. The spy is how a fade's INTENT — target, duration — is asserted.
// ⚠️ `require`, not `jest.requireMock`: the latter hands back a separate
// automock instance, not the mapped module the component imports, so spies
// on it never reach the component (jest/reanimatedMock.js says the same).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mapped mock module, for spying
const reanimated = require('react-native-reanimated') as typeof import('react-native-reanimated');

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
    animatedProps: { opacity: number };
    image?: { uri: string };
    tracksViewChanges: boolean;
  };
};

const markers = (view: View) => view.getAllByTestId('marker') as unknown as MarkerNode[];
const isSelection = (node: MarkerNode) => node.props.accessibilityState?.selected === true;
/** The static pills — never a selection marker, live or leaving. */
const statics = (view: View) => markers(view).filter((node) => !isSelection(node));
/** The LIVE selection marker (a stop for assistive tech), or undefined. */
const selection = (view: View) =>
  markers(view).find((node) => isSelection(node) && node.props.accessible === true);
/** The selection marker on its way out (scenery: not a stop), or undefined. */
const leaving = (view: View) =>
  markers(view).find((node) => isSelection(node) && node.props.accessible === false);

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

  // ⚠️ jest runs as iOS, so the Android arm of the Platform.select is
  // otherwise untested — which is how a padding that the 44pt floor swallowed
  // whole shipped as "the tap box is taller" (2026-09-24, ui-reviewer). On
  // Android the box is one `sizes.control` tall and no wider than the pill
  // plus its margin: the shadow padding draws nothing there and was the
  // invisible box that swallowed taps meant for neighbouring pills.
  it('on Android the box is one control tall, with no side padding', async () => {
    const select = jest
      .spyOn(Platform, 'select')
      .mockImplementation((spec) => {
        const arms = spec as { android?: unknown; default?: unknown };
        return arms.android ?? arms.default;
      });
    try {
      const view = await renderPins([pin('a', 5, 25000)]);

      const wrapper = StyleSheet.flatten(
        (markers(view)[0] as unknown as { children: { props: { style?: unknown } }[] })
          .children[0].props.style,
      ) as { minHeight?: number; padding?: number; paddingHorizontal?: number };
      expect(wrapper.minHeight).toBe(sizes.control);
      expect(wrapper.padding).toBeUndefined();
      expect(wrapper.paddingHorizontal).toBeUndefined();
    } finally {
      select.mockRestore();
    }
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
        borderWidth?: number;
      };
    };

    it('the static pill reserves the selection pill\'s growth as margin', async () => {
      const view = await renderPins([pin('a', 5, 25000)], 'a');
      const [staticPill, selectedPill] = [pillOf(statics(view)[0]), pillOf(selection(view)!)];

      // Border included: a borderless selected pill (the reference's look,
      // which the styles discuss) would shrink its box by 2pt and break
      // concentricity while a padding-only sum still passed.
      const side = (pill: typeof staticPill, axis: 'paddingHorizontal' | 'paddingVertical') =>
        (pill[axis] ?? 0) + (pill.margin ?? 0) + (pill.borderWidth ?? 0);
      const staticWidth = side(staticPill, 'paddingHorizontal');
      const selectedWidth = side(selectedPill, 'paddingHorizontal');
      const staticHeight = side(staticPill, 'paddingVertical');
      const selectedHeight = side(selectedPill, 'paddingVertical');

      expect(selectedWidth).toBe(staticWidth);
      expect(selectedHeight).toBe(staticHeight);
      // And the selection pill really is the larger DRAWN one.
      expect(selectedPill.paddingHorizontal).toBeGreaterThan(staticPill.paddingHorizontal ?? 0);
    });
  });
});

describe('⚠️ born invisible, faded in, then frozen', () => {
  // A marker joins the map BEFORE its custom view is inserted, and until that
  // view is captured react-native-maps hands it Google's default RED PIN — the
  // flicker the owner saw on every remount. Alpha 0 goes into the marker's
  // creation options, so the pin is never drawn; the fade then brings a
  // finished pill up over motion.fast — the marker's native alpha, the one
  // thing the map animates without re-rasterising the pill.
  it('mounts at opacity 0', async () => {
    const view = await renderPins([pin('a', 0)]);

    expect(markers(view)[0].props.animatedProps.opacity).toBe(0);
  });

  it('fades in over motion.fast — it never switches on', async () => {
    const withTiming = jest.spyOn(reanimated, 'withTiming');
    try {
      await renderPins([pin('a', 0)]);

      expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: motion.fast }));
    } finally {
      withTiming.mockRestore();
    }
  });

  it('under reduced motion it goes straight to visible, with no fade', async () => {
    const reduced = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const withTiming = jest.spyOn(reanimated, 'withTiming');
    try {
      await renderPins([pin('a', 0)]);

      expect(withTiming).not.toHaveBeenCalled();
    } finally {
      withTiming.mockRestore();
      reduced.mockRestore();
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

  // ⚠️ Not decoration. With an image set, the Android marker composites every
  // capture of its view into a FRESH bitmap; without one it erases and reuses
  // a single Bitmap object and hands that same object to setIcon each time —
  // which is how the selection pill kept showing an early, empty capture
  // ("only an outline", 2026-09-23). The image also stands in for the red
  // pin on a marker whose view is not captured yet.
  it('⚠️ every marker carries the transparent image — statics and the selection', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 1)], 'b');

    const all = markers(view);
    expect(all).toHaveLength(3);
    for (const node of all) {
      expect(node.props.image?.uri).toMatch(/^data:image\/png;base64,/);
    }
    // ONE object for every marker — a fresh one per render would be a new
    // prop on a memoised component, and a new decode on the native side.
    expect(new Set(all.map((node) => node.props.image)).size).toBe(1);
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
      expect(onTop.props.animatedProps.opacity).toBe(0);
      expect(onTop.props.tracksViewChanges).toBe(true);
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

  it('⚠️ moving the selection swaps the marker on top — never two LIVE', async () => {
    // The owner, on device: "both markers are still highlighted". Impossible
    // by construction now — there is exactly one live selection marker, keyed
    // on the car, so a move is a mount of a new one; the old one only lingers
    // to fade (below), and never as a stop or a tap.
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

      const live = markers(view).filter((node) => isSelection(node) && node.props.accessible);
      expect(live).toHaveLength(1);
      expect(live[0]).not.toBe(firstOnTop);
      expect(statics(view)).toEqual(staticsBefore);

      // Once the fade has had its beat, one selection marker, full stop.
      await act(async () => {
        jest.advanceTimersByTime(motion.fast);
      });
      expect(markers(view).filter(isSelection)).toHaveLength(1);
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
      await act(async () => {
        jest.advanceTimersByTime(motion.fast);
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

describe('⚠️ the outgoing selection fades, then unmounts', () => {
  // "The dark pill vanishes abruptly" (the owner, 2026-09-23). It now stays
  // mounted for one motion.fast, fading to nothing over the static pill it
  // covered — the SAME native marker, keeping its key, so it is a fade and
  // not a fresh marker born invisible.
  it('keeps the previous selection marker mounted and fading for one motion.fast', async () => {
    jest.useFakeTimers();
    const withTiming = jest.spyOn(reanimated, 'withTiming');
    try {
      const three = [pin('a', 0), pin('b', 1), pin('c', 2)];
      const view = await renderPins(three, 'a');
      await settle();
      const wasLive = selection(view);
      withTiming.mockClear();

      await act(async () => {
        view.rerender(<MapPins pins={three} selectedPostId="b" onPressPost={jest.fn()} />);
      });

      const fading = leaving(view);
      if (fading === undefined) throw new Error('the outgoing marker was not kept');
      // The same node the live selection was — a fade, not a remount.
      expect(fading).toBe(wasLive);
      expect(fading.props.accessibilityLabel).toBe('£250 reward — Ford Fiesta');
      expect(withTiming).toHaveBeenCalledWith(0, expect.objectContaining({ duration: motion.fast }));

      await act(async () => {
        jest.advanceTimersByTime(motion.fast);
      });
      expect(leaving(view)).toBeUndefined();
      expect(markers(view)).toHaveLength(4);
    } finally {
      withTiming.mockRestore();
      jest.useRealTimers();
    }
  });

  it('the fading marker is scenery — below the live one, and its tap selects nothing', async () => {
    jest.useFakeTimers();
    try {
      const three = [pin('a', 0), pin('b', 1), pin('c', 2)];
      const onPressPost = jest.fn();
      const view = await act(async () =>
        render(<MapPins pins={three} selectedPostId="a" onPressPost={onPressPost} />),
      );
      await settle();

      await act(async () => {
        view.rerender(<MapPins pins={three} selectedPostId="b" onPressPost={onPressPost} />);
      });
      const fading = leaving(view);
      const live = selection(view);
      if (fading === undefined || live === undefined) throw new Error('markers missing');

      expect(fading.props['data-zindex']).toBeLessThan(live.props['data-zindex']);
      expect(fading.props['data-zindex']).toBeGreaterThan(
        Math.max(...statics(view).map((node) => node.props['data-zindex'])),
      );

      await act(async () => {
        fireEvent.press(fading as unknown as Parameters<typeof fireEvent.press>[0]);
      });
      // A tap on a pill that is on its way out must not bring its car back.
      expect(onPressPost).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clearing the selection fades the marker out the same way', async () => {
    jest.useFakeTimers();
    try {
      const one = [pin('a', 0)];
      const view = await renderPins(one, 'a');
      await settle();

      await act(async () => {
        view.rerender(<MapPins pins={one} selectedPostId={null} onPressPost={jest.fn()} />);
      });

      expect(selection(view)).toBeUndefined();
      expect(leaving(view)).toBeDefined();
      expect(markers(view)).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-selecting the car that is still fading keeps ONE marker for it', async () => {
    // Same car, same key: the fading marker simply fades back up. Rendering
    // it twice would collide on the key.
    jest.useFakeTimers();
    try {
      // Different prices, so the two cars' labels are distinguishable.
      const two = [pin('a', 0, 25000), pin('b', 1, 4500)];
      const view = await renderPins(two, 'a');
      await settle();

      await act(async () => {
        view.rerender(<MapPins pins={two} selectedPostId="b" onPressPost={jest.fn()} />);
      });
      await act(async () => {
        view.rerender(<MapPins pins={two} selectedPostId="a" onPressPost={jest.fn()} />);
      });

      const forA = markers(view).filter(
        (node) => isSelection(node) && node.props.accessibilityLabel === '£250 reward — Ford Fiesta',
      );
      expect(forA).toHaveLength(1);
      expect(forA[0].props.accessible).toBe(true);
      // b, just deselected, is the one fading.
      expect(leaving(view)?.props.accessibilityLabel).toBe('£45 reward — Ford Fiesta');
    } finally {
      jest.useRealTimers();
    }
  });

  it('under reduced motion the outgoing marker simply unmounts', async () => {
    const reduced = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    try {
      const two = [pin('a', 0), pin('b', 1)];
      const view = await renderPins(two, 'a');

      await act(async () => {
        view.rerender(<MapPins pins={two} selectedPostId="b" onPressPost={jest.fn()} />);
      });

      expect(leaving(view)).toBeUndefined();
      expect(markers(view).filter(isSelection)).toHaveLength(1);
    } finally {
      reduced.mockRestore();
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

  it('puts the SELECTION marker above everything — the top static pill included', async () => {
    const view = await renderPins([pin('a', 0), pin('b', 40)], 'b');

    const top = Math.max(...statics(view).map(zIndexOf));
    // Strictly above, with a tier to spare for the leaving marker, so the
    // top-ranked static pill can never tie with either.
    expect(zIndexOf(selection(view)!)).toBeGreaterThan(top + 1);
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

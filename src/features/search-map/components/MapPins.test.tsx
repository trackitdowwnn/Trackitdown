/**
 * WHAT:  Tests for MapPins — one white £ pill per car, one dark selection pill
 *        on top, the Android bitmap rules, paint order, and what goes in a key.
 * WHY:   None of this is visible in a simulator, and each rule here stands for
 *        a failure seen on the owner's phone: a pill that repainted late or
 *        stale, a clipped pill, Google's red default pin, a price-less marker
 *        read as a group of cars.
 * LINKS: src/features/search-map/components/MapPins.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { MapPost } from '../types';
import { MapPins } from './MapPins';

// The real marker needs react-native-maps; a Pressable that keeps the props
// under test is enough.
jest.mock('@/shared/ui/AppMap', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable } = require('react-native');
  function AppMapMarker({
    children,
    zIndex,
    ...rest
  }: {
    children: React.ReactNode;
    zIndex?: number;
  }) {
    return React.createElement(Pressable, { ...rest, testID: 'marker', 'data-zindex': zIndex }, children);
  }
  return { AppMapMarker };
});

const post = (id: string, bountyPence: number | null = 25000, model = 'Fiesta'): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model,
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence,
  latitude: 51.75,
  longitude: -0.34,
});

type MarkerNode = {
  props: {
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    accessible?: boolean;
    'data-zindex': number;
    image?: { uri: string };
    tracksViewChanges: boolean;
  };
  children: { props: { collapsable?: boolean; style?: unknown } }[];
};

const renderPins = async (
  posts: MapPost[],
  selectedPostId: string | null = null,
  onPressPost = jest.fn(),
) => act(async () => render(<MapPins posts={posts} selectedPostId={selectedPostId} onPressPost={onPressPost} />));

type View = Awaited<ReturnType<typeof renderPins>>;
const markers = (view: View) => view.getAllByTestId('marker') as unknown as MarkerNode[];
const isSelection = (node: MarkerNode) => node.props.accessibilityState?.selected === true;
const statics = (view: View) => markers(view).filter((node) => !isSelection(node));
const selection = (view: View) => markers(view).filter(isSelection);

const rerender = async (view: View, posts: MapPost[], selectedPostId: string | null) =>
  act(async () => {
    view.rerender(<MapPins posts={posts} selectedPostId={selectedPostId} onPressPost={jest.fn()} />);
  });

describe('one pill per car', () => {
  it('draws one marker per post', async () => {
    const view = await renderPins([post('a'), post('b'), post('c')]);

    expect(markers(view)).toHaveLength(3);
  });

  // Never a price-less pill: an empty marker reads as a group of cars.
  it('prints the amount, or "No reward"', async () => {
    const view = await renderPins([post('a', 25000), post('b', null)]);

    expect(view.getByText('£250')).toBeTruthy();
    expect(view.getByText('No reward')).toBeTruthy();
  });

  it('speaks the full label', async () => {
    const view = await renderPins([post('a', 25000)]);

    expect(view.getByLabelText('£250 reward — Ford Fiesta')).toBeTruthy();
  });

  it('calls onPressPost with the car\'s id', async () => {
    const onPressPost = jest.fn();
    const view = await renderPins([post('a')], null, onPressPost);

    await act(async () => {
      fireEvent.press(view.getByTestId('marker'));
    });

    expect(onPressPost).toHaveBeenCalledWith('a');
  });
});

describe('selection swaps the car\'s pill for a dark one', () => {
  // ⚠️ A swap, not an overlay. With a white pill left under the dark one, a
  // wrong paint order put the white pill ON TOP — the "outline" and the
  // "several taps" on device, 2026-09-23. Nothing can cover a pill that is
  // the only marker for its car.
  it('the selected car has ONLY the dark pill — one marker per car', async () => {
    const view = await renderPins([post('a'), post('b')], 'b');

    expect(markers(view)).toHaveLength(2);
    expect(selection(view)).toHaveLength(1);
    expect(statics(view)).toHaveLength(1);
  });

  it('moving the selection leaves the other cars\' pills untouched', async () => {
    const posts = [post('a', 25000), post('b', 4500), post('c', 1000)];
    const view = await renderPins(posts, 'a');
    const untouched = statics(view).find((node) => node.props.accessibilityLabel.startsWith('£10'));

    await rerender(view, posts, 'b');

    expect(selection(view)).toHaveLength(1);
    expect(selection(view)[0].props.accessibilityLabel).toBe('£45 reward — Ford Fiesta');
    // Identity, not deep equality: `props` is live, so toEqual would pass on a
    // remount too.
    expect(statics(view)).toContain(untouched);
  });

  it('a moved selection pill is a NEW marker, so it gets its own capture window', async () => {
    jest.useFakeTimers();
    try {
      const posts = [post('a', 25000), post('b', 4500)];
      const view = await renderPins(posts, 'a');
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(selection(view)[0].props.tracksViewChanges).toBe(false);

      await rerender(view, posts, 'b');

      expect(selection(view)[0].props.tracksViewChanges).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clearing it swaps back to a white pill', async () => {
    const posts = [post('a')];
    const view = await renderPins(posts, 'a');

    await rerender(view, posts, null);

    expect(selection(view)).toHaveLength(0);
    expect(statics(view)).toHaveLength(1);
  });

  it('a selected id that is not in view draws no dark pill', async () => {
    const view = await renderPins([post('a')], 'elsewhere');

    expect(selection(view)).toHaveLength(0);
  });
});

describe('⚠️ paint order is fixed at birth', () => {
  // Android (new arch) reads a marker's zIndex ONCE, at creation. So it must
  // come from something in the key — the price — never from the population.
  const z = (node: MarkerNode) => node.props['data-zindex'];

  it('a bigger bounty paints higher; no-reward lowest; never 0', async () => {
    const view = await renderPins([post('big', 240000), post('small', 15000), post('none', null)]);

    const [big, small, none] = markers(view).map(z);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(0);
  });

  it('the dark pill is above every white pill', async () => {
    const view = await renderPins([post('a', 99_999_900), post('b')], 'b');

    expect(z(selection(view)[0])).toBeGreaterThan(Math.max(...statics(view).map(z)));
  });

  // The regression: a count-based zIndex let a pill born among 30 cars
  // outrank a selection made after zooming in to 3.
  it('a pill\'s zIndex does not depend on how many cars are in view', async () => {
    const crowd = Array.from({ length: 30 }, (_, i) => post(`p${i}`, 1000 + i));
    const inCrowd = await renderPins([post('a', 240000), ...crowd]);
    const alone = await renderPins([post('a', 240000)]);

    expect(z(markers(inCrowd)[0])).toBe(z(markers(alone)[0]));
  });
});

describe('⚠️ the Android bitmap rules', () => {
  it('every marker carries the same transparent image', async () => {
    const view = await renderPins([post('a'), post('b')], 'a');

    const images = markers(view).map((node) => node.props.image);
    expect(images.every((image) => image?.uri.startsWith('data:image/png;base64,'))).toBe(true);
    expect(new Set(images).size).toBe(1);
  });

  it('the wrapper is a real native view (collapsable={false})', async () => {
    const view = await renderPins([post('a')]);

    expect(markers(view)[0].children[0].props.collapsable).toBe(false);
  });

  // ⚠️ A marker's tap area is its whole bitmap, and Google widens it further.
  // A 44×52 box around a 28pt pill made taps land on cars nowhere near the
  // finger ("the hit box is way larger than the marker", 2026-09-23).
  it('the tap box is the pill exactly — no size, padding or shadow margin around it', async () => {
    const view = await renderPins([post('a'), post('b')], 'a');

    for (const node of markers(view)) {
      const wrapper = node.children[0];
      expect(StyleSheet.flatten(wrapper.props.style as never) ?? {}).toEqual({});
      const pill = StyleSheet.flatten(
        (wrapper as unknown as { children: { props: { style?: unknown } }[] }).children[0].props.style as never,
      ) as Record<string, unknown>;
      expect(pill).not.toHaveProperty('margin');
      expect(pill).not.toHaveProperty('minWidth');
      expect(pill).not.toHaveProperty('minHeight');
      expect(pill).not.toHaveProperty('shadowRadius');
      expect(pill).not.toHaveProperty('elevation');
    }
  });

  it('tracks view changes after mount, then freezes', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderPins([post('a')]);
      expect(markers(view)[0].props.tracksViewChanges).toBe(true);

      // Freezing early leaves the red default pin on screen — the window
      // must not quietly shrink.
      await act(async () => {
        jest.advanceTimersByTime(499);
      });
      expect(markers(view)[0].props.tracksViewChanges).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(1);
      });

      expect(markers(view)[0].props.tracksViewChanges).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('every pill is centred on its car, and the dark one is the larger', async () => {
    const view = await renderPins([post('a'), post('b')], 'a');

    for (const node of markers(view)) {
      expect((node.props as { anchor?: unknown }).anchor).toEqual({ x: 0.5, y: 0.5 });
    }
    const pillPadding = (node: MarkerNode) =>
      StyleSheet.flatten(
        (node.children[0] as unknown as { children: { props: { style?: unknown } }[] }).children[0].props.style,
      ) as { paddingHorizontal: number };
    expect(pillPadding(selection(view)[0]).paddingHorizontal).toBeGreaterThan(
      pillPadding(statics(view)[0]).paddingHorizontal,
    );
  });
});

describe('the key is what the pill draws', () => {
  it('a price change is a new marker — a frozen pill cannot repaint', async () => {
    const view = await renderPins([post('a', 25000)]);
    const before = markers(view)[0];

    await rerender(view, [post('a', 40000)], null);

    expect(markers(view)[0]).not.toBe(before);
    expect(view.getByText('£400')).toBeTruthy();
  });

  it('a change that is not drawn keeps the same marker', async () => {
    const view = await renderPins([post('a', 25000)]);
    const before = markers(view)[0];

    await rerender(view, [post('a', 25000, 'Focus')], null);

    expect(markers(view)[0]).toBe(before);
    expect(view.getByLabelText('£250 reward — Ford Focus')).toBeTruthy();
  });

  it('a change of order (paint order) keeps the same markers', async () => {
    const view = await renderPins([post('a'), post('b')]);
    const [a] = markers(view);

    await rerender(view, [post('b'), post('a')], null);

    expect(markers(view)).toContain(a);
  });
});

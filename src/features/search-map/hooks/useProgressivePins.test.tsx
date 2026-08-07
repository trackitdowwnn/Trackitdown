/**
 * WHAT:  Tests useProgressivePins — the batched marker mount: a first slice
 *        immediately, the rest filling in over a few ticks, and the budget
 *        restarting only when the POPULATION turns over.
 * WHY:   The reset key is the whole subtlety, and it has been wrong twice.
 *        `pins` is rebuilt on every pan settle (the cull re-runs), so keying
 *        the reset off the array makes markers the user is looking at vanish
 *        and fade back in on every gesture. Keying it off `searchId` is the
 *        same bug one step removed — that bumps on every LANDED search,
 *        including the auto re-search after each pan, which returns largely
 *        the same cars. Either way ~68 mounted markers unmount and re-arm
 *        500ms of tracking per pan: more jank than not batching at all. Only
 *        `populationId` (entry / apply / retry) is a genuine turnover. None of
 *        this is visible in a screenshot; it has to be asserted.
 * LINKS: src/features/search-map/hooks/useProgressivePins.ts,
 *        src/features/search-map/lib/mapPins.ts (revealPins), docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { MapPinItem } from '../types';
import { useProgressivePins } from './useProgressivePins';

const item = (key: string, rank: number): MapPinItem => ({
  type: 'post',
  key,
  post: {
    id: key,
    photos: [],
    make: 'Ford',
    model: 'Fiesta',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    lastSeenAt: '2026-07-10T18:00:00Z',
    bountyPence: 15000,
    latitude: 51.75,
    longitude: -0.34,
  },
  rank,
});

/** A dense viewport: `count` markers, ranked by bounty (0 = highest). */
const pins = (count: number): MapPinItem[] =>
  Array.from({ length: count }, (_, i) => item(`p${i}`, i));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let one batch tick elapse. */
const tick = async () => {
  await act(async () => {
    jest.advanceTimersByTime(32);
  });
};

describe('useProgressivePins', () => {
  it('mounts a first slice rather than the whole population', async () => {
    const all = pins(100);

    const { result } = await act(async () => renderHook(() => useProgressivePins(all, 0)));

    expect(result.current.length).toBeLessThan(all.length);
    expect(result.current.length).toBeGreaterThan(0);
  });

  // The markers a user is most likely reaching for must be in the FIRST
  // commit, not fade in behind the long tail.
  it('fills that first slice with the highest-ranked markers', async () => {
    const { result } = await act(async () => renderHook(() => useProgressivePins(pins(100), 0)));

    const ranks = result.current.map((pin) => pin.rank);
    expect(Math.max(...ranks)).toBe(ranks.length - 1);
  });

  it('fills the rest in over the following ticks', async () => {
    const all = pins(100);
    const { result } = await act(async () => renderHook(() => useProgressivePins(all, 0)));
    const first = result.current.length;

    await tick();

    expect(result.current.length).toBeGreaterThan(first);
  });

  it('gets everything out eventually, and then stops', async () => {
    const all = pins(100);
    const { result } = await act(async () => renderHook(() => useProgressivePins(all, 0)));

    for (let i = 0; i < 10; i += 1) {
      await tick();
    }

    // Identity, not just length: revealPins returns the input array once
    // nothing is withheld, which is what keeps the memoised renderer still.
    expect(result.current).toBe(all);
  });

  // REGRESSION: `pins` is rebuilt on every pan settle. If the reveal restarted
  // there, markers already on screen would disappear mid-gesture.
  it('does NOT restart when the pins array is rebuilt at the same populationId', async () => {
    const { result, rerender } = await act(async () =>
      renderHook(({ list }: { list: MapPinItem[] }) => useProgressivePins(list, 7), {
        initialProps: { list: pins(100) },
      }),
    );
    for (let i = 0; i < 10; i += 1) {
      await tick();
    }
    expect(result.current).toHaveLength(100);

    // A pan: same posts, brand-new array (the cull re-ran).
    await act(async () => {
      rerender({ list: pins(100) });
    });

    expect(result.current).toHaveLength(100);
  });

  // populationId, not searchId: it bumps only on entry/apply/retry, so this is
  // a genuinely new set of cars rather than the same ones re-fetched after a pan.
  it('DOES restart when the POPULATION turns over', async () => {
    const { result, rerender } = await act(async () =>
      renderHook(({ id }: { id: number }) => useProgressivePins(pins(100), id), {
        initialProps: { id: 7 },
      }),
    );
    for (let i = 0; i < 10; i += 1) {
      await tick();
    }
    expect(result.current).toHaveLength(100);

    await act(async () => {
      rerender({ id: 8 });
    });

    expect(result.current.length).toBeLessThan(100);
  });

  it('does not stall on an empty view', async () => {
    const { result } = await act(async () => renderHook(() => useProgressivePins([], 0)));

    expect(result.current).toEqual([]);
  });
});

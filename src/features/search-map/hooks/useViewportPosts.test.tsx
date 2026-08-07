/**
 * WHAT:  Tests for useViewportPosts — the entry search, the DEBOUNCED
 *        auto-search on pan (fires once at the final region, never for a
 *        nudge, never while paused), sticky criteria across a re-search,
 *        failures keeping results, searchId, and timer cleanup.
 * WHY:   This state machine IS the map's UX contract. Two properties in here
 *        cannot be seen in a simulator and will not fail loudly if they break:
 *        a burst of gestures must collapse into ONE request (or the RPC gets
 *        hammered), and a pan with a card open must not search at all (or the
 *        list changes under someone who is reading it).
 * LINKS: src/features/search-map/hooks/useViewportPosts.ts,
 *        src/features/search-map/lib/searchCriteria.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { GeoRegion } from '@/shared/types';

import { useViewportPosts } from './useViewportPosts';
import { emptyCriteria } from '../lib/searchCriteria';

const mockFetch = jest.fn();

jest.mock('../api/mapApi', () => ({
  fetchSearchPosts: (...args: unknown[]) => mockFetch(...args),
}));

const REGION: GeoRegion = {
  latitude: 51.77,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};
/** Panned well beyond the 30% threshold. */
const FAR_REGION: GeoRegion = { ...REGION, latitude: 52.5 };
const FARTHER_REGION: GeoRegion = { ...REGION, latitude: 53.5 };

const RESULT = { total: 3, posts: [] };

/** Matches AUTO_SEARCH_DEBOUNCE_MS in the hook. */
const DEBOUNCE_MS = 600;

beforeEach(() => {
  mockFetch.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Advance past the debounce and let the resulting promises settle. */
const settleDebounce = async () => {
  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS);
  });
};

const entry = async (paused = false) => {
  mockFetch.mockResolvedValue(RESULT);
  const view = await renderHook(
    ({ isPaused }: { isPaused: boolean }) =>
      useViewportPosts(REGION, { paused: isPaused }),
    { initialProps: { isPaused: paused } },
  );
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  mockFetch.mockClear();
  return view;
};

describe('entry', () => {
  it('searches the initial region once, and never again for an equal-but-new object', async () => {
    mockFetch.mockResolvedValue(RESULT);

    const { result, rerender } = await renderHook(
      ({ region }: { region: GeoRegion }) => useViewportPosts(region),
      { initialProps: { region: REGION } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result.total).toBe(3);

    await rerender({ region: { ...REGION } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('errors on a failed entry search and recovers via retry', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    const { result } = await renderHook(() => useViewportPosts(REGION));
    await waitFor(() => expect(result.current.status).toBe('error'));

    mockFetch.mockResolvedValueOnce(RESULT);
    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result.total).toBe(3);
  });
});

describe('auto-search on pan', () => {
  it('ignores a nudge — momentum drift must never cost a request', async () => {
    const { result } = await entry();

    await act(async () => {
      result.current.onRegionChange({ ...REGION, latitude: REGION.latitude + 0.01 });
    });
    await settleDebounce();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does NOT search before the debounce elapses', async () => {
    const { result } = await entry();

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
      jest.advanceTimersByTime(DEBOUNCE_MS - 1);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('searches once the map has been still for the debounce', async () => {
    const { result } = await entry();
    mockFetch.mockResolvedValue({ total: 7, posts: [] });

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.result.total).toBe(7));
  });

  // The RPC-volume guard: hunting across a city is one search, not five.
  it('collapses a burst of gestures into ONE search at the FINAL region', async () => {
    mockFetch.mockResolvedValue(RESULT);
    const { result } = await entry();

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
      jest.advanceTimersByTime(100);
      result.current.onRegionChange(FARTHER_REGION);
      jest.advanceTimersByTime(100);
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.searchedRegion).toEqual(FAR_REGION));
  });

  it('keeps the applied criteria across an auto re-search', async () => {
    const { result } = await entry();

    const bmw = { ...emptyCriteria(), make: 'BMW' };
    mockFetch.mockResolvedValue({ total: 5, posts: [] });
    await act(async () => {
      await result.current.applySearch({ criteria: bmw, region: FAR_REGION });
    });
    expect(result.current.searchedRegion).toEqual(FAR_REGION);

    mockFetch.mockResolvedValue({ total: 2, posts: [] });
    await act(async () => {
      result.current.onRegionChange(FARTHER_REGION);
    });
    await settleDebounce();

    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({ make: 'BMW' });
  });
});

describe('a landed search settles in ONE commit', () => {
  // REGRESSION: `setSearching(false)` used to live in .finally, which is a
  // LATER microtask than .then — so React committed twice. In the first commit
  // searchId had bumped but `searching` was still true, which meant any
  // consumer keyed on searchId read a mid-flight view of the world. It was not
  // theoretical: MapListSheet's iOS VoiceOver announcement fires on searchId
  // and reads the label, so a user was told "Searching this area…" at the
  // moment the search FINISHED, and never heard the count — one state behind,
  // every time. Android was unaffected (its live region re-reads on the label
  // itself), so the two platforms disagreed.
  // The bug was never in the FINAL state — that always settled correctly. It
  // was that an intermediate commit existed. `result.current` only ever exposes
  // the last commit, so asserting the endpoint passes on both implementations;
  // the commit SEQUENCE has to be recorded as it happens.
  const commitsOf = (log: { id: number; searching: boolean }[]) => log;

  it('never commits a bumped searchId while `searching` is still true', async () => {
    const commits: { id: number; searching: boolean }[] = [];
    mockFetch.mockResolvedValue(RESULT);
    const view = await renderHook(() => {
      const hook = useViewportPosts(REGION);
      commits.push({ id: hook.searchId, searching: hook.searching });
      return hook;
    });
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    mockFetch.mockResolvedValue({ total: 3, posts: [] });
    commits.length = 0;

    await act(async () => {
      view.result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    // That window is exactly what MapListSheet's iOS announcement reads.
    expect(commitsOf(commits).filter((c) => c.id === 2 && c.searching)).toEqual([]);
    expect(view.result.current.searchId).toBe(2);
  });

  it('does the same on a FAILED re-search', async () => {
    const commits: { failed: boolean; searching: boolean }[] = [];
    mockFetch.mockResolvedValue(RESULT);
    const view = await renderHook(() => {
      const hook = useViewportPosts(REGION);
      commits.push({ failed: hook.searchFailed, searching: hook.searching });
      return hook;
    });
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    mockFetch.mockRejectedValue(new Error('offline'));
    commits.length = 0;

    await act(async () => {
      view.result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(commits.filter((c) => c.failed && c.searching)).toEqual([]);
    expect(view.result.current.searchFailed).toBe(true);
  });
});

describe('populationId vs searchId', () => {
  // These answer different questions and a consumer keyed to the wrong one
  // pays for it. searchId means "different results" — true after every pan, and
  // what the sheet's scroll reset wants. populationId means "a different SET of
  // cars", which a pan's re-search is not: it returns largely the same posts.
  // The progressive marker reveal keys off populationId, and keying it off
  // searchId made it unmount ~68 already-drawn markers on every pan — costing
  // more jank than not batching at all.
  it('bumps BOTH on the entry load', async () => {
    const { result } = await entry();

    expect(result.current.searchId).toBe(1);
    expect(result.current.populationId).toBe(1);
  });

  it('bumps ONLY searchId on the auto re-search after a pan', async () => {
    const { result } = await entry();
    mockFetch.mockResolvedValue({ total: 4, posts: [] });

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(result.current.searchId).toBe(2);
    expect(result.current.populationId).toBe(1);
  });

  it('bumps BOTH on an explicit retry — that IS a fresh population', async () => {
    const { result } = await entry();
    mockFetch.mockResolvedValue({ total: 4, posts: [] });

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.searchId).toBe(2);
    expect(result.current.populationId).toBe(2);
  });

  it('bumps BOTH on an applied search', async () => {
    const { result } = await entry();
    mockFetch.mockResolvedValue({ total: 4, posts: [] });

    await act(async () => {
      await result.current.applySearch({ criteria: emptyCriteria(), region: FAR_REGION });
    });

    expect(result.current.populationId).toBe(2);
  });
});

describe('paused (a card is open)', () => {
  // REGRESSION: disowning in-flight searches was written against the paused
  // STATE rather than the false→true edge. The initial-load effect is declared
  // above the pause effect, so on a hook that mounts already paused it had
  // already taken a token — and the pause effect immediately bumped it, drop-
  // ping the entry load. The screen sat on its skeleton for ever, with no
  // pending request and nothing to retry it. Nothing on screen distinguishes
  // that from a slow network, so it has to be asserted.
  it('still completes the ENTRY load when it mounts already paused', async () => {
    mockFetch.mockResolvedValue(RESULT);

    const { result } = await renderHook(() => useViewportPosts(REGION, { paused: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result.total).toBe(3);
  });

  // An applied search or a toast retry is 'initial'. The first attempt at the
  // stranded-skeleton fix exempted those from the disown — which bought the
  // fix by breaking the hook's headline promise: the search would land while
  // the card was open and swap MEMBERSHIP under it, and the pager resolves its
  // settle index against the new list, so a swipe at that moment lands on a
  // different car than the card shows. Disown everything; defer the explicit
  // search instead.
  it('disowns an explicit search a card interrupted, and re-runs it after', async () => {
    const view = await entry();

    // An explicit search leaves...
    let landed: (value: { total: number; posts: [] }) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        landed = resolve;
      }),
    );
    await act(async () => {
      void view.result.current.applySearch({ criteria: emptyCriteria(), region: FAR_REGION });
    });

    // ...a card opens before it lands...
    await act(async () => {
      view.rerender({ isPaused: true });
    });
    // ...and it lands anyway. It must be DROPPED, not rendered.
    await act(async () => {
      landed({ total: 99, posts: [] });
    });

    expect(view.result.current.result.total).toBe(3); // unchanged, card is safe

    // The card closes: the search the user asked for finally runs.
    mockFetch.mockResolvedValue({ total: 99, posts: [] });
    await act(async () => {
      view.rerender({ isPaused: false });
    });
    await waitFor(() => expect(view.result.current.result.total).toBe(99));
  });

  // Load-bearing: movedEnough is false if they never panned, so leaning on the
  // unpause's scheduleAutoSearch would mean the search never runs at all.
  it('re-runs it even though the map never moved', async () => {
    const view = await entry();

    let landed: (value: { total: number; posts: [] }) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        landed = resolve;
      }),
    );
    await act(async () => {
      // SAME region — nothing about the viewport changed.
      void view.result.current.applySearch({ criteria: emptyCriteria(), region: REGION });
    });
    await act(async () => {
      view.rerender({ isPaused: true });
    });
    await act(async () => {
      landed({ total: 7, posts: [] });
    });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ total: 7, posts: [] });

    await act(async () => {
      view.rerender({ isPaused: false });
    });

    expect(mockFetch).toHaveBeenCalled();
    await waitFor(() => expect(view.result.current.result.total).toBe(7));
  });

  it('records the pan but does not search', async () => {
    const { result } = await entry(true);

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(mockFetch).not.toHaveBeenCalled();
    // The results the user is reading are untouched.
    expect(result.current.result.total).toBe(3);
  });

  it('runs the postponed search when the card closes', async () => {
    const { result, rerender } = await entry(true);

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValue({ total: 4, posts: [] });
    await rerender({ isPaused: false });
    await settleDebounce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.searchedRegion).toEqual(FAR_REGION));
  });

  it('does not search on unpause if the map never moved', async () => {
    const { rerender } = await entry(true);

    await rerender({ isPaused: false });
    await settleDebounce();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('failures and bookkeeping', () => {
  it('keeps results on a failed auto re-search and flags it', async () => {
    const { result } = await entry();

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();

    expect(result.current.status).toBe('ready'); // old results stand
    expect(result.current.result.total).toBe(3);
    expect(result.current.searching).toBe(false);
    await waitFor(() => expect(result.current.searchFailed).toBe(true));
    // Region unmoved, so the next settled pan re-attempts by itself — this is
    // what replaces the old button's "this area is unsearched" state.
    expect(result.current.searchedRegion).toEqual(REGION);
  });

  it('moves searchedRegion only on success', async () => {
    const { result } = await entry();

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    expect(result.current.searchedRegion).toEqual(REGION); // pan alone: no move

    mockFetch.mockResolvedValue({ total: 1, posts: [] });
    await settleDebounce();

    await waitFor(() => expect(result.current.searchedRegion).toEqual(FAR_REGION));
  });

  it('bumps searchId once per LANDED search, never on a failure', async () => {
    const { result } = await entry();
    const afterEntry = result.current.searchId;

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await settleDebounce();
    expect(result.current.searchId).toBe(afterEntry);

    mockFetch.mockResolvedValue(RESULT);
    await act(async () => {
      result.current.onRegionChange(FARTHER_REGION);
    });
    await settleDebounce();
    await waitFor(() => expect(result.current.searchId).toBe(afterEntry + 1));
  });

  it('drops a superseded response rather than rendering stale results', async () => {
    let resolveFirst!: (r: typeof RESULT) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );

    const { result } = await renderHook(() => useViewportPosts(REGION));
    expect(result.current.status).toBe('loading');

    // A second search supersedes the hanging entry load.
    mockFetch.mockResolvedValue({ total: 9, posts: [] });
    await act(async () => {
      await result.current.applySearch({ criteria: emptyCriteria(), region: FAR_REGION });
    });
    expect(result.current.result.total).toBe(9);

    // The stale entry load lands late and must be ignored entirely.
    await act(async () => {
      resolveFirst({ total: 999, posts: [] });
      await Promise.resolve();
    });
    expect(result.current.result.total).toBe(9);
  });

  // THE guard for the sheet-zoom coupling. Dragging the sheet changes the zoom
  // by far more than movedEnough's 1.4x threshold, so if this ever routes
  // through onRegionChange instead, every sheet drag fires a network search —
  // in both directions, and silently.
  it('recordRegion notes the region WITHOUT scheduling a search', async () => {
    const { result } = await entry();

    await act(async () => {
      result.current.recordRegion(FAR_REGION);
    });
    await settleDebounce();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a recorded region still counts for the NEXT real pan', async () => {
    const { result } = await entry();

    // The sheet zoomed the camera out here...
    await act(async () => {
      result.current.recordRegion(FAR_REGION);
    });
    await settleDebounce();
    expect(mockFetch).not.toHaveBeenCalled();

    // ...and a genuine gesture from there searches the region actually shown.
    mockFetch.mockResolvedValue(RESULT);
    await act(async () => {
      result.current.onRegionChange(FARTHER_REGION);
    });
    await settleDebounce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.searchedRegion).toEqual(FARTHER_REGION));
  });

  // A pending timer firing after unmount would setState on a dead hook.
  it('cancels a pending auto-search on unmount', async () => {
    const { result, unmount } = await entry();

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    await act(async () => {
      unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

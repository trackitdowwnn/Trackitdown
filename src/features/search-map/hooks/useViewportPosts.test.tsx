/**
 * WHAT:  Tests for useViewportPosts — entry search, the calm Search-this-
 *        area offer/consume cycle, failed re-search keeping results AND
 *        the button, retry after an initial error, and the capture-once
 *        initial region.
 * WHY:   This state machine IS the map's UX contract: results must never
 *        change without an explicit user action after entry.
 * LINKS: src/features/search-map/hooks/useViewportPosts.ts,
 *        docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { GeoRegion } from '@/shared/types';

import { useViewportPosts } from './useViewportPosts';

const mockFetch = jest.fn();

jest.mock('../api/mapApi', () => ({
  fetchViewportPosts: (...args: unknown[]) => mockFetch(...args),
}));

const REGION: GeoRegion = {
  latitude: 51.77,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};
/** Panned well beyond the 30% threshold. */
const FAR_REGION: GeoRegion = { ...REGION, latitude: 52.5 };

const RESULT = { total: 3, posts: [] };

beforeEach(() => {
  mockFetch.mockReset();
});

describe('useViewportPosts', () => {
  it('searches the initial region once on entry', async () => {
    mockFetch.mockResolvedValue(RESULT);

    const { result, rerender } = await renderHook(
      ({ region }: { region: GeoRegion }) => useViewportPosts(region),
      { initialProps: { region: REGION } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result.total).toBe(3);

    // A fresh-but-equal region object must not re-search (capture-once).
    await rerender({ region: { ...REGION } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('offers Search-this-area only after moving enough, and consumes it on search', async () => {
    mockFetch.mockResolvedValue(RESULT);
    const { result } = await renderHook(() => useViewportPosts(REGION));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      result.current.onRegionChange({ ...REGION, latitude: REGION.latitude + 0.01 });
    });
    expect(result.current.showSearchArea).toBe(false); // small nudge

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    expect(result.current.showSearchArea).toBe(true);

    mockFetch.mockResolvedValue({ total: 7, posts: [] });
    await act(async () => {
      await result.current.searchThisArea();
    });

    expect(result.current.result.total).toBe(7);
    expect(result.current.showSearchArea).toBe(false); // consumed
    expect(result.current.searching).toBe(false);

    // The searched region moved with the search: panning BACK now offers it.
    await act(async () => {
      result.current.onRegionChange(REGION);
    });
    expect(result.current.showSearchArea).toBe(true);
  });

  it('keeps previous results and the button when a re-search fails', async () => {
    mockFetch.mockResolvedValueOnce(RESULT);
    const { result } = await renderHook(() => useViewportPosts(REGION));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.searchThisArea();
    });

    expect(result.current.status).toBe('ready'); // old results stand
    expect(result.current.result.total).toBe(3);
    expect(result.current.showSearchArea).toBe(true); // region still unsearched
    expect(result.current.searching).toBe(false); // flag released
  });

  it('keeps "searching" true when a superseded request resolves first', async () => {
    // Entry load hangs; a re-search is started before it resolves. When the
    // stale entry load finally settles, it must NOT clear `searching`.
    let resolveEntry!: (r: typeof RESULT) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => (resolveEntry = resolve)),
    );

    const { result } = await renderHook(() => useViewportPosts(REGION));
    // Entry load is in flight (status still loading).
    expect(result.current.status).toBe('loading');

    // Move + start a re-search that also hangs.
    let resolveResearch!: (r: typeof RESULT) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => (resolveResearch = resolve)),
    );
    await act(async () => {
      result.current.onRegionChange(FAR_REGION);
    });
    let researchPromise!: Promise<void>;
    await act(async () => {
      researchPromise = result.current.searchThisArea();
      await Promise.resolve();
    });
    expect(result.current.searching).toBe(true);

    // The STALE entry load resolves late — must not touch searching.
    await act(async () => {
      resolveEntry(RESULT);
      await Promise.resolve();
    });
    expect(result.current.searching).toBe(true);

    // The current re-search resolves — now it clears.
    await act(async () => {
      resolveResearch({ total: 9, posts: [] });
      await researchPromise;
    });
    expect(result.current.searching).toBe(false);
    expect(result.current.result.total).toBe(9);
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

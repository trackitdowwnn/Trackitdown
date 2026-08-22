/**
 * WHAT:  Tests for usePostDetail — it WAITS while auth is resolving (so the
 *        server-computed is_owner is correct on first paint), then fetches;
 *        exposes ready/error; and retry re-fetches.
 * WHY:   Firing before the session resolves would render an owner the spotter
 *        view for a frame — the exact owner/spotter flash the wait prevents.
 * LINKS: src/features/vehicles/hooks/usePostDetail.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePostDetail } from './usePostDetail';

const mockFetch = jest.fn();
jest.mock('../api/vehicleApi', () => ({ fetchPostDetail: (...args: unknown[]) => mockFetch(...args) }));

const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({ useSession: () => mockUseSession() }));

// The live-refresh focus effect needs a navigation container the bare hook
// harness doesn't have; the focus/poll behaviour is exercised on-device.
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));

const VISIBLE = { kind: 'visible', post: { id: 'p1', isOwner: false } };

beforeEach(() => {
  mockFetch.mockReset();
  mockUseSession.mockReset();
});

describe('usePostDetail', () => {
  it('does not fetch while the session is still loading', async () => {
    mockUseSession.mockReturnValue({ status: 'loading', userId: null });
    const { result } = await renderHook(() => usePostDetail('p1'));

    expect(result.current.status).toBe('loading');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches once auth has resolved and exposes the result', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    mockFetch.mockResolvedValue(VISIBLE);
    const { result } = await renderHook(() => usePostDetail('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetch).toHaveBeenCalledWith('p1');
    expect(result.current.result).toEqual(VISIBLE);
  });

  it('errors when the fetch rejects, and retry re-fetches', async () => {
    mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => usePostDetail('p1'));

    await waitFor(() => expect(result.current.status).toBe('error'));

    mockFetch.mockResolvedValueOnce(VISIBLE);
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result).toEqual(VISIBLE);
  });

  describe('the pull', () => {
    it('re-fetches and lands back on ready', async () => {
      mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
      mockFetch.mockResolvedValue(VISIBLE);
      const { result } = await renderHook(() => usePostDetail('p1'));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      const moved = { kind: 'visible', post: { id: 'p1', isOwner: false, sightings: 3 } };
      mockFetch.mockResolvedValue(moved);
      await act(async () => result.current.refresh());

      expect(result.current.result).toEqual(moved);
      expect(result.current.refreshing).toBe(false);
    });

    it('recovers from the error state', async () => {
      // The reason the pull always lands on `ready` rather than copying the
      // background refresh, which returns silently and would leave someone
      // tugging a dead error page.
      mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
      mockFetch.mockRejectedValue(new Error('offline'));
      const { result } = await renderHook(() => usePostDetail('p1'));
      await waitFor(() => expect(result.current.status).toBe('error'));

      mockFetch.mockResolvedValue(VISIBLE);
      await act(async () => result.current.refresh());

      expect(result.current.status).toBe('ready');
      expect(result.current.result).toEqual(VISIBLE);
    });

    it('keeps the listing on screen when the pull fails', async () => {
      // ⚠️ Load-bearing. Someone reading a listing in a car park with one bar
      // must not lose it because they tugged the page.
      mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
      mockFetch.mockResolvedValue(VISIBLE);
      const { result } = await renderHook(() => usePostDetail('p1'));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      mockFetch.mockRejectedValue(new Error('offline'));
      await act(async () => result.current.refresh());

      expect(result.current.status).toBe('ready');
      expect(result.current.result).toEqual(VISIBLE);
      expect(result.current.refreshing).toBe(false);
    });
  });
});

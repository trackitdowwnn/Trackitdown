/**
 * WHAT:  Tests for useMyReportPhotos — paths fetched and signed into
 *        sighting id → URL; a failure costs the photos, never throws; the
 *        same set of ids isn't fetched twice; no ids, no fetch.
 * WHY:   The photos sit beside the record, never in front of it: a broken
 *        photo read must leave My sightings working with its tiles.
 * LINKS: src/features/sightings/hooks/useMyReportPhotos.ts.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useMyReportPhotos } from './useMyReportPhotos';

const mockFetch = jest.fn();
const mockSign = jest.fn();
jest.mock('../api/sightingApi', () => ({
  fetchMyReportPhotos: (ids: string[]) => mockFetch(ids),
  signSightingPhotoUrls: (paths: string[]) => mockSign(paths),
}));

const flush = () => act(async () => {});

beforeEach(() => {
  mockFetch.mockReset();
  mockSign.mockReset();
});

it('maps each report to its signed photo', async () => {
  mockFetch.mockResolvedValue({ s1: 'p/u/a.jpg', s2: 'p/u/b.jpg' });
  mockSign.mockResolvedValue({ 'p/u/a.jpg': 'https://x/a' });
  const { result } = await renderHook(() => useMyReportPhotos(['s1', 's2']));
  await flush();
  // s2's photo didn't sign: it simply has no URL, and keeps its tile.
  expect(result.current).toEqual({ urls: { s1: 'https://x/a' }, loaded: true });
});

it('is not loaded until the lookup has finished — the cards show empty frames', async () => {
  let resolve: (paths: Record<string, string>) => void = () => {};
  mockFetch.mockReturnValue(new Promise((done) => (resolve = done)));
  mockSign.mockResolvedValue({});
  const { result } = await renderHook(() => useMyReportPhotos(['s1']));
  expect(result.current.loaded).toBe(false);
  await act(async () => resolve({}));
  expect(result.current.loaded).toBe(true);
});

it('⚠️ a failed read costs the photos — nothing throws, and the tiles come back', async () => {
  mockFetch.mockRejectedValue(new Error('permission denied'));
  const { result } = await renderHook(() => useMyReportPhotos(['s1']));
  await flush();
  expect(result.current).toEqual({ urls: {}, loaded: true });
});

it('sets nothing after it has gone — a lookup that lands late is dropped', async () => {
  let resolve: (paths: Record<string, string>) => void = () => {};
  mockFetch.mockReturnValue(new Promise((done) => (resolve = done)));
  mockSign.mockResolvedValue({ 'p/u/a.jpg': 'https://x/a' });
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = await renderHook(() => useMyReportPhotos(['s1']));
  await act(async () => unmount());
  await act(async () => resolve({ s1: 'p/u/a.jpg' }));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it('fetches once for the same set of reports, in any order', async () => {
  mockFetch.mockResolvedValue({});
  mockSign.mockResolvedValue({});
  const { rerender } = await renderHook(({ ids }: { ids: string[] }) => useMyReportPhotos(ids), {
    initialProps: { ids: ['s1', 's2'] },
  });
  await flush();
  await rerender({ ids: ['s2', 's1'] });
  await flush();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('asks nothing when there are no reports — and has nothing to wait for', async () => {
  const { result } = await renderHook(() => useMyReportPhotos([]));
  await flush();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(result.current.loaded).toBe(true);
});

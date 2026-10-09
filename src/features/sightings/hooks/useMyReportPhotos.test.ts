/**
 * WHAT:  Tests for useMyReportPhotos — paths fetched and signed into
 *        sighting id → URL; each report marked looked-up when its lookup
 *        settles (so its card leaves the empty frame); a failure costs the
 *        photos, never throws; a lookup landing after unmount signs nothing;
 *        the same set of ids isn't fetched twice; no ids, no fetch.
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

it('maps each report to its signed photo, and marks each looked up', async () => {
  mockFetch.mockResolvedValue({ s1: 'p/u/a.jpg', s2: 'p/u/b.jpg' });
  mockSign.mockResolvedValue({ 'p/u/a.jpg': 'https://x/a' });
  const { result } = await renderHook(() => useMyReportPhotos(['s1', 's2']));
  await flush();
  // s2's photo didn't sign: it simply has no URL, and keeps its tile.
  expect(result.current).toEqual({
    urls: { s1: 'https://x/a' },
    lookedUp: { s1: true, s2: true },
  });
});

it('marks nothing looked up until the lookup settles — the cards show empty frames', async () => {
  let resolve: (paths: Record<string, string>) => void = () => {};
  mockFetch.mockReturnValue(new Promise((done) => (resolve = done)));
  mockSign.mockResolvedValue({});
  const { result } = await renderHook(() => useMyReportPhotos(['s1']));
  expect(result.current.lookedUp.s1).toBeUndefined();
  await act(async () => resolve({}));
  expect(result.current.lookedUp.s1).toBe(true);
});

it('⚠️ a failed read costs the photos — nothing throws, and the tiles come back', async () => {
  mockFetch.mockRejectedValue(new Error('permission denied'));
  const { result } = await renderHook(() => useMyReportPhotos(['s1']));
  await flush();
  expect(result.current).toEqual({ urls: {}, lookedUp: { s1: true } });
});

it('⚠️ signs nothing for a lookup that lands after it has gone', async () => {
  let resolve: (paths: Record<string, string>) => void = () => {};
  mockFetch.mockReturnValue(new Promise((done) => (resolve = done)));
  const { unmount } = await renderHook(() => useMyReportPhotos(['s1']));
  await act(async () => unmount());
  await act(async () => resolve({ s1: 'p/u/a.jpg' }));
  expect(mockSign).not.toHaveBeenCalled();
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

it('a new report doesn’t send the others back to an empty frame', async () => {
  mockFetch.mockResolvedValue({});
  mockSign.mockResolvedValue({});
  let resolveSecond: (paths: Record<string, string>) => void = () => {};
  const { result, rerender } = await renderHook(
    ({ ids }: { ids: string[] }) => useMyReportPhotos(ids),
    { initialProps: { ids: ['s1'] } },
  );
  await flush();
  mockFetch.mockReturnValue(new Promise((done) => (resolveSecond = done)));
  await rerender({ ids: ['s1', 's2'] });
  // s2 is being looked up; s1 already was.
  expect(result.current.lookedUp).toEqual({ s1: true });
  await act(async () => resolveSecond({}));
  expect(result.current.lookedUp).toEqual({ s1: true, s2: true });
});

it('asks nothing when there are no reports', async () => {
  const { result } = await renderHook(() => useMyReportPhotos([]));
  await flush();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(result.current.lookedUp).toEqual({});
});

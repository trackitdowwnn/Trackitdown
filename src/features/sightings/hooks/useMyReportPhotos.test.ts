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
  expect(result.current).toEqual({ s1: 'https://x/a' });
});

it('⚠️ a failed read costs the photos — nothing throws', async () => {
  mockFetch.mockRejectedValue(new Error('permission denied'));
  const { result } = await renderHook(() => useMyReportPhotos(['s1']));
  await flush();
  expect(result.current).toEqual({});
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

it('asks nothing when there are no reports', async () => {
  await renderHook(() => useMyReportPhotos([]));
  await flush();
  expect(mockFetch).not.toHaveBeenCalled();
});

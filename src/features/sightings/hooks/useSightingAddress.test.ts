/**
 * WHAT:  Tests for useSightingAddress: the stored area until the device
 *        lookup answers, then the street address; the area kept when the
 *        lookup fails, returns nothing or is too slow; no lookup without a
 *        point; and never the LAST point's address after the point changes.
 * WHY:   The address sits under "Where" on the owner's page (2026-10-20). A
 *        stale one would put another sighting's street under this map.
 * LINKS: src/features/sightings/hooks/useSightingAddress.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { LOOKUP_TIMEOUT_MS } from '@/shared/lib/location/placeLabels';

import { useSightingAddress, type ReverseGeocode, type SightingPoint } from './useSightingAddress';

const POINT = { lat: 53.4794, lng: -2.2453 };
const AREA = 'Deansgate, Manchester';

it('shows the stored area, then the street address once the lookup answers', async () => {
  const geocode: ReverseGeocode = jest.fn(async () => 'Deansgate, Manchester, M3 2BW');
  const { result } = await renderHook(() => useSightingAddress(POINT, AREA, geocode));
  await waitFor(() => expect(result.current).toBe('Deansgate, Manchester, M3 2BW'));
  expect(geocode).toHaveBeenCalledWith({ latitude: 53.4794, longitude: -2.2453 });
});

it.each([
  ['finds nothing', async () => null],
  [
    'fails',
    async (): Promise<string | null> => {
      throw new Error('no geocoder');
    },
  ],
])('keeps the stored area when the lookup %s', async (_, impl) => {
  const geocode: ReverseGeocode = jest.fn(impl);
  const { result } = await renderHook(() => useSightingAddress(POINT, AREA, geocode));
  await waitFor(() => expect(geocode).toHaveBeenCalled());
  await act(async () => {});
  expect(result.current).toBe(AREA);
});

it('keeps the stored area when the lookup is too slow — even once it answers', async () => {
  jest.useFakeTimers();
  try {
    // Answers, but only after the timeout: without the timeout this test
    // would end on 'Late St', so it can fail.
    const geocode: ReverseGeocode = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          setTimeout(() => resolve('Late St'), LOOKUP_TIMEOUT_MS * 2);
        }),
    );
    const { result } = await renderHook(() => useSightingAddress(POINT, AREA, geocode));
    await act(async () => {
      jest.advanceTimersByTime(LOOKUP_TIMEOUT_MS * 3);
    });
    expect(result.current).toBe(AREA);
  } finally {
    jest.useRealTimers();
  }
});

it('looks nothing up without a point — the area, or nothing at all', async () => {
  const geocode: ReverseGeocode = jest.fn(async () => 'Somewhere');
  const { result } = await renderHook(() => useSightingAddress(null, null, geocode));
  expect(result.current).toBeNull();
  expect(geocode).not.toHaveBeenCalled();
});

it('⚠️ never shows the last point’s address while the new one is looked up', async () => {
  let answerSecond: (address: string | null) => void = () => {};
  const geocode: ReverseGeocode = jest.fn(({ latitude }) =>
    latitude === POINT.lat
      ? Promise.resolve('First Street, M1 1AA')
      : new Promise<string | null>((resolve) => {
          answerSecond = resolve;
        }),
  );
  const { result, rerender } = await renderHook(
    ({ point, area }: { point: SightingPoint; area: string }) =>
      useSightingAddress(point, area, geocode),
    { initialProps: { point: POINT, area: AREA } },
  );
  await waitFor(() => expect(result.current).toBe('First Street, M1 1AA'));

  await rerender({ point: { lat: 51.5, lng: -0.1 }, area: 'Camden, London' });
  expect(result.current).toBe('Camden, London');

  await act(async () => answerSecond('Camden High St, NW1 7JE'));
  expect(result.current).toBe('Camden High St, NW1 7JE');
});

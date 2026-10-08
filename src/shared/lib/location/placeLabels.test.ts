/**
 * WHAT:  Tests for placeLabels: the two grains (the public one never holds a
 *        street), the lookup's time limit, and the per-point memory that
 *        lets the map step warm the answer its Next will need.
 * WHY:   The posting wizard awaits this on the map step's Next. A geocode
 *        can hang with no error, and the button spun for as long as the OS
 *        liked (2026-10-08). A remembered failure would also be wrong: the
 *        next ask must try again.
 * LINKS: ./placeLabels.ts; src/features/vehicles/post/postACarFlow.tsx;
 *        docs/decisions/ADR-0008 (public sighting face).
 */

import * as Location from 'expo-location';

import {
  LOOKUP_TIMEOUT_MS,
  derivePlaceLabelsForCoord,
  resetPlaceLabelCache,
  warmPlaceLabels,
} from './placeLabels';

jest.mock('expo-location', () => ({ reverseGeocodeAsync: jest.fn() }));
const mockGeocode = Location.reverseGeocodeAsync as jest.Mock;

const POINT = { latitude: 53.4794, longitude: -2.2453 };
const PLACE = { street: 'Deansgate', district: 'City Centre', city: 'Manchester' };

beforeEach(() => {
  jest.clearAllMocks();
  resetPlaceLabelCache();
  mockGeocode.mockResolvedValue([PLACE]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('derivePlaceLabelsForCoord', () => {
  it('gives the owner a street, and the public grain a district only', async () => {
    await expect(derivePlaceLabelsForCoord(POINT)).resolves.toEqual({
      areaLabel: 'Deansgate, Manchester',
      locality: 'City Centre',
    });
  });

  it('remembers an answer per point: a warm-up and the Next after it share one lookup', async () => {
    warmPlaceLabels(POINT);
    // A few metres away — the same ~10m cell.
    await derivePlaceLabelsForCoord({ latitude: 53.47941, longitude: -2.24531 });
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('a different point is a different lookup', async () => {
    await derivePlaceLabelsForCoord(POINT);
    await derivePlaceLabelsForCoord({ latitude: 53.49, longitude: -2.25 });
    expect(mockGeocode).toHaveBeenCalledTimes(2);
  });

  it('gives up after its time limit — no labels, never a hang', async () => {
    jest.useFakeTimers();
    mockGeocode.mockReturnValue(new Promise(() => {})); // never answers
    let result: unknown;
    void derivePlaceLabelsForCoord(POINT).then((labels) => {
      result = labels;
    });

    await jest.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ areaLabel: null, locality: null });
  });

  it('each ask gets the whole time limit, even joining a lookup a warm-up started', async () => {
    jest.useFakeTimers();
    let land: (value: unknown) => void = () => {};
    mockGeocode.mockReturnValue(new Promise((resolve) => (land = resolve)));
    warmPlaceLabels(POINT);
    await jest.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 100); // the warm-up has been waiting

    let result: unknown;
    void derivePlaceLabelsForCoord(POINT).then((labels) => {
      result = labels;
    });
    await jest.advanceTimersByTimeAsync(200); // past the WARM-UP's limit, not this ask's
    expect(result).toBeUndefined();
    land([PLACE]);
    await jest.advanceTimersByTimeAsync(0);
    expect(result).toMatchObject({ locality: 'City Centre' });
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('a slow answer that lands after an ask gave up is kept for the next ask', async () => {
    jest.useFakeTimers();
    let land: (value: unknown) => void = () => {};
    mockGeocode.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const first = derivePlaceLabelsForCoord(POINT);
    await jest.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS);
    await expect(first).resolves.toEqual({ areaLabel: null, locality: null });

    land([PLACE]); // it arrives, late
    await jest.advanceTimersByTimeAsync(0);
    await expect(derivePlaceLabelsForCoord(POINT)).resolves.toMatchObject({ locality: 'City Centre' });
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('a lookup that never answers is dropped at the time limit — the next ask starts afresh', async () => {
    jest.useFakeTimers();
    mockGeocode.mockReturnValueOnce(new Promise(() => {})); // hangs for ever
    const first = derivePlaceLabelsForCoord(POINT);
    await jest.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS);
    await expect(first).resolves.toEqual({ areaLabel: null, locality: null });

    await expect(derivePlaceLabelsForCoord(POINT)).resolves.toMatchObject({ locality: 'City Centre' });
    expect(mockGeocode).toHaveBeenCalledTimes(2);
  });

  it('a FAILED lookup is not remembered — the next ask tries again', async () => {
    mockGeocode.mockRejectedValueOnce(new Error('offline'));
    await expect(derivePlaceLabelsForCoord(POINT)).resolves.toEqual({
      areaLabel: null,
      locality: null,
    });
    await expect(derivePlaceLabelsForCoord(POINT)).resolves.toMatchObject({
      locality: 'City Centre',
    });
    expect(mockGeocode).toHaveBeenCalledTimes(2);
  });
});

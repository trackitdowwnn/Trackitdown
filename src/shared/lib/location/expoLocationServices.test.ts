/**
 * WHAT:  Tests for the expoLocationServices adapter — the SAFETY gate on
 *        getCurrentPosition (position is NEVER read unless permission is
 *        explicitly granted), the module-unavailable degradation to
 *        nulls/empties, address-label formatting from reverse-geocode hits,
 *        forward-geocode mapping, and every error path resolving to a safe
 *        fallback instead of throwing.
 * WHY:   Location is personal data and strictly opt-in (SECURITY_AND_TRUST):
 *        a regression that reads the device position on a denied prompt would
 *        be a trust breach, and a thrown error from any of these methods would
 *        crash LocationPicker mid-report. The LocationServices contract says
 *        "resolve null/empty, never throw" — this suite locks that down.
 * LINKS: src/shared/lib/location/expoLocationServices.ts,
 *        src/shared/types/location.ts (contract),
 *        docs/SECURITY_AND_TRUST.md, docs/TESTING.md.
 */

import { expoLocationServices } from './expoLocationServices';

// The adapter lazy-requires expo-location on every call, so the factory runs
// (or re-runs, after a resetModules) at call time. `mockLoadShouldFail` lets a
// test simulate the native module being absent/broken without touching the
// adapter, and the `mock`-prefixed names are allowed inside the hoisted factory.
let mockLoadShouldFail = false;
const mockExpoLocation = {
  reverseGeocodeAsync: jest.fn(),
  geocodeAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
};

jest.mock('expo-location', () => {
  if (mockLoadShouldFail) {
    throw new Error('expo-location native module unavailable');
  }
  return mockExpoLocation;
});

const COORD = { latitude: 51.7521, longitude: -0.4482 }; // Hemel Hempstead

/** Make the next lazy `import('expo-location')` throw, as on a platform where
 *  the module cannot load. resetModules drops the cached (successful) require
 *  so the throwing factory actually re-runs. */
function makeExpoLocationUnavailable() {
  jest.resetModules();
  mockLoadShouldFail = true;
}

beforeEach(() => {
  jest.resetModules();
  mockLoadShouldFail = false;
  mockExpoLocation.reverseGeocodeAsync.mockReset().mockResolvedValue([]);
  mockExpoLocation.geocodeAsync.mockReset().mockResolvedValue([]);
  mockExpoLocation.requestForegroundPermissionsAsync
    .mockReset()
    .mockResolvedValue({ status: 'granted' });
  mockExpoLocation.getCurrentPositionAsync.mockReset().mockResolvedValue({ coords: COORD });
});

describe('expoLocationServices.getCurrentPosition', () => {
  // SAFETY: the whole point of the adapter's permission gate.
  it('never reads the device position when permission is denied', async () => {
    mockExpoLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(expoLocationServices.getCurrentPosition()).resolves.toBeNull();

    expect(mockExpoLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('never reads the device position when the prompt resolves undetermined', async () => {
    // Any non-'granted' status (undetermined, restricted, ...) must gate too —
    // the check is `status !== 'granted'`, not `status === 'denied'`.
    mockExpoLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
    });

    await expect(expoLocationServices.getCurrentPosition()).resolves.toBeNull();

    expect(mockExpoLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('returns the coordinates when permission is granted', async () => {
    await expect(expoLocationServices.getCurrentPosition()).resolves.toEqual({
      latitude: COORD.latitude,
      longitude: COORD.longitude,
    });

    // Permission is requested first, exactly once, then the single read.
    expect(mockExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockExpoLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('resolves null without throwing when the permission request itself rejects', async () => {
    mockExpoLocation.requestForegroundPermissionsAsync.mockRejectedValue(
      new Error('prompt interrupted'),
    );

    await expect(expoLocationServices.getCurrentPosition()).resolves.toBeNull();
    expect(mockExpoLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('resolves null without throwing when the position read rejects', async () => {
    mockExpoLocation.getCurrentPositionAsync.mockRejectedValue(new Error('GPS timeout'));

    await expect(expoLocationServices.getCurrentPosition()).resolves.toBeNull();
  });

  it('resolves null when expo-location fails to load', async () => {
    makeExpoLocationUnavailable();

    await expect(expoLocationServices.getCurrentPosition()).resolves.toBeNull();

    // The module never loaded, so neither the prompt nor the read can happen.
    expect(mockExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockExpoLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

describe('expoLocationServices.reverseGeocode', () => {
  it('formats the first hit as "name, street, district, postcode"', async () => {
    mockExpoLocation.reverseGeocodeAsync.mockResolvedValue([
      {
        name: 'The Old Town Hall',
        street: 'High St',
        district: 'Old Town',
        city: 'Hemel Hempstead',
        region: 'Hertfordshire',
        postalCode: 'HP1 3AE',
      },
    ]);

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBe(
      'The Old Town Hall, High St, Old Town, HP1 3AE',
    );
    expect(mockExpoLocation.reverseGeocodeAsync).toHaveBeenCalledWith(COORD);
  });

  it('drops a name identical to the street and falls back to city when district is missing', async () => {
    mockExpoLocation.reverseGeocodeAsync.mockResolvedValue([
      {
        name: 'Shenley Rd', // house-number-less addresses often echo the street
        street: 'Shenley Rd',
        district: null,
        city: 'Hemel Hempstead',
        postalCode: 'HP2 7RJ',
      },
    ]);

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBe(
      'Shenley Rd, Hemel Hempstead, HP2 7RJ',
    );
  });

  it('returns null when the hit has no usable address parts', async () => {
    mockExpoLocation.reverseGeocodeAsync.mockResolvedValue([
      { name: null, street: null, district: null, city: null, postalCode: null },
    ]);

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBeNull();
  });

  it('returns null when there are no hits', async () => {
    mockExpoLocation.reverseGeocodeAsync.mockResolvedValue([]);

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBeNull();
  });

  it('resolves null without throwing when geocoding rejects', async () => {
    mockExpoLocation.reverseGeocodeAsync.mockRejectedValue(new Error('network down'));

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBeNull();
  });

  it('resolves null when expo-location fails to load', async () => {
    makeExpoLocationUnavailable();

    await expect(expoLocationServices.reverseGeocode(COORD)).resolves.toBeNull();
    expect(mockExpoLocation.reverseGeocodeAsync).not.toHaveBeenCalled();
  });
});

describe('expoLocationServices.forwardGeocode', () => {
  it('maps each hit to a result labelled with the raw query', async () => {
    mockExpoLocation.geocodeAsync.mockResolvedValue([
      { latitude: 52.2, longitude: -0.9 },
      { latitude: 51.5, longitude: -0.12 },
    ]);

    await expect(expoLocationServices.forwardGeocode('valley green')).resolves.toEqual([
      { latitude: 52.2, longitude: -0.9, label: 'valley green' },
      { latitude: 51.5, longitude: -0.12, label: 'valley green' },
    ]);
    expect(mockExpoLocation.geocodeAsync).toHaveBeenCalledWith('valley green');
  });

  it('returns an empty array when there are no hits', async () => {
    mockExpoLocation.geocodeAsync.mockResolvedValue([]);

    await expect(expoLocationServices.forwardGeocode('nowhere')).resolves.toEqual([]);
  });

  it('resolves an empty array without throwing when geocoding rejects', async () => {
    mockExpoLocation.geocodeAsync.mockRejectedValue(new Error('rate limited'));

    await expect(expoLocationServices.forwardGeocode('valley green')).resolves.toEqual([]);
  });

  it('resolves an empty array when expo-location fails to load', async () => {
    makeExpoLocationUnavailable();

    await expect(expoLocationServices.forwardGeocode('valley green')).resolves.toEqual([]);
    expect(mockExpoLocation.geocodeAsync).not.toHaveBeenCalled();
  });
});

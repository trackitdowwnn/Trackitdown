/**
 * WHAT:  Tests for expoFeedDeviceLocation.getCurrentPosition — that the CACHED
 *        fix is preferred over a fresh one, and that a phone with no cache
 *        still gets a fresh fix behind the timeout cap.
 * WHY:   The order of those two reads was measured as 7.2 seconds of a ~9.5s
 *        cold start (2026-08-11) — the app awaited a fresh GPS fix before it
 *        would paint anything, gating a 0.45s feed query. Reversing it is the
 *        single biggest startup win available, and it is one line of ordering
 *        that a later "tidy-up" could silently undo, so it is pinned here.
 *        The permission guard is asserted too: reading a position without a
 *        granted permission is a SAFETY rule, not a preference.
 * LINKS: src/features/search-map/lib/feedDeviceLocation.ts;
 *        src/shared/lib/startupTrace.ts (how the 7.2s was found).
 */

import { expoFeedDeviceLocation } from './feedDeviceLocation';

// Declared after the import because jest hoists the jest.mock call above it
// anyway; `mock`-prefixed so babel's scope check allows the reference.
const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockGetLastKnownPositionAsync = jest.fn();

jest.mock(
  'expo-location',
  () => ({
    getForegroundPermissionsAsync: () => mockGetForegroundPermissionsAsync(),
    getCurrentPositionAsync: () => mockGetCurrentPositionAsync(),
    getLastKnownPositionAsync: () => mockGetLastKnownPositionAsync(),
    requestForegroundPermissionsAsync: jest.fn(),
    reverseGeocodeAsync: jest.fn(),
  }),
  { virtual: true },
);

const CACHED = { coords: { latitude: 53.4, longitude: -2.2 } };
const FRESH = { coords: { latitude: 51.5, longitude: -0.1 } };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

describe('getCurrentPosition', () => {
  it('returns the CACHED fix without ever awaiting a fresh one', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(CACHED);
    // A fresh fix that never resolves — exactly the indoors/cold-GPS case that
    // cost 7.2 seconds of startup when it was awaited first.
    mockGetCurrentPositionAsync.mockReturnValue(new Promise(() => {}));

    await expect(expoFeedDeviceLocation.getCurrentPosition()).resolves.toEqual({
      latitude: 53.4,
      longitude: -2.2,
    });
    // Not merely "resolved quickly" — the fresh read must not be on the path
    // at all, or a future timeout change silently reintroduces the block.
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back to a FRESH fix when the phone has no cached one', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(null);
    mockGetCurrentPositionAsync.mockResolvedValue(FRESH);

    await expect(expoFeedDeviceLocation.getCurrentPosition()).resolves.toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });
  });

  it('still tries a fresh fix when the CACHE READ itself fails', async () => {
    // A failing cache is not a reason to give up on locating the user.
    mockGetLastKnownPositionAsync.mockRejectedValue(new Error('cache unavailable'));
    mockGetCurrentPositionAsync.mockResolvedValue(FRESH);

    await expect(expoFeedDeviceLocation.getCurrentPosition()).resolves.toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });
  });

  it('NEVER reads a position without granted permission (SAFETY)', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(expoFeedDeviceLocation.getCurrentPosition()).resolves.toBeNull();
    expect(mockGetLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

/**
 * WHAT:  Tests the fallback chain for a new alert's map centre — the OS's
 *        CACHED fix, then the saved feed location, then nothing — plus the two
 *        rules that make it usable: never cold-prompt, and never wait on a
 *        fresh GPS fix.
 * WHY:   Both rules are INVISIBLE at runtime. Calling `getCurrentPosition`
 *        instead would still return the right coordinate in every test here;
 *        on a handset it took 3-10 SECONDS and blew the timeout every time, so
 *        the wizard silently opened on the whole-UK view — and it fires the OS
 *        permission dialog on the way. Hence the assertions that a function was
 *        NOT called, rather than only that the result was right.
 *
 *        The timeout is tested for the same reason the wizard shows a loader on
 *        this: a location call can hang with no error and no rejection, and the
 *        screen in front of it would spin for ever.
 * LINKS: ./useDefaultAlertCentre.ts; ../screens/AlertWizardScreen.tsx.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useDefaultAlertCentre } from './useDefaultAlertCentre';

const mockGetLastKnown = jest.fn();
const mockGetCurrentPosition = jest.fn();
jest.mock('@/shared/lib/location/expoLocationServices', () => ({
  getLastKnownPosition: (...args: unknown[]) => mockGetLastKnown(...args),
  // Present only so the test can assert it is NEVER used here.
  expoLocationServices: {
    getCurrentPosition: (...args: unknown[]) => mockGetCurrentPosition(...args),
  },
}));

const mockLoadFeedPref = jest.fn();
jest.mock('@/shared/lib/location/feedLocationStorage', () => ({
  loadFeedLocationPref: (...args: unknown[]) => mockLoadFeedPref(...args),
}));

const DEVICE = { latitude: 53.48, longitude: -2.24 };
const FEED_PREF = {
  latitude: 51.77,
  longitude: -0.34,
  addressLabel: 'Luton',
  radiusMiles: 20,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLastKnown.mockResolvedValue(null);
  mockGetCurrentPosition.mockResolvedValue(null);
  mockLoadFeedPref.mockResolvedValue(null);
});

describe('useDefaultAlertCentre', () => {
  it("uses the OS's cached fix when there is one", async () => {
    mockGetLastKnown.mockResolvedValue(DEVICE);

    const { result } = await renderHook(() => useDefaultAlertCentre());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.centre).toEqual(DEVICE);
    expect(mockLoadFeedPref).not.toHaveBeenCalled();
  });

  it('NEVER waits on a fresh GPS fix', async () => {
    // REGRESSION (2026-07-31): the first version called getCurrentPosition,
    // which requests a FRESH fix. On a real handset that took 3-10s — always
    // longer than the timeout below — so this hook resolved to null every time
    // and every alert opened on the whole-UK view. It also cold-fires the OS
    // permission dialog. Both reasons it must stay unused here.
    mockLoadFeedPref.mockResolvedValue(FEED_PREF);

    const { result } = await renderHook(() => useDefaultAlertCentre());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('falls back to the saved feed location when there is no cached fix', async () => {
    mockLoadFeedPref.mockResolvedValue(FEED_PREF);

    const { result } = await renderHook(() => useDefaultAlertCentre());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    // The point only — radius and label belong to the feed, and the two
    // settings stay independent.
    expect(result.current.centre).toEqual({ latitude: 51.77, longitude: -0.34 });
  });

  it('resolves to null when there is nothing to go on', async () => {
    const { result } = await renderHook(() => useDefaultAlertCentre());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.centre).toBeNull();
  });

  it('is ready immediately, and does nothing, when disabled', async () => {
    // Edit mode: the alert already has a point.
    const { result } = await renderHook(() => useDefaultAlertCentre(false));

    expect(result.current.status).toBe('ready');
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(mockLoadFeedPref).not.toHaveBeenCalled();
  });

  it('gives up rather than spinning for ever when the chain hangs', async () => {
    jest.useFakeTimers();
    // A promise that never settles — a wedged GPS fix, which neither resolves
    // nor rejects, so no amount of awaiting would ever end.
    mockGetLastKnown.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useDefaultAlertCentre());
    expect(result.current.status).toBe('resolving');

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.centre).toBeNull();
    jest.useRealTimers();
  });
});

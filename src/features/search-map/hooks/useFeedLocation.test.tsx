/**
 * WHAT:  Tests for useFeedLocation — the full fallback chain (saved pref →
 *        silently-permitted device fix → national + primer), the no-cold-
 *        prompt guarantee, setArea persistence, and the primer CTA.
 * WHY:   This chain decides the app's primary surface AND whether an OS
 *        permission dialog fires uninvited — both are spec guarantees.
 * LINKS: src/features/search-map/hooks/useFeedLocation.ts, docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { FEED_LOCATION_STORAGE_KEY } from '@/shared/lib/location/feedLocationStorage';

import type { FeedDeviceLocation } from '../lib/feedDeviceLocation';
import { useFeedLocation } from './useFeedLocation';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockStartupGrant = jest.fn((_kind: string) => false);
jest.mock('@/features/permissions', () => ({
  useStartupPermissionGrant: (kind: string) => mockStartupGrant(kind),
}));

const device = (overrides: Partial<FeedDeviceLocation> = {}): FeedDeviceLocation => ({
  hasPermission: jest.fn(async () => false),
  requestPermission: jest.fn(async () => false),
  getCurrentPosition: jest.fn(async () => null),
  reverseGeocodeArea: jest.fn(async () => null),
  ...overrides,
});

const SALFORD = { latitude: 53.49, longitude: -2.29 };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockStartupGrant.mockReturnValue(false);
});

describe('useFeedLocation chain', () => {
  it('uses the saved preference first and never touches the device', async () => {
    await AsyncStorage.setItem(
      FEED_LOCATION_STORAGE_KEY,
      JSON.stringify({ latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester', radiusMiles: 25 }),
    );
    const dev = device();

    const { result } = await renderHook(() => useFeedLocation(dev));

    await waitFor(() =>
      expect(result.current.location).toEqual({
        mode: 'local',
        latitude: 53.48,
        longitude: -2.24,
        addressLabel: 'Manchester',
        radiusMiles: 25,
        fromPreference: true,
      }),
    );
    expect(result.current.showLocationPrimer).toBe(false);
    expect(dev.hasPermission).not.toHaveBeenCalled();
    expect(dev.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('publishes the location BEFORE the area name resolves', async () => {
    // The area label is display text the feed query never uses, and awaiting it
    // put a network round trip on the critical path of first paint. Measured
    // 2026-08-11: the location phase still cost ~3.2s once the position itself
    // came from cache.
    let nameThePlace: (area: string | null) => void = () => {};
    const dev = device({
      hasPermission: jest.fn(async () => true),
      getCurrentPosition: jest.fn(async () => SALFORD),
      // A geocode that hangs until the test lets it finish.
      reverseGeocodeArea: jest.fn(
        () =>
          new Promise<string | null>((resolve) => {
            nameThePlace = resolve;
          }),
      ),
    });

    const { result } = await renderHook(() => useFeedLocation(dev));

    // Usable already: coordinates present, label still blank.
    await waitFor(() =>
      expect(result.current.location).toEqual(
        expect.objectContaining({ mode: 'local', addressLabel: '' }),
      ),
    );

    // ...and the name arrives afterwards, without disturbing the coordinates.
    await act(async () => {
      nameThePlace('Salford');
    });
    await waitFor(() =>
      expect(result.current.location).toEqual(
        expect.objectContaining({ addressLabel: 'Salford', latitude: SALFORD.latitude }),
      ),
    );
  });

  it('falls to the device fix when permission is already granted', async () => {
    const dev = device({
      hasPermission: jest.fn(async () => true),
      getCurrentPosition: jest.fn(async () => SALFORD),
      reverseGeocodeArea: jest.fn(async () => 'Salford'),
    });

    const { result } = await renderHook(() => useFeedLocation(dev));

    await waitFor(() =>
      expect(result.current.location).toEqual(
        expect.objectContaining({ mode: 'local', addressLabel: 'Salford', fromPreference: false }),
      ),
    );
    expect(result.current.showLocationPrimer).toBe(false);
  });

  it('ends national with the primer when permission was never granted — and does NOT prompt', async () => {
    const dev = device();

    const { result } = await renderHook(() => useFeedLocation(dev));

    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));
    expect(result.current.showLocationPrimer).toBe(true);
    // The no-cold-prompt guarantee: only hasPermission (silent) was consulted.
    expect(dev.requestPermission).not.toHaveBeenCalled();
    expect(dev.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('never pitches the primer when permission is already granted but the fix fails', async () => {
    // Permission granted, cold GPS: no coordinates, so the feed can only be
    // national — but there is nothing left to ask for, so no card.
    const dev = device({ hasPermission: jest.fn(async () => true) });

    const { result } = await renderHook(() => useFeedLocation(dev));

    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));
    expect(result.current.showLocationPrimer).toBe(false);
  });

  it('ends national when a corrupt preference is stored and the device has no permission', async () => {
    await AsyncStorage.setItem(FEED_LOCATION_STORAGE_KEY, '{not json');

    const { result } = await renderHook(() => useFeedLocation(device()));

    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));
  });

  it('upgrades from national when the startup prompts grant location', async () => {
    // Mount races the startup OS dialog: no permission yet → national.
    const dev = device();
    const { result, rerender } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));
    expect(result.current.showLocationPrimer).toBe(true);

    // The user taps Allow on the startup dialog seconds later.
    (dev.hasPermission as jest.Mock).mockResolvedValue(true);
    (dev.getCurrentPosition as jest.Mock).mockResolvedValue(SALFORD);
    (dev.reverseGeocodeArea as jest.Mock).mockResolvedValue('Salford');
    mockStartupGrant.mockReturnValue(true);
    await rerender(undefined);

    await waitFor(() =>
      expect(result.current.location).toEqual(
        expect.objectContaining({ mode: 'local', addressLabel: 'Salford', fromPreference: false }),
      ),
    );
    expect(result.current.showLocationPrimer).toBe(false);
  });

  it('a startup grant retires the primer even when no fix ever arrives', async () => {
    // THE REPORTED BUG: the user taps Allow on the startup dialog and the card
    // asking for that very permission stays on the feed, because the position
    // behind it never landed. The grant alone has to be enough.
    const dev = device();
    const { result, rerender } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.showLocationPrimer).toBe(true));

    (dev.hasPermission as jest.Mock).mockResolvedValue(true);
    // getCurrentPosition stays null: cold GPS, no last-known fix.
    mockStartupGrant.mockReturnValue(true);
    await rerender(undefined);

    await waitFor(() => expect(result.current.showLocationPrimer).toBe(false));
    // The feed itself is honestly still national — only the pitch is gone.
    expect(result.current.location).toEqual({ mode: 'national' });
  });

  it('a startup grant never overrides a saved area pick', async () => {
    await AsyncStorage.setItem(
      FEED_LOCATION_STORAGE_KEY,
      JSON.stringify({ latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester', radiusMiles: 25 }),
    );
    mockStartupGrant.mockReturnValue(true);
    const dev = device({ hasPermission: jest.fn(async () => true) });

    const { result } = await renderHook(() => useFeedLocation(dev));

    await waitFor(() =>
      expect(result.current.location).toEqual(
        expect.objectContaining({ mode: 'local', addressLabel: 'Manchester', fromPreference: true }),
      ),
    );
    expect(dev.getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('setArea', () => {
  it('switches the feed and persists the preference', async () => {
    const { result } = await renderHook(() => useFeedLocation(device()));
    await waitFor(() => expect(result.current.location).not.toBeNull());

    await act(async () => {
      await result.current.setArea({
        latitude: 53.41,
        longitude: -2.16,
        addressLabel: 'Stockport',
        radiusMiles: 10,
      });
    });

    expect(result.current.location).toEqual(
      expect.objectContaining({ mode: 'local', addressLabel: 'Stockport', radiusMiles: 10 }),
    );
    expect(result.current.showLocationPrimer).toBe(false);

    const stored = JSON.parse((await AsyncStorage.getItem(FEED_LOCATION_STORAGE_KEY)) ?? '');
    expect(stored.addressLabel).toBe('Stockport');
  });
});

describe('requestMyLocation (primer CTA)', () => {
  it('prompts, locates, and switches to local mode on grant', async () => {
    const dev = device({
      requestPermission: jest.fn(async () => true),
      getCurrentPosition: jest.fn(async () => SALFORD),
      reverseGeocodeArea: jest.fn(async () => 'Salford'),
    });
    const { result } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));

    let granted = false;
    await act(async () => {
      granted = await result.current.requestMyLocation();
    });

    expect(granted).toBe(true);
    expect(result.current.location).toEqual(
      expect.objectContaining({ mode: 'local', addressLabel: 'Salford' }),
    );
    expect(result.current.showLocationPrimer).toBe(false);
  });

  it('hides the card on grant even when the fix fails — the allow is answered', async () => {
    const dev = device({ requestPermission: jest.fn(async () => true) });
    const { result } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.showLocationPrimer).toBe(true));

    let granted = true;
    await act(async () => {
      granted = await result.current.requestMyLocation();
    });

    expect(granted).toBe(false); // no coordinates — the feed stays national
    expect(result.current.showLocationPrimer).toBe(false); // but the ask is over
  });

  it('stays national, keeps the card, and reports false on denial', async () => {
    const dev = device();
    const { result } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));

    let granted = true;
    await act(async () => {
      granted = await result.current.requestMyLocation();
    });

    expect(granted).toBe(false);
    expect(result.current.location).toEqual({ mode: 'national' });
    // Still something to pitch: a denial is not an answer we act on.
    expect(result.current.showLocationPrimer).toBe(true);
  });
});

/**
 * THE FIRST-RUN BUG (2026-08-21). On a first-ever grant the OS has no cached
 * position, so the immediate post-grant fix loses its race with cold GPS and
 * returns nothing — and it used to be a DEAD END: the single attempt discarded
 * its result, its effect could never re-run, and the AppState recovery was
 * armed only while the primer was visible, which the same grant had just
 * hidden. The feed stayed on "Recent posts across the UK" for the whole
 * session and only came right on the next launch, once the OS had a fix to
 * hand back instantly. Hence "only when the app is first started".
 */
describe('a granted permission with no fix yet', () => {
  it('keeps retrying until a fix lands, instead of stranding the feed national', async () => {
    jest.useFakeTimers();
    try {
      // Cold GPS: the first two reads come back empty, the third succeeds —
      // exactly the shape of a fix arriving a few seconds after the grant.
      const getCurrentPosition = jest
        .fn<Promise<typeof SALFORD | null>, []>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(SALFORD);
      const dev = device({
        hasPermission: jest.fn(async () => true),
        getCurrentPosition,
        reverseGeocodeArea: jest.fn(async () => 'Salford'),
      });

      const { result } = await renderHook(() => useFeedLocation(dev));

      // The mount chain fails its fix and settles national — as before.
      await waitFor(() => expect(result.current.location?.mode).toBe('national'));

      // Let the backoff run. Without the retry effect this loops forever on
      // national, which is the bug.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20_000);
      });

      await waitFor(() => expect(result.current.location?.mode).toBe('local'));
      expect(result.current.location).toEqual(
        expect.objectContaining({ mode: 'local', latitude: SALFORD.latitude }),
      );
      // It stopped once located rather than grinding on.
      expect(getCurrentPosition.mock.calls.length).toBeLessThanOrEqual(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up after a bounded number of attempts — a feed must not poll GPS forever', async () => {
    jest.useFakeTimers();
    try {
      const getCurrentPosition = jest.fn(async () => null);
      const dev = device({ hasPermission: jest.fn(async () => true), getCurrentPosition });

      const { result } = await renderHook(() => useFeedLocation(dev));
      await waitFor(() => expect(result.current.location?.mode).toBe('national'));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(120_000);
      });

      // Four attempts (one immediate + three backed off) and then it stops.
      // An unbounded loop would hold the GPS on for a user who is indoors.
      expect(getCurrentPosition.mock.calls.length).toBeLessThanOrEqual(5);
      expect(result.current.location?.mode).toBe('national');
    } finally {
      jest.useRealTimers();
    }
  });
});

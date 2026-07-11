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

import type { FeedDeviceLocation } from '../lib/feedDeviceLocation';
import { FEED_LOCATION_STORAGE_KEY } from '../lib/feedLocationStorage';
import { useFeedLocation } from './useFeedLocation';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const device = (overrides: Partial<FeedDeviceLocation> = {}): FeedDeviceLocation => ({
  hasPermission: jest.fn(async () => false),
  getCurrentPosition: jest.fn(async () => null),
  reverseGeocodeArea: jest.fn(async () => null),
  ...overrides,
});

const SALFORD = { latitude: 53.49, longitude: -2.29 };

beforeEach(async () => {
  await AsyncStorage.clear();
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
    expect(dev.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('ends national when a corrupt preference is stored and the device has no permission', async () => {
    await AsyncStorage.setItem(FEED_LOCATION_STORAGE_KEY, '{not json');

    const { result } = await renderHook(() => useFeedLocation(device()));

    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));
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
  });

  it('stays national and reports false on denial', async () => {
    const dev = device();
    const { result } = await renderHook(() => useFeedLocation(dev));
    await waitFor(() => expect(result.current.location).toEqual({ mode: 'national' }));

    let granted = true;
    await act(async () => {
      granted = await result.current.requestMyLocation();
    });

    expect(granted).toBe(false);
    expect(result.current.location).toEqual({ mode: 'national' });
  });
});

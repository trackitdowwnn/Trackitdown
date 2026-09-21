/**
 * WHAT:  Tests for how AreaInsightsScreen decides WHICH area it answers for:
 *        an explicit point (the feed's circle), a named town (geocoded here),
 *        or the device default — and that a town it cannot place is said
 *        plainly rather than quietly swapped for somewhere else.
 * WHY:   Every number on this screen is a count over other people's thefts,
 *        and per-section entry (2026-09-21) made the scope a route decision.
 *        The one failure that matters is a figure under the wrong title:
 *        "Thefts in St Albans" over the device's own area would look exactly
 *        like a working screen. Nothing else here can catch that.
 * LINKS: ./AreaInsightsScreen.tsx; ../../../app/area-insights.tsx (param
 *        parsing); ../lib/feedSections.ts (AREA_ENTRY_RADIUS_MILES).
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { milesToMetres } from '@/shared/lib/distance';

import { AREA_ENTRY_RADIUS_MILES } from '../lib/feedSections';
import { AreaInsightsScreen } from './AreaInsightsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
}));

let mockCentreState: { status: 'resolving' | 'ready'; centre: unknown } = {
  status: 'ready',
  centre: null,
};
jest.mock('@/shared/lib/location/useDefaultMapCentre', () => ({
  useDefaultMapCentre: () => mockCentreState,
}));

const mockForwardGeocode = jest.fn();
jest.mock('@/shared/lib/location/expoLocationServices', () => ({
  expoLocationServices: { forwardGeocode: (q: string) => mockForwardGeocode(q) },
}));

const mockFetch = jest.fn();
jest.mock('../api/areaInsightsApi', () => ({
  fetchAreaInsights: (...args: unknown[]) => mockFetch(...args),
}));

// The chart is native-heavy and not under test; the toast is asserted on.
jest.mock('@/features/vehicles', () => ({ StatsSparkline: () => null }));
const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return { ...actual, useToast: () => ({ show: mockToastShow }) };
});

const NOT_ENOUGH = { enoughData: false as const, radiusM: milesToMetres(5) };

beforeEach(() => {
  jest.clearAllMocks();
  mockCentreState = { status: 'ready', centre: null };
  mockFetch.mockResolvedValue(NOT_ENOUGH);
  mockForwardGeocode.mockResolvedValue([]);
});

describe('scope: the feed\'s own point', () => {
  it('fetches at the given point and radius, titled "Thefts near you"', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith(51.77, -0.34, milesToMetres(20));
    expect(view.getByRole('header', { name: 'Thefts near you' })).toBeTruthy();
    // Never geocodes, never consults the device centre.
    expect(mockForwardGeocode).not.toHaveBeenCalled();
  });

  it('a point wins over a name if both somehow arrive', async () => {
    await render(<AreaInsightsScreen area="St Albans" lat={51.77} lng={-0.34} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith(51.77, -0.34, expect.any(Number));
    expect(mockForwardGeocode).not.toHaveBeenCalled();
  });
});

describe('scope: a named area', () => {
  it('geocodes the town and fetches at the hit with the town-sized radius', async () => {
    mockForwardGeocode.mockResolvedValue([{ latitude: 51.75, longitude: -0.33 }]);
    const view = await render(<AreaInsightsScreen area="St Albans" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockForwardGeocode).toHaveBeenCalledWith('St Albans');
    expect(mockFetch).toHaveBeenCalledWith(51.75, -0.33, milesToMetres(AREA_ENTRY_RADIUS_MILES));
    expect(view.getByRole('header', { name: 'Thefts in St Albans' })).toBeTruthy();
  });

  it('⚠️ says it could not place the town rather than showing another area\'s figures', async () => {
    // The device knows where IT is; that is not where St Albans is.
    mockCentreState = { status: 'ready', centre: { latitude: 53.48, longitude: -2.24 } };
    mockForwardGeocode.mockResolvedValue([]);
    const view = await render(<AreaInsightsScreen area="St Albans" />);
    await waitFor(() => expect(view.getByText('We couldn’t place St Albans')).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
    // The header still names the place asked about — the page is honest
    // about what it was for, not just about what it lacks.
    expect(view.getByRole('header', { name: 'Thefts in St Albans' })).toBeTruthy();
    // And the way out DOES the alternative: the map resolves the name itself.
    fireEvent.press(view.getByText('Show on the map'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/search-map',
      params: { area: 'St Albans' },
    });
  });

  it('treats a geocode failure the same as a miss', async () => {
    mockForwardGeocode.mockRejectedValue(new Error('network'));
    const view = await render(<AreaInsightsScreen area="St Albans" />);
    await waitFor(() => expect(view.getByText('We couldn’t place St Albans')).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows the skeleton while the town is being placed', async () => {
    let resolve: (hits: unknown[]) => void = () => {};
    mockForwardGeocode.mockReturnValue(new Promise((r) => (resolve = r)));
    const view = await render(<AreaInsightsScreen area="St Albans" />);
    expect(view.queryByText(/couldn’t place/)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    await act(async () => {
      resolve([{ latitude: 51.75, longitude: -0.33 }]);
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });
});

describe('scope: nothing given (an old deep link)', () => {
  it('falls back to the device centre at the feed default radius', async () => {
    mockCentreState = { status: 'ready', centre: { latitude: 53.48, longitude: -2.24 } };
    const view = await render(<AreaInsightsScreen />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith(53.48, -2.24, milesToMetres(20));
    expect(view.getByRole('header', { name: 'Thefts near you' })).toBeTruthy();
    expect(mockForwardGeocode).not.toHaveBeenCalled();
  });

  it('asks for an area when the device has none', async () => {
    mockCentreState = { status: 'ready', centre: null };
    const view = await render(<AreaInsightsScreen />);
    expect(view.getByText('We need an area first')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

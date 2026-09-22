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
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { milesToMetres } from '@/shared/lib/distance';
import { spacing } from '@/shared/theme';

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

// The toast is asserted on. (The chart renders for real — plain Views under
// the shared Reanimated mock — and has its own suite.)
const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return { ...actual, useToast: () => ({ show: mockToastShow }) };
});

const NOT_ENOUGH = { enoughData: false as const, radiusM: milesToMetres(5) };

/** The radius the slider is showing — its adjustable track's a11y value. */
const radiusOf = (view: Awaited<ReturnType<typeof render>>): number =>
  (view.getByTestId('stats-radius-slider-track').props.accessibilityValue as { now: number }).now;

/** A full answer, for the layout tests. Round numbers so the assertions read. */
const FULL = {
  enoughData: true as const,
  radiusM: milesToMetres(20),
  total: 180,
  total7d: 3,
  total30d: 14,
  total90d: 41,
  total365d: 180,
  monthly: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, count: i })),
  topMakes: [
    { make: 'ford', count: 6 },
    { make: 'bmw', count: 4 },
  ],
  topModels: [{ make: 'ford', model: 'fiesta', count: 3 }],
  recovered: 7,
  closedTotal: 10,
  takenFrom: {
    buckets: [
      { key: 'driveway', label: 'From a driveway', count: 3 },
      { key: 'street', label: 'From the street', count: 2 },
    ],
    recorded: 6,
  },
  keysTaken: { buckets: [], recorded: 0 },
};

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

describe('scope: the feed\'s area, by name', () => {
  it('titles itself "Thefts near <label>" when the feed sent its area name', async () => {
    const view = await render(
      <AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} label="St Albans" />,
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(view.getByRole('header', { name: 'Thefts near St Albans' })).toBeTruthy();
    // The label is display only: the fetch still uses the point it was given.
    expect(mockFetch).toHaveBeenCalledWith(51.77, -0.34, milesToMetres(20));
    expect(mockForwardGeocode).not.toHaveBeenCalled();
  });
});

describe('the layout (2026-09-21 redesign; card sections 2026-09-22)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(FULL);
  });

  it('is a column of cards — hero first, then one per question, none for an absent block', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-card-hero')).toBeTruthy());
    // The hero card holds the sentence AND the band: one object, not a
    // paragraph with three stray numbers under it.
    const hero = view.getByTestId('stats-card-hero');
    expect(hero).toHaveTextContent(/14 cars reported stolen/);
    expect(hero).toHaveTextContent(/last 7 days/);
    for (const key of ['year', 'makes', 'recovery', 'taken']) {
      expect(view.getByTestId(`stats-card-${key}`)).toBeTruthy();
    }
    // Each card is titled, so a screen reader can walk the page by heading.
    expect(view.getByRole('header', { name: 'Over the last year' })).toBeTruthy();
    expect(view.getByRole('header', { name: 'Taken most often' })).toBeTruthy();
    // No empty shell for a block with nothing in it.
    expect(view.queryByTestId('stats-card-keys')).toBeNull();
  });

  it('pads the scroll content past the bottom safe-area inset, so the last card clears the Android bar', async () => {
    // A 48pt bottom inset — Android's three-button bar, which is the case
    // that shipped with content underneath it. The mock's default is 0,
    // under which 32 + 0 would prove nothing.
    const view = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 800 },
          insets: { top: 24, bottom: 48, left: 0, right: 0 },
        }}
      >
        <AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(view.getByTestId('stats-card-hero')).toBeTruthy());
    // The tail is the page's own 32 PLUS the inset — not either alone.
    const content = StyleSheet.flatten(
      view.getByTestId('stats-scroll').props.contentContainerStyle,
    ) as { paddingBottom: number };
    expect(content.paddingBottom).toBe(spacing.xxl + 48);
  });

  it('leads with ONE hero sentence — the 30-day count — not a row of tiles', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(view.getByTestId('stats-hero')).toHaveTextContent(
      '14 cars reported stolen in the last 30 days',
    );
    // The other windows sit in the quiet band beneath, value over label.
    expect(view.getByTestId('stat-7d')).toHaveTextContent(/^3/);
    expect(view.getByTestId('stat-90d')).toHaveTextContent(/^41/);
    expect(view.getByTestId('stat-365d')).toHaveTextContent(/^180/);
  });

  it('singular when it is one car', async () => {
    mockFetch.mockResolvedValue({ ...FULL, total30d: 1 });
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(view.getByTestId('stats-hero')).toHaveTextContent(
      '1 car reported stolen in the last 30 days',
    );
  });

  it('keeps the hero to ONE line, shrinking rather than wrapping', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    const hero = view.getByTestId('stats-hero');
    expect(hero.props.numberOfLines).toBe(1);
    expect(hero.props.adjustsFontSizeToFit).toBe(true);
  });

  it('shows the radius slider always, at the given radius, with no disclosure line', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    // Visible without a tap (owner decision 2026-09-22 — it used to hide
    // behind a "within 20 miles · Change" line).
    expect(view.getByTestId('stats-radius-slider')).toBeTruthy();
    expect(radiusOf(view)).toBe(20);
    expect(view.queryByText(/within 20 miles/)).toBeNull();
    expect(view.queryByText('Change')).toBeNull();
    // Labelled "Radius" — it used to read "Alert radius", a leak from the
    // alerts feature.
    expect(view.queryByText('Alert radius')).toBeNull();
    expect(view.getByText('Radius')).toBeTruthy();
  });

  it('opens a named area at the town-sized radius', async () => {
    mockForwardGeocode.mockResolvedValue([{ latitude: 51.75, longitude: -0.33 }]);
    const view = await render(<AreaInsightsScreen area="St Albans" />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(radiusOf(view)).toBe(AREA_ENTRY_RADIUS_MILES);
  });

  it('values lead their labels in the breakdown rows, with the denominator said once', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(view.getByText('From a driveway')).toBeTruthy();
    expect(view.getByText('3 of 6')).toBeTruthy();
    expect(view.getByText(/Of the 6 listings where this was recorded/)).toBeTruthy();
    // The keys block has no buckets, so it is absent entirely — no empty shell.
    expect(view.queryByText('Were the keys taken?')).toBeNull();
    // The recovery card: percent leading, the share drawn, both counts in
    // the band, all one spoken node with the denominator in it.
    expect(view.getByText(/70%/)).toBeTruthy();
    // Decoration to a screen reader, so it must be asked for as hidden.
    expect(view.getByTestId('stats-recovery-bar', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByTestId('stat-recovered')).toHaveTextContent(/^7/);
    expect(view.getByTestId('stat-not-recovered')).toHaveTextContent(/^3/);
    expect(view.getByRole('header', { name: 'Recovery rate' })).toBeTruthy();
    expect(view.queryByText('Do they come back?')).toBeNull();
    expect(
      view.getByLabelText('70% recovered: 7 of the 10 nearby listings that have finished.'),
    ).toBeTruthy();
  });

  it('shows the radius control open when there is not enough data — it is the way out', async () => {
    mockFetch.mockResolvedValue(NOT_ENOUGH);
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByText('Not enough nearby to say')).toBeTruthy());
    expect(view.getByTestId('stats-radius-slider')).toBeTruthy();
    // One card holds both the reason and the way out.
    expect(view.getByTestId('stats-card-empty')).toHaveTextContent(/Not enough nearby to say/);
    expect(view.queryByTestId('stats-card-hero')).toBeNull();
    expect(radiusOf(view)).toBe(20);
  });

  it('says the "it\'s optional" aside once, not under every block', async () => {
    mockFetch.mockResolvedValue({
      ...FULL,
      keysTaken: {
        buckets: [{ key: 'yes', label: 'Keys were taken', count: 2 }],
        recorded: 4,
      },
    });
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(view.getByText(/Of the 6 listings where this was recorded/)).toBeTruthy();
    expect(view.getByText(/Of the 4 listings where this was recorded/)).toBeTruthy();
    expect(view.getAllByText(/It’s optional, so most listings leave it blank/)).toHaveLength(1);
  });

  it('reads "No cars" rather than "0 cars" for a quiet month', async () => {
    mockFetch.mockResolvedValue({ ...FULL, total30d: 0 });
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    expect(view.getByTestId('stats-hero')).toHaveTextContent(
      'No cars reported stolen in the last 30 days',
    );
  });
});

describe('moving the radius (2026-09-22 — the slider used to vanish mid-drag)', () => {
  // RadiusSlider commits on every snap of a drag; its accessibility actions
  // are the same code path (MoneySlider's tests drive it the same way).
  const nudge = (view: Awaited<ReturnType<typeof render>>, action: 'increment' | 'decrement') =>
    fireEvent(view.getByTestId('stats-radius-slider-track'), 'accessibilityAction', {
      nativeEvent: { actionName: action },
    });

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValue(FULL);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the figures AND the slider on screen, dimmed, instead of the skeleton', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    const sliderBefore = view.getByTestId('stats-radius-slider');
    await act(async () => {
      nudge(view, 'increment');
    });
    // The whole point: nothing was swapped for a skeleton. Same slider
    // instance, figures still there, the line already saying where the
    // thumb is and what is on its way.
    // (Above 20 the slider steps by 10, so one nudge is 20 → 30.)
    expect(view.queryByTestId('area-insights-skeleton')).toBeNull();
    expect(view.getByTestId('stats-radius-slider')).toBe(sliderBefore);
    expect(view.getByTestId('stats-hero')).toHaveTextContent(/14 cars reported stolen/);
    expect(radiusOf(view)).toBe(30);
    // And nothing has been asked of the network yet — the finger may still
    // be moving.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-enters the figures when the new answer lands, without remounting the slider', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    const sliderBefore = view.getByTestId('stats-radius-slider');
    const heroBefore = view.getByTestId('stats-hero');
    const yearBefore = view.getByTestId('stats-card-year');
    mockFetch.mockResolvedValue({ ...FULL, total30d: 31 });
    await act(async () => {
      nudge(view, 'increment');
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(view.getByTestId('stats-hero')).toHaveTextContent(/31 cars/));
    // The figures are NEW instances (keyed on the answered radius, so their
    // entrance replays — the stagger, the chart's rise); the slider is the
    // same one. That split is the whole design: replay the motion on the
    // figures, never on the control. `getBy` (not `getAllBy`) is load-bearing:
    // the first cut keyed the hero and the band on the same bare number,
    // and React left the OLD sentence mounted beside the new one.
    expect(view.getByTestId('stats-hero')).not.toBe(heroBefore);
    expect(view.getAllByTestId('stat-7d')).toHaveLength(1);
    expect(view.getByTestId('stats-card-year')).not.toBe(yearBefore);
    expect(view.getByTestId('stats-radius-slider')).toBe(sliderBefore);
  });

  it('asks the network ONCE per settled drag, not once per snap', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    // Three snaps inside the settle window: 20 → 30 → 40 → 50. One act per
    // snap so the slider re-renders with its new value between them, as it
    // does on device.
    for (let snap = 0; snap < 3; snap += 1) {
      await act(async () => {
        nudge(view, 'increment');
      });
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
    }
    expect(radiusOf(view)).toBe(50);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    // One request, for where the thumb stopped.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(51.77, -0.34, milesToMetres(50));
    // When it lands the slider is still on the new value.
    await act(async () => {});
    expect(radiusOf(view)).toBe(50);
  });

  it('⚠️ keeps the figures and the slider when the NEW radius fails, and says so', async () => {
    // The error page is for a first load only. Keyed on the failing radius it
    // replaced still-true figures with an error and unmounted the slider —
    // leaving no way back but a pull that retries the failing radius.
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    mockFetch.mockRejectedValue(new Error('offline'));
    // The nudge and the settle are separate acts so the debounce effect
    // commits with the new radius before its timer runs — the settled-drag
    // test above drives it the same way.
    await act(async () => {
      nudge(view, 'increment');
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(view.queryByText('We couldn’t load this area')).toBeNull();
    expect(view.getByTestId('stats-hero')).toHaveTextContent(/14 cars/);
    expect(view.getByTestId('stats-radius-slider')).toBeTruthy();
    // The message NAMES the radius the figures still answer for — without it
    // the reader is looking at 20-mile counts under a slider reading 30.
    expect(mockToastShow).toHaveBeenCalledWith(
      'We couldn’t load that radius — these are still the 20 mile figures.',
      'error',
    );
    // And the reader can still drag back: the control never left.
    expect(radiusOf(view)).toBe(30);
  });

  it('still shows the error page when the FIRST load fails — there is nothing to keep', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByText('We couldn’t load this area')).toBeTruthy());
    expect(view.queryByTestId('stats-hero')).toBeNull();
    // Nothing to apologise for either — there were no figures to keep.
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it('⚠️ does not apologise for a refresh nobody asked for after a cancelled pull', async () => {
    // Pull, then move the slider before the response lands: the pull's request
    // is cancelled with its flag still set, and the next unrelated failure
    // used to claim the reader had asked for a refresh.
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    let settle: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    await act(async () => {
      fireEvent(view.getByTestId('stats-scroll'), 'refresh');
    });
    // The pull is in flight; move the slider, which cancels it.
    mockFetch.mockRejectedValue(new Error('offline'));
    await act(async () => {
      nudge(view, 'increment');
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      settle(FULL);
    });
    // The radius failure is its own message, not the pull's.
    expect(mockToastShow).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith(
      'We couldn’t load that radius — these are still the 20 mile figures.',
      'error',
    );
  });

  it('dragging from enough into not-enough keeps the same slider instance', async () => {
    const view = await render(<AreaInsightsScreen lat={51.77} lng={-0.34} radiusMiles={20} />);
    await waitFor(() => expect(view.getByTestId('stats-hero')).toBeTruthy());
    const sliderBefore = view.getByTestId('stats-radius-slider');
    mockFetch.mockResolvedValue(NOT_ENOUGH);
    await act(async () => {
      nudge(view, 'decrement');
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(view.getByText('Not enough nearby to say')).toBeTruthy());
    // The answer changed shape — hero card to not-enough card — and the
    // slider survived it, still the way out.
    expect(view.getByTestId('stats-radius-slider')).toBe(sliderBefore);
    expect(view.queryByTestId('stats-card-hero')).toBeNull();
    expect(view.getByTestId('stats-card-empty')).toBeTruthy();
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

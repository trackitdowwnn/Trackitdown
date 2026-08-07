/**
 * WHAT:  Tests useAlertReach — the debounce, and the rule that "nothing to
 *        report" surfaces as NULL rather than as the number 0.
 * WHY:   The null rule is a product decision with a person behind it. The RPC
 *        returns 0 both for "nobody" and for "fewer than the reportable floor",
 *        and an owner hours from having their car stolen must never read
 *        "0 spotters are watching this area" — it is demoralising, gives them
 *        nothing to act on, and states publicly where nobody is looking. If
 *        this ever leaks a 0 to the render site, that sentence ships.
 *        The debounce is the other half: this fires from a slider being
 *        dragged, and one request per snap crossing would be dozens per drag.
 * LINKS: src/features/notifications/hooks/useAlertReach.ts;
 *        supabase/migrations/20260807120000_alert_reach_count.sql (the floor).
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { fetchAlertReach } from '../api/alertsApi';
import { useAlertReach } from './useAlertReach';

jest.mock('../api/alertsApi', () => ({ fetchAlertReach: jest.fn() }));

const mockFetch = fetchAlertReach as jest.MockedFunction<typeof fetchAlertReach>;

/** Matches DEBOUNCE_MS in the hook. */
const DEBOUNCE_MS = 300;

const LAT = 53.4808;
const LNG = -2.2426;

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(0);
});

afterEach(() => {
  jest.useRealTimers();
});

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS);
  });
};

describe('useAlertReach', () => {
  it('reports a reach above the floor', async () => {
    mockFetch.mockResolvedValue(34);
    const { result } = await act(async () =>
      renderHook(() => useAlertReach(LAT, LNG, 25000)),
    );

    await settle();

    await waitFor(() => expect(result.current).toBe(34));
  });

  // THE RULE. 0 from the RPC means "nobody" OR "too few to report" — both are
  // "say nothing", never "0 spotters are watching this area".
  it('turns 0 into null so the caller renders NOTHING', async () => {
    mockFetch.mockResolvedValue(0);
    const { result } = await act(async () =>
      renderHook(() => useAlertReach(LAT, LNG, 25000)),
    );

    await settle();

    expect(result.current).toBeNull();
  });

  it('does not call the RPC before the debounce elapses', async () => {
    await act(async () => renderHook(() => useAlertReach(LAT, LNG, 25000)));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // A slider emits on every snap crossing; without this a single drag is
  // dozens of round trips.
  it('collapses a drag into ONE call at the final amount', async () => {
    mockFetch.mockResolvedValue(12);
    const { rerender } = await act(async () =>
      renderHook(({ pence }: { pence: number }) => useAlertReach(LAT, LNG, pence), {
        initialProps: { pence: 5000 },
      }),
    );

    await act(async () => {
      rerender({ pence: 10000 });
    });
    await act(async () => {
      rerender({ pence: 25000 });
    });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(LAT, LNG, 25000);
  });

  // The bounty step can render before the location step has resolved.
  it('asks nothing while the location is unknown', async () => {
    const { result } = await act(async () =>
      renderHook(() => useAlertReach(null, null, 25000)),
    );

    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('does not set state after unmount', async () => {
    let resolve: (n: number) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = await act(async () => renderHook(() => useAlertReach(LAT, LNG, 25000)));
    await settle();

    await act(async () => {
      view.unmount();
      resolve(40);
    });

    // No "state update on an unmounted component" warning; nothing to assert
    // beyond the absence of a throw, which act() surfaces.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

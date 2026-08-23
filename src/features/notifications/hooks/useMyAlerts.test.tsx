/**
 * WHAT:  Tests for useMyAlerts' two refresh paths — the global `refresh`
 *        (invalidation, shared by every mounted instance) and `pull` (local,
 *        driven by the RefreshControl on AlertsScreen).
 * WHY:   They must fail DIFFERENTLY, and that is the whole point of there
 *        being two. A failed invalidation records an error and the screen
 *        shows an error page; a failed pull must keep the list, because a pull
 *        is a request for newer facts and never a reason to throw away the
 *        ones already on screen. Routed through invalidation — which is how it
 *        shipped on 2026-08-22 — one tug on a train replaced every alert
 *        someone had with "We couldn't load your alerts".
 *
 *        `refreshing` is pinned here too: it must be true ONLY for a pull, and
 *        never for the invalidations that a toggle or a delete fire.
 * LINKS: ./useMyAlerts.ts; ../screens/AlertsScreen.tsx (the consumer).
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { invalidateMyAlerts, useMyAlerts } from './useMyAlerts';

const mockFetch = jest.fn();
jest.mock('../api/alertsApi', () => ({ fetchMyAlerts: () => mockFetch() }));

const mockUseSession = jest.fn();
jest.mock('@/features/auth/hooks/useSession', () => ({ useSession: () => mockUseSession() }));

const ALERT = { id: 'a1', name: 'Home', enabled: true };
const SECOND = { id: 'a2', name: 'Work', enabled: true };

beforeEach(() => {
  mockFetch.mockReset();
  mockUseSession.mockReset();
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
});

/** The alerts, insisting the state is `ready` first — so a test that loses the
 *  list fails saying WHICH state it fell into, not "undefined". */
function alertsOn(state: ReturnType<typeof useMyAlerts>) {
  if (state.status !== 'ready') {
    throw new Error(`expected status 'ready', got '${state.status}'`);
  }
  return state.alerts;
}

/** Mount and wait for the first load to settle with alerts on screen. */
async function readyWithAlerts() {
  mockFetch.mockResolvedValue([ALERT]);
  const { result } = await renderHook(() => useMyAlerts());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  return result;
}

describe('pull', () => {
  it('⚠️ KEEPS THE LIST when it fails', async () => {
    // The regression this hook was reshaped for. One bar of signal, tug the
    // list, and every alert you had is replaced by an error page.
    const result = await readyWithAlerts();

    mockFetch.mockRejectedValue(new Error('offline'));
    await act(async () => result.current.pull());

    expect(result.current.status).toBe('ready');
    expect(alertsOn(result.current)).toEqual([ALERT]);
    expect(result.current.refreshing).toBe(false);
  });

  it('shows newer alerts when it succeeds', async () => {
    const result = await readyWithAlerts();

    mockFetch.mockResolvedValue([ALERT, SECOND]);
    await act(async () => result.current.pull());

    expect(alertsOn(result.current)).toEqual([ALERT, SECOND]);
    expect(result.current.refreshing).toBe(false);
  });

  it('drives the spinner while it runs', async () => {
    const result = await readyWithAlerts();

    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.pull();
    });

    expect(result.current.refreshing).toBe(true);
    // Stale-while-revalidate: the old list stays up behind the spinner.
    expect(alertsOn(result.current)).toEqual([ALERT]);

    await act(async () => {
      release([SECOND]);
      await pending;
    });
    expect(result.current.refreshing).toBe(false);
  });
});

describe('refreshing', () => {
  it('stays false for an invalidation nobody pulled', async () => {
    // ⚠️ toggle() and confirmDelete() on AlertsScreen both call
    // invalidateMyAlerts. Derived from the key comparison, `refreshing` fired
    // for those too, so flipping an alert switch animated the pull spinner.
    const result = await readyWithAlerts();

    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await act(async () => {
      invalidateMyAlerts();
    });

    expect(result.current.refreshing).toBe(false);

    await act(async () => release([ALERT]));
  });

  it('stays false during the FIRST load, which shows a skeleton instead', async () => {
    // A pull spinner over a skeleton is two loading indicators for one fetch.
    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const { result } = await renderHook(() => useMyAlerts());

    expect(result.current.status).toBe('loading');
    expect(result.current.refreshing).toBe(false);

    await act(async () => release([ALERT]));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.refreshing).toBe(false);
  });

  it('is false in the error state, so the spinner cannot spin forever', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useMyAlerts());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.refreshing).toBe(false);
  });

  it('is false when signed out', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    const { result } = await renderHook(() => useMyAlerts());

    expect(result.current.status).toBe('signedOut');
    expect(result.current.refreshing).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

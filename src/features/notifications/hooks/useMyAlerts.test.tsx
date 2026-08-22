/**
 * WHAT:  Tests for useMyAlerts' `refreshing` flag — the one the pull-to-refresh
 *        spinner on AlertsScreen is driven by.
 * WHY:   It is DERIVED from the same key comparison the state machine uses,
 *        rather than tracked separately, so the two can never disagree. The
 *        subtle part is that it must stay FALSE on a first load: that renders a
 *        skeleton, and a pull spinner on top of a skeleton is two indicators
 *        for one fetch. Only a refetch over data already on screen counts.
 * LINKS: ./useMyAlerts.ts; ../screens/AlertsScreen.tsx (the consumer).
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { invalidateMyAlerts, useMyAlerts } from './useMyAlerts';

const mockFetch = jest.fn();
jest.mock('../api/alertsApi', () => ({ fetchMyAlerts: () => mockFetch() }));

const mockUseSession = jest.fn();
jest.mock('@/features/auth/hooks/useSession', () => ({ useSession: () => mockUseSession() }));

const ALERT = { id: 'a1', name: 'Home', enabled: true };

beforeEach(() => {
  mockFetch.mockReset();
  mockUseSession.mockReset();
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
});

describe('useMyAlerts refreshing', () => {
  it('is false during the FIRST load, which shows a skeleton instead', async () => {
    // ⚠️ The whole reason it is gated on having data. Reporting true here would
    // put a pull spinner over the loading screen.
    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const { result } = await renderHook(() => useMyAlerts());

    expect(result.current.status).toBe('loading');
    expect(result.current.refreshing).toBe(false);

    await act(async () => release([ALERT]));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.refreshing).toBe(false);
  });

  it('is true while a refetch runs over alerts already on screen', async () => {
    mockFetch.mockResolvedValue([ALERT]);
    const { result } = await renderHook(() => useMyAlerts());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await act(async () => {
      invalidateMyAlerts();
    });

    // Stale-while-revalidate: still 'ready' with the old list, and now the
    // spinner says why the numbers have not moved yet.
    expect(result.current.status).toBe('ready');
    expect(result.current.refreshing).toBe(true);

    await act(async () => release([ALERT, { ...ALERT, id: 'a2', name: 'Work' }]));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.status).toBe('ready');
  });

  it('is false in the error state, so the spinner cannot spin forever', async () => {
    // ErrorState owns the retry there. A RefreshControl stuck at true over an
    // error page is the classic never-ending pull.
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

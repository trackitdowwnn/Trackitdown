/**
 * WHAT:  Tests for useNotificationPreferences — the read, and the rollback.
 * WHY:   The rollback is the whole reason this hook exists rather than a
 *        useState in the screen. A switch left where the user tapped it after a
 *        write that never landed is the app telling them something untrue about
 *        what will reach their phone — and they find out either when a muted
 *        notification arrives, or when one they wanted does not.
 * LINKS: ./useNotificationPreferences.ts; ../api/notificationPreferencesApi.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useNotificationPreferences } from './useNotificationPreferences';

const mockFetch = jest.fn();
const mockSet = jest.fn();
jest.mock('../api/notificationPreferencesApi', () => ({
  fetchNotificationPreferences: () => mockFetch(),
  setNotificationPreference: (...args: unknown[]) => mockSet(...args),
}));

const ALL_ON = {
  alerts: true,
  messages: true,
  my_sightings: true,
  money: true,
  watched: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ ...ALL_ON });
  mockSet.mockResolvedValue(undefined);
});

describe('useNotificationPreferences', () => {
  it('starts at everything-on rather than empty', async () => {
    // Not a guess: all-on is what a user with no stored row actually has, in
    // SQL as well as here. Rendering nothing until the read lands would flash
    // an empty group into a screen whose entire content is these switches.
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useNotificationPreferences('user-1'));

    expect(result.current.preferences).toEqual(ALL_ON);
    expect(result.current.loading).toBe(true);
  });

  it('takes the stored preferences once they arrive', async () => {
    mockFetch.mockResolvedValue({ ...ALL_ON, messages: false });

    const { result } = await renderHook(() => useNotificationPreferences('user-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preferences.messages).toBe(false);
  });

  it('flips optimistically, before the write resolves', async () => {
    let resolve: () => void = () => {};
    mockSet.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { result } = await renderHook(() => useNotificationPreferences('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Started inside an ASYNC act and deliberately not awaited here — that
    // flushes the optimistic setState while the write is still in flight. A
    // sync `act()` around an async call leaves the update unflushed and, worse,
    // poisons the renders in every test after it.
    let pending: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      pending = result.current.setEnabled('alerts', false);
    });

    // Already off, with the round trip still open — a switch that waits for the
    // server feels broken.
    expect(result.current.preferences.alerts).toBe(false);

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.preferences.alerts).toBe(false);
  });

  it('⚠️ puts the switch back when the write fails, and says it failed', async () => {
    // The guard the whole hook exists for.
    mockSet.mockRejectedValue(new Error('offline'));

    const { result } = await renderHook(() => useNotificationPreferences('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.setEnabled('money', false);
    });

    expect(ok).toBe(false);
    expect(result.current.preferences.money).toBe(true);
  });

  it('⚠️ a slow first read does not undo a write the user already made', async () => {
    // The race review caught. On a slow network: open Settings, tap Messages
    // off, the write succeeds — and then the read issued at MOUNT arrives
    // carrying the old value and flips the switch back on while the server has
    // it off. The screen would be lying about what reaches the phone.
    let land: (value: typeof ALL_ON) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((r) => {
        land = r;
      }),
    );

    const { result } = await renderHook(() => useNotificationPreferences('user-1'));

    await act(async () => {
      await result.current.setEnabled('messages', false);
    });
    expect(result.current.preferences.messages).toBe(false);

    // The stale read lands last, still saying everything is on.
    await act(async () => {
      land({ ...ALL_ON });
    });

    expect(result.current.preferences.messages).toBe(false);
    // …and it is still allowed to fill in everything the user did NOT touch.
    expect(result.current.preferences.alerts).toBe(true);
  });

  it('leaves the other categories alone', async () => {
    const { result } = await renderHook(() => useNotificationPreferences('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled('watched', false);
    });

    expect(result.current.preferences).toEqual({ ...ALL_ON, watched: false });
  });
});

describe('⚠️ an account change on the same handset', () => {
  it('does not carry one user’s choices into another’s switches', async () => {
    // Keyed on a bare `enabled` flag this state survived a sign-out: the
    // `touched` merge would write the PREVIOUS person's choices over the new
    // user's stored ones — disclosing what the last person muted, and leaving
    // the switches lying about what reaches this phone. SECURITY_AND_TRUST
    // treats the shared and resold handset as a real case; this is it.
    mockFetch.mockResolvedValue({ ...ALL_ON });

    const { result, rerender } = await renderHook(
      ({ userId }: { userId: string | null }) => useNotificationPreferences(userId),
      { initialProps: { userId: 'user-1' as string | null } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled('money', false);
    });
    expect(result.current.preferences.money).toBe(false);

    // Sign out, then in as somebody else on the same phone.
    await act(async () => rerender({ userId: null }));
    await act(async () => rerender({ userId: 'user-2' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.preferences.money).toBe(true);
  });

  it('reads nothing at all for a guest', async () => {
    const { result } = await renderHook(() => useNotificationPreferences(null));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.preferences).toEqual(ALL_ON);
  });
});

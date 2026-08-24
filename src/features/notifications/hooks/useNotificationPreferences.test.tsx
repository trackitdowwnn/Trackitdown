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

    const { result } = await renderHook(() => useNotificationPreferences());

    expect(result.current.preferences).toEqual(ALL_ON);
    expect(result.current.loading).toBe(true);
  });

  it('takes the stored preferences once they arrive', async () => {
    mockFetch.mockResolvedValue({ ...ALL_ON, messages: false });

    const { result } = await renderHook(() => useNotificationPreferences());

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

    const { result } = await renderHook(() => useNotificationPreferences());
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

    const { result } = await renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.setEnabled('money', false);
    });

    expect(ok).toBe(false);
    expect(result.current.preferences.money).toBe(true);
  });

  it('leaves the other categories alone', async () => {
    const { result } = await renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled('watched', false);
    });

    expect(result.current.preferences).toEqual({ ...ALL_ON, watched: false });
  });
});

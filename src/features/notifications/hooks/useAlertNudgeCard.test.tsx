/**
 * WHAT:  Tests for useAlertNudgeCard — who sees the Explore nudge, and that it
 *        never comes back once answered.
 * WHY:   A nudge's failure modes are all social: showing it to a guest who
 *        can't act on it, showing it to someone who already set an area, or —
 *        worst — re-asking someone who said no. The inverted fail-soft rule in
 *        its storage exists for that last one and is easy to "fix" backwards,
 *        so it is asserted here explicitly.
 * LINKS: ./useAlertNudgeCard.ts, ../lib/alertNudgeStorage.ts; docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ALERT_NUDGE_STORAGE_KEY } from '../lib/alertNudgeStorage';
import { useAlertNudgeCard } from './useAlertNudgeCard';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockAlertsState: unknown = { status: 'ready', alerts: [], refresh: jest.fn() };
jest.mock('./useMyAlerts', () => ({
  useMyAlerts: () => mockAlertsState,
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAlertsState = { status: 'ready', alerts: [], refresh: jest.fn() };
});

describe('useAlertNudgeCard', () => {
  it('offers alerts to a member who has never set one up', async () => {
    const { result } = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(result.current.visible).toBe(true));
  });

  it('stays hidden for a guest', async () => {
    mockAlertsState = { status: 'signedOut', refresh: jest.fn() };
    const { result } = await renderHook(() => useAlertNudgeCard());
    // Give the storage read time to land, then confirm it is still hidden.
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('stays hidden once the user has at least one alert', async () => {
    mockAlertsState = {
      status: 'ready',
      alerts: [{ id: 'a1', name: 'Home', enabled: true }],
      refresh: jest.fn(),
    };
    const { result } = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('stays hidden while the flag is still being read', async () => {
    // A card that appears and vanishes a frame later is worse than one that
    // appears a beat late. Hold the read open so the pending state is actually
    // observable — an awaited render would otherwise resolve it first.
    (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    const { result } = await renderHook(() => useAlertNudgeCard());
    expect(result.current.visible).toBe(false);
  });

  it('never comes back once accepted', async () => {
    const { result } = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(result.current.visible).toBe(true));

    result.current.accept();
    await waitFor(() => expect(result.current.visible).toBe(false));
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(ALERT_NUDGE_STORAGE_KEY, 'true'),
    );

    const second = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(second.result.current.visible).toBe(false);
  });

  it('never comes back once dismissed', async () => {
    const { result } = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(result.current.visible).toBe(true));

    result.current.dismiss();
    await waitFor(() => expect(result.current.visible).toBe(false));

    const second = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(second.result.current.visible).toBe(false);
  });

  it('stays hidden, and logs no impression, when another nudge owns the slot', async () => {
    // This card is LAST in the feed's priority order, so it is suppressed on
    // most feeds where it is otherwise eligible. If `active` gated only the
    // render and not `visible`, every one of those would still log an
    // impression — understating the accept rate the alert feature is measured
    // by. Assert the two together: visible IS the impression signal.
    const { result, rerender } = await renderHook(
      ({ active }: { active: boolean }) => useAlertNudgeCard({ active }),
      { initialProps: { active: false } },
    );
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);

    // ...and appears the moment the slot frees up, without a remount.
    await act(async () => rerender({ active: true }));
    await waitFor(() => expect(result.current.visible).toBe(true));
  });

  it('suppresses itself when storage is unreadable', async () => {
    // INVERTED fail-soft: an unreadable flag must SUPPRESS. Failing open here
    // would re-nag someone who already declined, which is the one outcome a
    // nudge must never produce.
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('unreadable'));
    const { result } = await renderHook(() => useAlertNudgeCard());
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });
});

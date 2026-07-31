/**
 * WHAT:  Tests for usePushRegistration — who gets a token, when the RPC is
 *        skipped, and the ways it must fail quietly.
 * WHY:   This runs at launch on every cold start, so its failure modes are
 *        the app's failure modes: prompting a guest, prompting at all, or
 *        throwing when push credentials aren't configured would each break
 *        opening the app. The Android channel ordering matters because a
 *        notification with no channel is dropped SILENTLY — nothing surfaces
 *        it except this test.
 * LINKS: ./usePushRegistration.ts, ../lib/pushDevice.ts; docs/TESTING.md.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import type { PushDevice } from '../lib/pushDevice';
import { clearPushTokenCache } from '../lib/pushTokenCache';
import { usePushRegistration } from './usePushRegistration';

const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockUseSession() as { status: string; userId: string | null },
}));

const mockCheckPermission = jest.fn();
jest.mock('@/features/permissions', () => ({
  checkDevicePermission: (kind: string) => mockCheckPermission(kind) as Promise<unknown>,
}));

const mockRegister = jest.fn();
jest.mock('../api/pushTokenApi', () => ({
  registerPushToken: (token: string, platform: string) =>
    mockRegister(token, platform) as Promise<void>,
}));

/** Records call ORDER so "channel before token" is assertable. */
let calls: string[] = [];
function makeDevice(token: string | null = 'ExponentPushToken[abc]'): PushDevice {
  return {
    ensureChannel: jest.fn(async () => {
      calls.push('channel');
    }),
    getExpoPushToken: jest.fn(async () => {
      calls.push('token');
      return token;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPushTokenCache();
  calls = [];
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
  mockCheckPermission.mockResolvedValue({ state: 'granted', canAskAgain: true });
  mockRegister.mockResolvedValue(undefined);
});

describe('usePushRegistration', () => {
  it('does not request a push token for a guest', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    const device = makeDevice();

    await renderHook(() => usePushRegistration(true, device));

    expect(device.getExpoPushToken).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does nothing until enabled', async () => {
    const device = makeDevice();
    const hook = await renderHook(
      ({ enabled }: { enabled: boolean }) => usePushRegistration(enabled, device),
      { initialProps: { enabled: false } },
    );
    expect(mockCheckPermission).not.toHaveBeenCalled();

    await hook.rerender({ enabled: true });
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
  });

  it('does not request a token when notification permission is not granted', async () => {
    mockCheckPermission.mockResolvedValue({ state: 'denied', canAskAgain: false });
    const device = makeDevice();

    await renderHook(() => usePushRegistration(true, device));

    await waitFor(() => expect(mockCheckPermission).toHaveBeenCalledWith('notifications'));
    expect(device.getExpoPushToken).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('never prompts — it only ever reads the permission', async () => {
    // The startup gate and the settings primer own prompting. If this hook
    // ever gained a request() call, opening the app would fire a dialog.
    const device = makeDevice();
    await renderHook(() => usePushRegistration(true, device));
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());

    expect(mockCheckPermission).toHaveBeenCalledTimes(1);
    expect(mockCheckPermission).toHaveBeenCalledWith('notifications');
  });

  it('creates the Android alert channel before requesting a token', async () => {
    const device = makeDevice();
    await renderHook(() => usePushRegistration(true, device));

    await waitFor(() => expect(device.getExpoPushToken).toHaveBeenCalled());
    expect(calls).toEqual(['channel', 'token']);
  });

  it('registers once per cold start and skips the RPC when the token is unchanged', async () => {
    const device = makeDevice();
    const hook = await renderHook(() => usePushRegistration(true, device));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));

    await hook.unmount();
    await renderHook(() => usePushRegistration(true, makeDevice()));

    // Remounting re-reads the device, but the RPC is not repeated.
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
  });

  it('re-registers when the signed-in user changes', async () => {
    const device = makeDevice();
    const hook = await renderHook(() => usePushRegistration(true, device));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));

    // Same handset, different account — the token must move to the new user.
    mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'user-2' });
    await hook.rerender(undefined);

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(2));
  });

  it('stays silent when the push service is unavailable', async () => {
    // The normal state before FCM credentials exist: no token, no throw.
    const device = makeDevice(null);
    await renderHook(() => usePushRegistration(true, device));

    await waitFor(() => expect(device.getExpoPushToken).toHaveBeenCalled());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does not throw when the registration RPC fails', async () => {
    mockRegister.mockRejectedValue(new Error('network'));
    const device = makeDevice();

    await renderHook(() => usePushRegistration(true, device));

    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    // Nothing cached, so the next launch retries rather than assuming success.
    await renderHook(() => usePushRegistration(true, makeDevice()));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(2));
  });

  it('does nothing on web', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      const device = makeDevice();
      await renderHook(() => usePushRegistration(true, device));
      expect(mockCheckPermission).not.toHaveBeenCalled();
      expect(device.getExpoPushToken).not.toHaveBeenCalled();
    } finally {
      os.restore();
    }
  });
});

/**
 * WHAT:  Tests for useStartupPermissionRequests — fires the OS dialogs only
 *        for ungranted-and-askable kinds, in order, sequentially; skips
 *        blocked/unavailable kinds; runs once per cold start; does nothing
 *        while disabled or on web.
 * WHY:   Requesting a blocked kind silently auto-denies (a wasted ask), and
 *        a chain that re-fires on every AuthGate re-render would nag the
 *        user mid-session — both are regressions only tests will catch.
 * LINKS: src/features/permissions/hooks/useStartupPermissionRequests.ts.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import type { PermissionsSnapshot, PermissionStatus } from '../lib/devicePermissions';
import {
  resetStartupPermissionRequestsForTests,
  useStartupPermissionGrant,
  useStartupPermissionRequests,
} from './useStartupPermissionRequests';

const mockCheckAll = jest.fn();
const mockRequest = jest.fn();

jest.mock('../lib/devicePermissions', () => ({
  ...jest.requireActual('../lib/devicePermissions'),
  expoDevicePermissions: {
    checkAll: () => mockCheckAll() as Promise<PermissionsSnapshot>,
    request: (kind: string) => mockRequest(kind) as Promise<PermissionStatus>,
  },
}));

const granted: PermissionStatus = { state: 'granted', canAskAgain: true };
const undetermined: PermissionStatus = { state: 'undetermined', canAskAgain: true };

const snapshot = (overrides: Partial<PermissionsSnapshot> = {}): PermissionsSnapshot => ({
  location: granted,
  camera: granted,
  photos: granted,
  notifications: granted,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetStartupPermissionRequestsForTests();
  mockCheckAll.mockResolvedValue(snapshot());
  mockRequest.mockResolvedValue({ state: 'denied', canAskAgain: true });
});

describe('useStartupPermissionRequests', () => {
  it('requests only ungranted-and-askable kinds, in the fixed order', async () => {
    mockCheckAll.mockResolvedValue(
      snapshot({
        notifications: undetermined,
        location: undetermined,
        // Blocked: requesting would silently auto-deny — must be skipped.
        camera: { state: 'denied', canAskAgain: false },
        photos: { state: 'unavailable', canAskAgain: false },
      }),
    );

    await renderHook(() => useStartupPermissionRequests(true));

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(mockRequest.mock.calls.map(([kind]) => kind)).toEqual(['location', 'notifications']);
  });

  it('does nothing when everything is already granted', async () => {
    await renderHook(() => useStartupPermissionRequests(true));
    await waitFor(() => expect(mockCheckAll).toHaveBeenCalled());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('runs once per cold start — later re-renders and remounts do not re-prompt', async () => {
    mockCheckAll.mockResolvedValue(snapshot({ camera: undetermined }));
    const first = await renderHook(
      ({ enabled }: { enabled: boolean }) => useStartupPermissionRequests(enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));

    await first.rerender({ enabled: true });
    await first.unmount();
    await renderHook(() => useStartupPermissionRequests(true));

    expect(mockCheckAll).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('waits while disabled, fires once enabled (post-onboarding landing)', async () => {
    mockCheckAll.mockResolvedValue(snapshot({ notifications: undetermined }));
    const hook = await renderHook(
      ({ enabled }: { enabled: boolean }) => useStartupPermissionRequests(enabled),
      { initialProps: { enabled: false } },
    );
    expect(mockCheckAll).not.toHaveBeenCalled();

    await hook.rerender({ enabled: true });
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('notifications'));
  });

  it('does nothing on web', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await renderHook(() => useStartupPermissionRequests(true));
      expect(mockCheckAll).not.toHaveBeenCalled();
    } finally {
      os.restore();
    }
  });

  it('broadcasts grants live — a location Allow flips the signal, a deny never does', async () => {
    mockCheckAll.mockResolvedValue(snapshot({ location: undetermined, camera: undetermined }));
    mockRequest.mockImplementation((kind: string) =>
      Promise.resolve(
        kind === 'location'
          ? ({ state: 'granted', canAskAgain: true } as PermissionStatus)
          : ({ state: 'denied', canAskAgain: true } as PermissionStatus),
      ),
    );

    const locationGrant = await renderHook(() => useStartupPermissionGrant('location'));
    const cameraGrant = await renderHook(() => useStartupPermissionGrant('camera'));
    expect(locationGrant.result.current).toBe(false);

    await renderHook(() => useStartupPermissionRequests(true));

    await waitFor(() => expect(locationGrant.result.current).toBe(true));
    expect(cameraGrant.result.current).toBe(false); // denied never signals
  });
});

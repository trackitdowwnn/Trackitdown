/**
 * WHAT:  Tests for useDevicePermission's re-checks.
 * WHY:   The 2026-10-27 review: the hook re-checked only on screen focus, and
 *        coming back from the OS Settings app fires none — so a permission
 *        turned on there stayed "off" on screen (the chat's "Turn on
 *        notifications" row, the Alerts banner) until the user navigated away.
 * LINKS: src/features/permissions/hooks/useDevicePermission.ts.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useDevicePermission } from './useDevicePermission';

const mockCheck = jest.fn();
jest.mock('../lib/devicePermissions', () => ({
  expoDevicePermissions: {
    check: (...args: unknown[]) => mockCheck(...args),
    request: jest.fn(),
  },
}));

// Focus fires once, as on mount; the AppState path is what is under test.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});

let mockOnChange: ((state: AppStateStatus) => void) | null = null;
const mockRemove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockOnChange = null;
  mockCheck
    .mockResolvedValueOnce({ state: 'denied', canAskAgain: false })
    .mockResolvedValue({ state: 'granted', canAskAgain: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    mockOnChange = handler as (state: AppStateStatus) => void;
    return { remove: mockRemove } as never;
  });
});

afterEach(() => jest.restoreAllMocks());

it('re-checks when the app comes back to the foreground', async () => {
  const { result, unmount } = await renderHook(() => useDevicePermission('notifications'));
  await act(async () => {});
  expect(result.current.status?.state).toBe('denied');

  await act(async () => {
    mockOnChange?.('background');
  });
  expect(mockCheck).toHaveBeenCalledTimes(1); // leaving does nothing

  await act(async () => {
    mockOnChange?.('active'); // back from Settings
  });
  expect(result.current.status?.state).toBe('granted');

  await act(async () => {
    unmount();
  });
  expect(mockRemove).toHaveBeenCalled();
});

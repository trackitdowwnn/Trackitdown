/**
 * WHAT:  Tests for the device-permissions adapter — status mapping,
 *        canAskAgain passthrough, per-kind request routing, and graceful
 *        degradation to 'unavailable' on throw / missing module.
 * WHY:   'unavailable' never gates, so the degradation paths are what keep
 *        a broken native module from trapping the user at startup.
 * LINKS: src/features/permissions/lib/devicePermissions.ts;
 *        src/shared/lib/location/expoLocationServices.test.ts (mock pattern).
 */

import { expoDevicePermissions, isUngranted } from './devicePermissions';

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
};
const mockCamera = {
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
};
const mockPicker = {
  getMediaLibraryPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
};
const mockNotifications = {
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
};
let mockNotificationsLoadFails = false;

jest.mock('expo-location', () => mockLocation);
jest.mock('expo-camera', () => ({ Camera: mockCamera }));
jest.mock('expo-image-picker', () => mockPicker);
jest.mock('expo-notifications', () => {
  if (mockNotificationsLoadFails) {
    throw new Error('expo-notifications native module unavailable');
  }
  return mockNotifications;
});

const granted = { status: 'granted', canAskAgain: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationsLoadFails = false;
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
  mockCamera.getCameraPermissionsAsync.mockResolvedValue(granted);
  mockPicker.getMediaLibraryPermissionsAsync.mockResolvedValue(granted);
  mockNotifications.getPermissionsAsync.mockResolvedValue(granted);
});

describe('checkAll', () => {
  it('maps every kind silently — no request function is ever called', async () => {
    const snapshot = await expoDevicePermissions.checkAll();

    expect(snapshot).toEqual({
      location: { state: 'granted', canAskAgain: true },
      camera: { state: 'granted', canAskAgain: true },
      photos: { state: 'granted', canAskAgain: true },
      notifications: { state: 'granted', canAskAgain: true },
    });
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockCamera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('passes denied/undetermined and canAskAgain through per kind', async () => {
    mockCamera.getCameraPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });
    mockNotifications.getPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true,
    });

    const snapshot = await expoDevicePermissions.checkAll();

    expect(snapshot.camera).toEqual({ state: 'denied', canAskAgain: false });
    expect(snapshot.notifications).toEqual({ state: 'undetermined', canAskAgain: true });
    expect(snapshot.location.state).toBe('granted');
  });

  it('degrades a rejecting check to unavailable without touching the others', async () => {
    mockPicker.getMediaLibraryPermissionsAsync.mockRejectedValue(new Error('boom'));

    const snapshot = await expoDevicePermissions.checkAll();

    expect(snapshot.photos).toEqual({ state: 'unavailable', canAskAgain: false });
    expect(snapshot.location.state).toBe('granted');
  });

  it('degrades an unknown status string to unavailable', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'limited',
      canAskAgain: true,
    });

    const snapshot = await expoDevicePermissions.checkAll();

    expect(snapshot.location).toEqual({ state: 'unavailable', canAskAgain: false });
  });

  it('degrades a module that fails to load to unavailable', async () => {
    mockNotificationsLoadFails = true;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh copy so the lazy require re-runs
    const fresh = require('./devicePermissions') as typeof import('./devicePermissions');

    const snapshot = await fresh.expoDevicePermissions.checkAll();

    expect(snapshot.notifications).toEqual({ state: 'unavailable', canAskAgain: false });
    expect(snapshot.location.state).toBe('granted');
  });
});

describe('request', () => {
  it('routes each kind to its own request function', async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });

    const status = await expoDevicePermissions.request('notifications');

    expect(status).toEqual({ state: 'denied', canAskAgain: false });
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('degrades a rejecting request to unavailable', async () => {
    mockCamera.requestCameraPermissionsAsync.mockRejectedValue(new Error('boom'));

    const status = await expoDevicePermissions.request('camera');

    expect(status).toEqual({ state: 'unavailable', canAskAgain: false });
  });
});

describe('isUngranted', () => {
  it('gates denied and undetermined, never granted or unavailable', () => {
    expect(isUngranted({ state: 'denied', canAskAgain: true })).toBe(true);
    expect(isUngranted({ state: 'undetermined', canAskAgain: true })).toBe(true);
    expect(isUngranted({ state: 'granted', canAskAgain: true })).toBe(false);
    expect(isUngranted({ state: 'unavailable', canAskAgain: false })).toBe(false);
  });
});

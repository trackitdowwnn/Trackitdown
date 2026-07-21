/**
 * WHAT:  Device-permissions adapter for the startup gate — one silent
 *        checkAll() (never fires an OS dialog) and a per-kind request()
 *        (may fire the dialog) over location, camera, photos, and
 *        notifications.
 * WHY:   The gate needs every status in one snapshot to decide whether to
 *        show at all, and the screen needs to request kinds one at a time.
 *        Each expo module is lazy-required separately so a missing native
 *        module degrades to 'unavailable' (which never gates) instead of
 *        breaking the other checks — the app must never be trapped behind
 *        a broken permission module.
 * LINKS: src/features/search-map/lib/feedDeviceLocation.ts (the lazy-require
 *        pattern this copies); src/features/permissions/hooks/usePermissionsGate.ts;
 *        Expo v57 SDK docs (location / camera / image-picker / notifications).
 */

export type PermissionKind = 'location' | 'camera' | 'photos' | 'notifications';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface PermissionStatus {
  state: PermissionState;
  /** false when the OS will no longer show the dialog (route to Settings). */
  canAskAgain: boolean;
}

export type PermissionsSnapshot = Record<PermissionKind, PermissionStatus>;

/** Injected into the gate hook + screen so both are unit-testable. */
export interface DevicePermissions {
  /** Silent — NEVER fires an OS dialog. */
  checkAll(): Promise<PermissionsSnapshot>;
  /** May fire the OS dialog for one permission. */
  request(kind: PermissionKind): Promise<PermissionStatus>;
}

/** The shared shape of every expo PermissionResponse we consume. */
interface ExpoPermissionResponse {
  status: string;
  canAskAgain: boolean;
}

interface PermissionCalls {
  check(): Promise<ExpoPermissionResponse>;
  request(): Promise<ExpoPermissionResponse>;
}

const UNAVAILABLE: PermissionStatus = { state: 'unavailable', canAskAgain: false };

// Lazy literal requires, same rationale as feedDeviceLocation: side-effect
// free import, statically resolvable, degrades gracefully where a native
// module can't load. One loader per kind — a broken module only takes out
// its own row.
function loadCalls(kind: PermissionKind): PermissionCalls | null {
  try {
    switch (kind) {
      case 'location': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
        const location = require('expo-location') as {
          getForegroundPermissionsAsync(): Promise<ExpoPermissionResponse>;
          requestForegroundPermissionsAsync(): Promise<ExpoPermissionResponse>;
        };
        return {
          check: () => location.getForegroundPermissionsAsync(),
          request: () => location.requestForegroundPermissionsAsync(),
        };
      }
      case 'camera': {
        // SDK 57 exposes the imperative calls only on the Camera namespace
        // object (the top-level exports are the hooks).
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
        const { Camera } = require('expo-camera') as {
          Camera: {
            getCameraPermissionsAsync(): Promise<ExpoPermissionResponse>;
            requestCameraPermissionsAsync(): Promise<ExpoPermissionResponse>;
          };
        };
        return {
          check: () => Camera.getCameraPermissionsAsync(),
          request: () => Camera.requestCameraPermissionsAsync(),
        };
      }
      case 'photos': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
        const picker = require('expo-image-picker') as {
          getMediaLibraryPermissionsAsync(): Promise<ExpoPermissionResponse>;
          requestMediaLibraryPermissionsAsync(): Promise<ExpoPermissionResponse>;
        };
        return {
          check: () => picker.getMediaLibraryPermissionsAsync(),
          request: () => picker.requestMediaLibraryPermissionsAsync(),
        };
      }
      case 'notifications': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
        const notifications = require('expo-notifications') as {
          getPermissionsAsync(): Promise<ExpoPermissionResponse>;
          requestPermissionsAsync(): Promise<ExpoPermissionResponse>;
        };
        return {
          check: () => notifications.getPermissionsAsync(),
          request: () => notifications.requestPermissionsAsync(),
        };
      }
    }
  } catch {
    return null;
  }
}

function toStatus(response: ExpoPermissionResponse): PermissionStatus {
  const { status, canAskAgain } = response;
  if (status === 'granted' || status === 'denied' || status === 'undetermined') {
    return { state: status, canAskAgain };
  }
  return UNAVAILABLE;
}

async function run(kind: PermissionKind, mode: 'check' | 'request'): Promise<PermissionStatus> {
  const calls = loadCalls(kind);
  if (!calls) return UNAVAILABLE;
  try {
    return toStatus(await (mode === 'check' ? calls.check() : calls.request()));
  } catch {
    return UNAVAILABLE;
  }
}

/** Is this status one the gate should ask about? 'unavailable' never gates. */
export function isUngranted(status: PermissionStatus): boolean {
  return status.state === 'denied' || status.state === 'undetermined';
}

export const expoDevicePermissions: DevicePermissions = {
  async checkAll() {
    const [location, camera, photos, notifications] = await Promise.all([
      run('location', 'check'),
      run('camera', 'check'),
      run('photos', 'check'),
      run('notifications', 'check'),
    ]);
    return { location, camera, photos, notifications };
  },

  request(kind) {
    return run(kind, 'request');
  },
};

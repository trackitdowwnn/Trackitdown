/**
 * WHAT:  Public API of the permissions feature.
 * WHY:   Other code (the auth gate) imports ONLY from here
 *        (docs/ARCHITECTURE.md rule 1).
 * LINKS: src/features/permissions/README.md.
 */

// AuthGate fires the startup prompts; screens that resolve permission-
// derived state at mount (the Explore feed) react to grants landing after
// the dialogs are answered. The adapter stays internal.
export {
  useStartupPermissionGrant,
  useStartupPermissionRequests,
} from './hooks/useStartupPermissionRequests';

// Live per-kind state for surfaces that OWN a permission conversation rather
// than react to the startup ones (alert settings). The adapter itself stays
// internal — callers get a hook, not the ability to prompt arbitrarily.
export { useDevicePermission, type DevicePermissionState } from './hooks/useDevicePermission';
// One silent read for background work with no component to hang a hook on
// (push-token registration). Prompting is NOT exposed — that stays with the
// startup gate and in-flow primers.
export { checkDevicePermission } from './lib/devicePermissions';
export type { PermissionKind, PermissionStatus } from './lib/devicePermissions';

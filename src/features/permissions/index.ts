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

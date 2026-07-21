/**
 * WHAT:  Public API of the permissions feature.
 * WHY:   Other code (the auth gate) imports ONLY from here
 *        (docs/ARCHITECTURE.md rule 1).
 * LINKS: src/features/permissions/README.md.
 */

// AuthGate fires the startup prompts. The adapter stays internal.
export { useStartupPermissionRequests } from './hooks/useStartupPermissionRequests';

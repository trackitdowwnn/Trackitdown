/**
 * WHAT:  useStartupPermissionRequests — once per cold start, after the app
 *        lands (post-onboarding, tabs visible), silently checks location /
 *        camera / photos / notifications and fires the NATIVE OS dialog,
 *        one at a time, for whatever is still askable. No custom UI.
 * WHY:   Product call (2026-07-21): no gate screen — the OS prompts ARE the
 *        ask. Sequential awaits stop dialogs racing each other; kinds the OS
 *        has blocked (canAskAgain=false) are skipped because requesting them
 *        auto-resolves to denied without showing anything. Re-runs every
 *        cold start until granted; a hard OS block leaves the in-flow
 *        primers (CameraCapture, sighting location) as the recovery path.
 * LINKS: src/features/permissions/lib/devicePermissions.ts (the adapter);
 *        src/features/auth/components/AuthGate.tsx (caller, enabled when
 *        route === 'app'); docs/LOGGING.md (this is a funnel).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { createLogger } from '@/shared/lib/logger';

import {
  expoDevicePermissions,
  isUngranted,
  type PermissionKind,
} from '../lib/devicePermissions';

const log = createLogger('permissions');

/** Fixed prompt order — mirrors how the app earns trust: place, capture,
 *  library, then alerts. */
const REQUEST_ORDER: PermissionKind[] = ['location', 'camera', 'photos', 'notifications'];

// Once per cold start: the always-mounted AuthGate re-renders freely, and a
// backgrounded/foregrounded app must not re-run the chain mid-session.
let ranThisSession = false;

// Kinds granted DURING the startup chain. Screens mount before the user has
// answered the dialogs, so anything that resolved permission-derived state
// at mount (the Explore feed's location chain) subscribes here to react to
// the grant landing seconds later.
const startupGrants = new Set<PermissionKind>();
const grantSubscribers = new Set<() => void>();
function subscribeToGrants(cb: () => void): () => void {
  grantSubscribers.add(cb);
  return () => grantSubscribers.delete(cb);
}
function recordGrant(kind: PermissionKind): void {
  startupGrants.add(kind);
  grantSubscribers.forEach((cb) => cb());
}

/** Live "did the startup prompts grant this?" — flips true the moment the
 *  user allows that kind in the startup chain (this session only). */
export function useStartupPermissionGrant(kind: PermissionKind): boolean {
  return useSyncExternalStore(subscribeToGrants, () => startupGrants.has(kind));
}

/** Test-only reset for the module-level once-per-start state. */
export function resetStartupPermissionRequestsForTests(): void {
  ranThisSession = false;
  startupGrants.clear();
  // Notify so a hook still mounted across a reset re-reads false.
  grantSubscribers.forEach((cb) => cb());
}

export function useStartupPermissionRequests(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || ranThisSession || Platform.OS === 'web') return;
    ranThisSession = true;

    void (async () => {
      const snapshot = await expoDevicePermissions.checkAll();
      for (const kind of REQUEST_ORDER) {
        const status = snapshot[kind];
        // Only kinds the OS will actually show a dialog for: ungranted AND
        // askable. 'unavailable' and blocked kinds are silently skipped.
        if (!isUngranted(status) || !status.canAskAgain) continue;
        const result = await expoDevicePermissions.request(kind);
        if (result.state === 'granted') {
          recordGrant(kind);
        }
        log.info('Startup permission prompt', {
          kind,
          state: result.state,
          canAskAgain: result.canAskAgain,
        });
      }
    })();
  }, [enabled]);
}

/**
 * WHAT:  Live OS-permission state for ONE kind, with a request action.
 * WHY:   In-flow surfaces (the alert settings screen, in-flow primers) need to
 *        know the current state, not the state at first mount: a user who taps
 *        "Open settings", flips the toggle and comes back must see the screen
 *        agree with their phone. Re-checking on focus is what makes that work
 *        without a relaunch.
 *        `status` is null until the first silent check resolves so callers can
 *        reserve height instead of flashing a primer at someone who already
 *        granted (the pattern sightingSteps established).
 * LINKS: ../lib/devicePermissions.ts (the adapter — silent check vs prompting
 *        request); ../hooks/useStartupPermissionRequests.ts (the once-per-cold-
 *        start prompts); src/features/notifications/screens/
 *        AlertSettingsScreen.tsx (the main consumer).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  expoDevicePermissions,
  type PermissionKind,
  type PermissionStatus,
} from '../lib/devicePermissions';

export interface DevicePermissionState {
  /** null while the first silent check is in flight. */
  status: PermissionStatus | null;
  /** Fires the OS dialog. Resolves to the resulting status, which is also
   *  written to `status` — callers can await it to branch immediately. */
  request: () => Promise<PermissionStatus>;
  /** Silent re-check (focus and returning to the app already do this). */
  refresh: () => void;
}

export function useDevicePermission(kind: PermissionKind): DevicePermissionState {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  // Guards a setState after unmount when the check resolves late.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    void expoDevicePermissions.check(kind).then((next) => {
      if (mountedRef.current) setStatus(next);
    });
  }, [kind]);

  // Re-check whenever the screen regains focus (another screen may have asked).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // ⚠️ AND when the app comes back to the foreground. Returning from the OS
  // Settings app fires no navigation focus, so a permission turned on there
  // stayed "off" on screen until the user navigated away (2026-10-27 review).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const request = useCallback(async () => {
    const next = await expoDevicePermissions.request(kind);
    if (mountedRef.current) setStatus(next);
    return next;
  }, [kind]);

  return { status, request, refresh };
}

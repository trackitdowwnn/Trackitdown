/**
 * WHAT:  Resolves where a NEW alert's map should open — the device's position
 *        if location is already granted, else the saved Explore feed location,
 *        else nothing (the picker falls back to its whole-UK view).
 * WHY:   The area step used to open on the whole of the UK, so the first thing
 *        a spotter saw was the country and they had to pan or search to their
 *        own street before the step meant anything.
 *
 *        ⚠️ NEVER COLD-PROMPTS, and never waits for a fresh GPS fix.
 *        `getLastKnownPosition` reads permission with the non-prompting call
 *        and returns the OS's CACHED fix immediately. The obvious alternative,
 *        `expoLocationServices.getCurrentPosition`, is wrong twice over: it
 *        calls `requestForegroundPermissionsAsync` internally (firing the OS
 *        dialog the moment someone opens the wizard, which this repo reserves
 *        for a primer CTA), and it waits 3-10s for a fresh fix. The picker's
 *        own "use my current location" button is where that slow accurate path
 *        belongs — the user pressed it and is expecting to wait.
 *
 *        The feed location is a PREFILL, not a link — changing an alert never
 *        writes back to it, and the two settings stay independent
 *        (feedLocationStorage's own header and the search-map README say the
 *        same). This is the consumer both of them were written for.
 * LINKS: ../screens/AlertWizardScreen.tsx (the only caller);
 *        src/shared/lib/location/feedLocationStorage.ts;
 *        src/features/permissions (checkDevicePermission);
 *        src/features/search-map/hooks/useFeedLocation.ts (same chain, for the feed).
 */

import { useEffect, useRef, useState } from 'react';

import { getLastKnownPosition } from '@/shared/lib/location/expoLocationServices';
import { loadFeedLocationPref } from '@/shared/lib/location/feedLocationStorage';
import type { GeoCoord } from '@/shared/types';

export interface DefaultAlertCentreState {
  /** 'resolving' until the chain settles; the wizard holds a loader on it. */
  status: 'resolving' | 'ready';
  /** null means "we found nothing" — the picker shows its whole-UK view and
   *  the step stays un-settled, exactly as it behaved before this existed. */
  centre: GeoCoord | null;
}

/** Longest the chain may take before we give up and open on the UK view.
 *  A GPS fix can hang indefinitely with no error; the wizard must not. */
const RESOLVE_TIMEOUT_MS = 2000;

async function resolveCentre(): Promise<GeoCoord | null> {
  // 1. The fix the OS already has. NOT a fresh one: measured on the test
  //    handset, getCurrentPositionAsync took 3-10 SECONDS, which is far longer
  //    than anyone will wait on a loader before a settings screen. The first
  //    version of this used it, hit the timeout below every single time, and
  //    silently opened every alert on the whole-UK view — the exact bug it was
  //    written to fix. A cached fix is plenty: this only decides where the map
  //    opens, and the user can pan or press "use my current location" (which
  //    DOES take the slow, accurate path) from there.
  const cached = await getLastKnownPosition();
  if (cached) {
    return cached;
  }

  // 2. Wherever they pointed the Explore feed — usually near home.
  const pref = await loadFeedLocationPref();
  if (pref) {
    return { latitude: pref.latitude, longitude: pref.longitude };
  }

  // 3. Nothing. The picker's own whole-UK fallback takes over, and its locate
  //    button is right there.
  return null;
}

/**
 * @param enabled Pass false when editing (the saved alert already has a point),
 *   so a pointless permission read and GPS fix never run.
 */
export function useDefaultAlertCentre(enabled = true): DefaultAlertCentreState {
  const [state, setState] = useState<DefaultAlertCentreState>(() => ({
    status: enabled ? 'resolving' : 'ready',
    centre: null,
  }));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Whoever finishes first wins, and the loser is ignored — so a wedged GPS
    // call can delay the map by at most RESOLVE_TIMEOUT_MS.
    const settle = (centre: GeoCoord | null) => {
      if (!mountedRef.current) return;
      if (timer) clearTimeout(timer);
      timer = null;
      setState((current) => (current.status === 'ready' ? current : { status: 'ready', centre }));
    };

    timer = setTimeout(() => settle(null), RESOLVE_TIMEOUT_MS);
    // Never rejects: every step of the chain swallows its own failures, but
    // catch anyway so a surprise can only cost the fallback, not the wizard.
    resolveCentre().then(settle, () => settle(null));

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}

/**
 * WHAT:  useFeedLocation — resolves where the Explore feed looks, through
 *        the chain: saved feed preference → device location (only if
 *        permission is ALREADY granted) → national mode ("the UK"), then
 *        upgrades from national when the STARTUP permission prompts grant
 *        location after the chain settled. Exposes setArea (persists the
 *        "Set my area" pick) and requestMyLocation (the primer card's CTA —
 *        the one path allowed to trigger the OS prompt).
 * WHY:   The feed must be useful with zero setup and zero permissions, and
 *        must never cold-fire the OS location dialog — asking is the primer
 *        card's job. The preference is client-only and deliberately separate
 *        from the (future) alert settings. Location changes are logged
 *        coarse ([search-map], redactLocation) — precise coords stay out of
 *        logs per docs/LOGGING.md.
 * LINKS: src/features/search-map/lib/feedLocationStorage.ts;
 *        src/features/search-map/lib/feedDeviceLocation.ts;
 *        src/features/search-map/README.md (resolution chain).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useStartupPermissionGrant } from '@/features/permissions';
import { createLogger, redactLocation } from '@/shared/lib/logger';

import type { FeedLocation } from '../types';
import { FEED_RADIUS_DEFAULT_MILES } from '../lib/feedConfig';
import type { FeedDeviceLocation } from '../lib/feedDeviceLocation';
import { expoFeedDeviceLocation } from '../lib/feedDeviceLocation';
import {
  loadFeedLocationPref,
  saveFeedLocationPref,
  type FeedLocationPref,
} from '../lib/feedLocationStorage';

const log = createLogger('search-map');

export interface UseFeedLocationResult {
  /** null while the chain is still resolving (feed shows the skeleton). */
  location: FeedLocation | null;
  /**
   * True when we fell to national mode WITHOUT the user ever picking an
   * area — the screen shows the location primer card.
   */
  showLocationPrimer: boolean;
  /** "Set my area" confirm: persist and switch the feed. */
  setArea: (pref: FeedLocationPref) => Promise<void>;
  /** Primer CTA: may fire the OS permission prompt. False = denied/failed. */
  requestMyLocation: () => Promise<boolean>;
}

export function useFeedLocation(
  device: FeedDeviceLocation = expoFeedDeviceLocation,
): UseFeedLocationResult {
  const [location, setLocation] = useState<FeedLocation | null>(null);
  const [showLocationPrimer, setShowLocationPrimer] = useState(false);
  const mounted = useRef(true);
  // Captured once — the adapter is a capability, not reactive data. A caller
  // passing a fresh object per render must not re-trigger the resolve effect.
  const deviceRef = useRef(device);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyDeviceFix = useCallback(
    async (requestPermission: boolean): Promise<boolean> => {
      const dev = deviceRef.current;
      // The silent path checks first so we never prompt; the primer path
      // goes straight to the (prompting) position request.
      if (!requestPermission && !(await dev.hasPermission())) {
        return false;
      }
      const coord = await dev.getCurrentPosition();
      if (!coord) {
        return false;
      }
      const area = await dev.reverseGeocodeArea(coord);
      if (!mounted.current) {
        return true;
      }
      setLocation({
        mode: 'local',
        latitude: coord.latitude,
        longitude: coord.longitude,
        addressLabel: area ?? '',
        radiusMiles: FEED_RADIUS_DEFAULT_MILES,
        fromPreference: false,
      });
      setShowLocationPrimer(false);
      log.info('feed_location_change', {
        source: requestPermission ? 'primer' : 'device',
        origin: redactLocation(coord.latitude, coord.longitude),
      });
      return true;
    },
    // deviceRef is captured once by design — see its declaration comment.
    [],
  );

  // Resolve the chain once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pref = await loadFeedLocationPref();
      if (cancelled) {
        return;
      }
      if (pref) {
        setLocation({
          mode: 'local',
          latitude: pref.latitude,
          longitude: pref.longitude,
          addressLabel: pref.addressLabel,
          radiusMiles: pref.radiusMiles,
          fromPreference: true,
        });
        return;
      }
      const located = await applyDeviceFix(false);
      if (!located && !cancelled) {
        setLocation({ mode: 'national' });
        setShowLocationPrimer(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDeviceFix]);

  // The startup permission prompts land AFTER the mount chain resolved: the
  // feed settles national while the OS location dialog is still on screen.
  // When that dialog is allowed, upgrade to the device fix — but only from
  // ungoverned national mode (a saved area pick or an already-local feed is
  // the user's choice and never overridden). Silent path only: permission is
  // already granted, so no dialog can fire. Primitive dep (mode), not the
  // location object — this repo's identity-keyed-effect hazard.
  const grantedAtStartup = useStartupPermissionGrant('location');
  const locationMode = location?.mode;
  useEffect(() => {
    if (!grantedAtStartup || locationMode !== 'national') {
      return;
    }
    void applyDeviceFix(false);
  }, [grantedAtStartup, locationMode, applyDeviceFix]);

  const setArea = useCallback(async (pref: FeedLocationPref) => {
    setLocation({
      mode: 'local',
      latitude: pref.latitude,
      longitude: pref.longitude,
      addressLabel: pref.addressLabel,
      radiusMiles: pref.radiusMiles,
      fromPreference: true,
    });
    setShowLocationPrimer(false);
    log.info('feed_location_change', {
      source: 'picker',
      origin: redactLocation(pref.latitude, pref.longitude),
      radiusMiles: pref.radiusMiles,
    });
    await saveFeedLocationPref(pref);
  }, []);

  const requestMyLocation = useCallback(() => applyDeviceFix(true), [applyDeviceFix]);

  return { location, showLocationPrimer, setArea, requestMyLocation };
}

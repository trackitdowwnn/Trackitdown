/**
 * WHAT:  useFeedLocation — resolves where the Explore feed looks, through
 *        the chain: saved feed preference → device location (only if
 *        permission is ALREADY granted) → national mode ("the UK"), then
 *        upgrades from national when the STARTUP permission prompts grant
 *        location after the chain settled. Exposes setArea (persists the
 *        "Set my area" pick) and requestMyLocation — the one path here allowed
 *        to trigger the OS prompt. ⚠️ requestMyLocation has NO production
 *        caller since the primer became a row that opens the picker instead
 *        (2026-08-06); it is kept, tested, for a future one-tap entry point,
 *        and is now the easiest way to reintroduce a cold-fire. Delete it
 *        rather than wire it up casually.
 * WHY:   The feed must be useful with zero setup and zero permissions, and
 *        must never cold-fire the OS location dialog — asking belongs to an
 *        explicit user action (the picker's own current-location button). The preference is client-only and deliberately separate
 *        from the (future) alert settings. Location changes are logged
 *        coarse ([search-map], redactLocation) — precise coords stay out of
 *        logs per docs/LOGGING.md.
 *
 *        THE PRIMER TRACKS THE PERMISSION, NOT THE FIX. Every grant — startup
 *        dialog, primer CTA, or Settings while we were backgrounded — latches
 *        permissionGranted and pulls the card down immediately, and nothing
 *        re-raises it afterwards. It has to work that way because the position
 *        that follows a grant is the unreliable half (a cold GPS can fail, or
 *        hang past the adapter's cap), and a card still asking for a
 *        permission the user just gave reads as a broken app.
 * LINKS: src/features/search-map/lib/feedLocationStorage.ts;
 *        src/features/search-map/lib/feedDeviceLocation.ts;
 *        src/features/search-map/README.md (resolution chain).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useStartupPermissionGrant } from '@/features/permissions';
import {
  loadFeedLocationPref,
  saveFeedLocationPref,
  type FeedLocationPref,
} from '@/shared/lib/location/feedLocationStorage';
import { createLogger, redactLocation } from '@/shared/lib/logger';
import { markStartup } from '@/shared/lib/startupTrace';

import type { FeedLocation } from '../types';
import { FEED_RADIUS_DEFAULT_MILES } from '../lib/feedConfig';
import type { FeedDeviceLocation } from '../lib/feedDeviceLocation';
import { expoFeedDeviceLocation } from '../lib/feedDeviceLocation';

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
  // THE PRIMER'S LATCH. Once foreground permission is known granted, the card
  // is answered for the rest of the session and nothing may raise it again.
  // Without this the pitch outlived the "Allow" two ways: the fix that follows
  // a grant can fail or hang (cold GPS), and the mount chain's own permission
  // check can resolve stale, moments AFTER a grant landed elsewhere — both
  // left a card reading "Use my location" above a feed already using it.
  const permissionGranted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Record a permission answer; a granted one retires the primer at once. */
  const notePermission = useCallback((granted: boolean) => {
    if (!granted) {
      return;
    }
    permissionGranted.current = true;
    if (mounted.current) {
      setShowLocationPrimer(false);
    }
  }, []);

  /** Pitch the permission — refused once there is nothing left to pitch. */
  const pitchPrimer = useCallback(() => {
    if (permissionGranted.current || !mounted.current) {
      return;
    }
    setShowLocationPrimer(true);
  }, []);

  const applyDeviceFix = useCallback(
    async (requestPermission: boolean): Promise<boolean> => {
      const dev = deviceRef.current;
      // The answer FIRST, and on its own: the silent path checks so we never
      // prompt, the primer path asks. Either way the grant is banked before
      // the position is attempted, because the position is the part that can
      // take ten seconds or never arrive.
      const granted = requestPermission
        ? await dev.requestPermission()
        : await dev.hasPermission();
      notePermission(granted);
      if (!granted) {
        return false;
      }
      const coord = await dev.getCurrentPosition();
      if (!coord) {
        return false;
      }
      if (!mounted.current) {
        return true;
      }
      // THE POINT FIRST, ITS NAME SECOND. This used to await reverseGeocodeArea
      // before publishing the location, which put a network round trip on the
      // critical path of first paint — for a string the FEED DOES NOT USE. The
      // query needs latitude, longitude and radius; the label is display text
      // ("Hemel Hempstead") on a section header.
      //
      // Safe to fill in afterwards because useHomeFeed's effect deliberately
      // excludes addressLabel from its dependencies — see the note there — so
      // the second setLocation cannot trigger a refetch.
      setLocation({
        mode: 'local',
        latitude: coord.latitude,
        longitude: coord.longitude,
        addressLabel: '',
        radiusMiles: FEED_RADIUS_DEFAULT_MILES,
        fromPreference: false,
      });
      log.info('feed_location_change', {
        source: requestPermission ? 'primer' : 'device',
        origin: redactLocation(coord.latitude, coord.longitude),
      });

      // Off the critical path. A failure leaves the label empty, which the
      // header already handles — the feed is fully usable without it.
      void dev
        .reverseGeocodeArea(coord)
        .then((area) => {
          if (!area || !mounted.current) {
            return;
          }
          setLocation((current) =>
            current?.mode === 'local' && current.latitude === coord.latitude
              ? { ...current, addressLabel: area }
              : // A newer location landed while we were geocoding — that label
                // belongs to a point the user has moved on from.
                current,
          );
        })
        .catch(() => {});
      return true;
    },
    // deviceRef is captured once by design — see its declaration comment.
    [notePermission],
  );

  // The boot phase ends the moment the feed knows WHERE it is, by any route —
  // a stored preference, a device fix, or the national fallback. Idempotent, so
  // the later GPS refinements that re-set this do not move the mark.
  useEffect(() => {
    if (location) {
      markStartup('location_ready');
    }
  }, [location]);

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
        // Pitch the permission only when there IS one to pitch. applyDeviceFix
        // already banked the answer, so a granted-but-fixless run (cold GPS)
        // falls through the latch silently — a card whose tap changes nothing
        // reads as broken, and the retries below cover it anyway.
        pitchPrimer();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDeviceFix, pitchPrimer]);

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
    if (!grantedAtStartup) {
      return;
    }
    // The ANSWER lands here, whatever the mode: an allow is an allow, and the
    // card must go the moment it happens rather than when a fix arrives.
    notePermission(true);
    if (locationMode !== 'national') {
      return;
    }
    void applyDeviceFix(false);
  }, [grantedAtStartup, locationMode, applyDeviceFix, notePermission]);

  // Last recovery path: permission granted OUTSIDE the app — in Settings,
  // after a hard OS block — reaches us no other way, and coming back to a feed
  // still begging for a permission you just granted is the same broken read.
  // Armed only while the card is actually up, so the settled case costs
  // nothing; primitive dep (the boolean), never the location object.
  useEffect(() => {
    if (!showLocationPrimer) {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        return;
      }
      void applyDeviceFix(false);
    });
    return () => subscription.remove();
  }, [showLocationPrimer, applyDeviceFix]);

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

  // A denial leaves the card standing (there is still something to pitch); a
  // grant retires it inside applyDeviceFix, fix or no fix.
  const requestMyLocation = useCallback(() => applyDeviceFix(true), [applyDeviceFix]);

  return { location, showLocationPrimer, setArea, requestMyLocation };
}

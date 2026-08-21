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

/**
 * How long to wait before each attempt at a device fix while the feed is
 * stranded on national WITH permission granted. Four attempts over ~14s.
 *
 * THE FIRST IS ZERO, and that matters: when the OS already has a cached fix
 * (any launch after the first, or another app has just located) it comes back
 * immediately, and delaying it would put an artificial pause into the common
 * path to fix the rare one. The backoff is only for the cold-GPS case.
 *
 * Bounded deliberately. Each attempt already races a 10s timeout inside
 * getCurrentPosition, so an unbounded loop would hold the GPS on indefinitely
 * for a user who is indoors — a battery bug traded for a feed bug. If none of
 * these lands, the AppState recovery takes over and costs nothing until the
 * user returns to the app.
 */
const FIX_RETRY_DELAYS_MS = [0, 1_500, 4_000, 8_000] as const;

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
  // The SAME fact as the ref, in reactive form. The ref exists so callbacks can
  // read it without re-creating; this exists so effects can DEPEND on it. Both
  // are set together in notePermission and must never diverge.
  const [hasPermission, setHasPermission] = useState(false);

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
      setHasPermission(true);
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
      // PHASE TIMING. The startup trace narrowed the cold start to ~3.2s spent
      // between session and location, and reading the cached fix first only
      // took half of that off. A guess at the rest (the reverse geocode) was
      // measured and proved wrong, so this splits the phase into its actual
      // steps rather than inviting another guess. Durations only — no
      // coordinates (docs/LOGGING.md).
      const startedAt = Date.now();
      const granted = requestPermission
        ? await dev.requestPermission()
        : await dev.hasPermission();
      const permissionMs = Date.now() - startedAt;
      notePermission(granted);
      if (!granted) {
        return false;
      }
      const positionStartedAt = Date.now();
      const coord = await dev.getCurrentPosition();
      const positionMs = Date.now() - positionStartedAt;
      log.info('location_phase', {
        permissionMs,
        positionMs,
        totalMs: Date.now() - startedAt,
        located: coord != null,
      });
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
      // Times the two things standing between session_ready and location_ready
      // that are NOT location work: how late this effect runs, and the
      // AsyncStorage read it opens with. applyDeviceFix itself measured 337ms
      // against a ~3,300ms phase, so the cost is one of these.
      const effectAt = Date.now();
      const pref = await loadFeedLocationPref();
      log.info('location_chain', {
        prefReadMs: Date.now() - effectAt,
        hadPref: pref != null,
      });
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
        // reads as broken. The granted-but-fixless case is then owned by the
        // stranded-state retry below.
        //
        // That last sentence used to read "the retries below cover it anyway",
        // and it was false: nothing retried, which is exactly how the feed got
        // stuck on national for a whole session. Do not weaken it back into a
        // claim without checking the effect it names still exists.
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
    // The ANSWER, and ONLY the answer: an allow is an allow, and the card must
    // go the moment it happens rather than when a fix arrives. Attempting the
    // fix is no longer this effect's job — see the retry below, which owns
    // every post-grant attempt so there is one place that can give up.
    notePermission(true);
  }, [grantedAtStartup, notePermission]);

  // THE STRANDED STATE: permission granted, but still national because no fix
  // has landed. This is the whole first-run bug — on a first-ever grant the OS
  // has no cached position for the app, so the immediate attempt loses its race
  // with cold GPS and returns nothing.
  //
  // It used to be a dead end. The single post-grant attempt discarded its
  // result, its effect could never re-run (none of its deps could change
  // again), and the AppState recovery below was armed only while the primer
  // was VISIBLE — which the same `notePermission(true)` had just hidden. The
  // latch that retires the card was also the latch that disarmed the retry, so
  // the feed stayed on "Recent posts across the UK" for the rest of the
  // session and only came right on the NEXT launch, once the OS had a fix to
  // hand back instantly. Hence "only on first start".
  //
  // Bounded on purpose: each attempt already races a 10s timeout inside
  // getCurrentPosition, so this is at most three cold-GPS reads and then it
  // stops. A feed quietly polling GPS forever is a battery bug, and the
  // AppState path below is the honest catch-all for the rest.
  useEffect(() => {
    if (!hasPermission || locationMode !== 'national') {
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const tryFix = async () => {
      if (cancelled) {
        return;
      }
      const located = await applyDeviceFix(false);
      // A success flips locationMode to 'local', which tears this effect down
      // through its own dependency — no explicit stop needed.
      if (located || cancelled) {
        return;
      }
      attempt += 1;
      if (attempt >= FIX_RETRY_DELAYS_MS.length) {
        log.info('location_retry_exhausted', { attempts: attempt });
        return;
      }
      timer = setTimeout(() => void tryFix(), FIX_RETRY_DELAYS_MS[attempt]);
    };

    timer = setTimeout(() => void tryFix(), FIX_RETRY_DELAYS_MS[0]);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [hasPermission, locationMode, applyDeviceFix]);

  // Last recovery path: permission granted OUTSIDE the app — in Settings,
  // after a hard OS block — reaches us no other way, and coming back to a feed
  // still begging for a permission you just granted is the same broken read.
  // Armed only while the card is actually up, so the settled case costs
  // nothing; primitive dep (the boolean), never the location object.
  //
  // ARMED ON TWO CONDITIONS, not one. The primer being up is the original
  // case. The second — granted-but-still-national — is the stranded state
  // above, and it is armed SEPARATELY because the primer is hidden exactly
  // then: conflating "is the card showing" with "could we still be local"
  // is what made this recovery unreachable in the case that needed it most.
  // Once the bounded retry gives up, coming back to the app is what rescues
  // the session, and a user who wandered off to Settings gets a fix on return.
  useEffect(() => {
    const stranded = hasPermission && locationMode === 'national';
    if (!showLocationPrimer && !stranded) {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        return;
      }
      void applyDeviceFix(false);
    });
    return () => subscription.remove();
  }, [showLocationPrimer, hasPermission, locationMode, applyDeviceFix]);

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

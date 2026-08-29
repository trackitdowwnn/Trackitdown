/**
 * WHAT:  AlertZoneThumb — the small square on an alert row: the zone drawn as a
 *        plate, with a non-interactive map fading in over it when one is
 *        available.
 * WHY:   An alert is a place, and the list used to show five identical grey
 *        text blocks. Airbnb's card anatomy leads with the picture and keeps
 *        the copy restrained around it; a zone map is the closest thing an
 *        alert has to a photograph.
 *
 *        ⚠️ THE PLATE IS ALWAYS RENDERED, AND THE MAP SITS ON TOP OF IT. That
 *        is the whole design, not a fallback bolted on: there is no state in
 *        which the user sees a broken or empty square, because there is no
 *        state in which the map is the only thing there. It covers the first
 *        frame before tiles land, a missing API key, Expo Go on Android,
 *        offline, web, and the kill switch below — one code path for all six.
 *
 *        ⚠️ liteMode IS WHY THIS IS DEFENSIBLE ON ANDROID. Google ships lite
 *        mode for maps in a stream and its own sample puts them in a list: it
 *        draws a BITMAP rather than driving the vector renderer. That also
 *        answers MapCornerMask's open question for this card — a bitmap in an
 *        ordinary view can be clipped with overflow:'hidden', unlike the
 *        GLSurfaceView that file exists to work around. Circles and JSON
 *        customMapStyle both survive lite mode, so the dark-mode contract in
 *        AppMap's header still holds.
 *
 *        ⚠️ iOS HAS NO LITE MODE, and that is the residual risk. Up to
 *        MAX_ALERTS_PER_USER real map views can exist at once. The count is
 *        bounded by product rule — the usual "never put maps in a list"
 *        objection is about unbounded lists — and the focus gate below drops
 *        them while the wizard is on top. Measure on a device; if it bites,
 *        SHOW_MAP is one line.
 *
 *        A STATIC TILE IMAGE was considered and rejected: the Google Maps keys
 *        are build-time native and application-restricted, which the Static
 *        Maps web API rejects outright, so it would need either a public
 *        scrapeable key or an Edge Function proxy — and Static Maps has no
 *        circle primitive, so the radius would become a hand-encoded polyline.
 * LINKS: ./AlertZoneGlyph.tsx (the plate); ./AlertCard.tsx (the only consumer);
 *        src/shared/ui/AppMap.tsx (interactive / liteMode / onReady);
 *        src/features/vehicles/components/LastSeenMap.tsx (static-preview
 *        precedent); src/shared/ui/MapCornerMask.tsx (the question lite mode
 *        answers).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { milesToMetres } from '@/shared/lib/distance';
import { motion, radii, sizes, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { AppMap, AppMapCircle } from '@/shared/ui/AppMap';

import { AlertZoneGlyph } from './AlertZoneGlyph';

/**
 * The kill switch. False renders the plate for every row, with no other edit
 * anywhere — the plate is already the bottom layer.
 *
 * A module constant rather than a prop: this answers "does this platform render
 * several clipped map views correctly", which is a fleet-wide question, not a
 * per-row one.
 */
const SHOW_MAP = true;

/**
 * Span drawn around the point, in degrees, before the radius is fitted.
 *
 * ⚠️ THE CIRCLE IS FITTED, NOT THE SPAN FIXED. A constant span would draw a
 * 1-mile and a 50-mile zone at wildly different apparent sizes — the 50-mile
 * one filling the tile and clipping. Fitting each zone to its own circle keeps
 * the ring at a constant fraction of the square, so the tile always reads as "a
 * zone around a point" and the radius stays where it is already stated in
 * words, on the line below.
 *
 * 1.5 rather than LocationPicker's private 1.3: at 72pt the ring needs more
 * basemap around it to read as a place rather than a circle on beige.
 */
const FIT_PADDING = 1.5;
/** Degrees of latitude per mile — the same approximation mapRegion.ts uses. */
const DEGREES_PER_MILE = 1 / 69;

export interface AlertZoneThumbProps {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  /** Paused zone: the circle stays (the area is still theirs) but recedes. */
  dimmed?: boolean;
  testID?: string;
}

export function AlertZoneThumb({
  latitude,
  longitude,
  radiusMiles,
  dimmed = false,
  testID,
}: AlertZoneThumbProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [ready, setReady] = useState(false);
  const reduceMotion = useReducedMotion();
  // ⚠️ Drops the native maps while the wizard is on top. Every route out of the
  // list pushes OVER it, so without this five map views stay alive for the
  // whole of creating or editing an alert. The plate stays put, so a blurred
  // and a focused row look identical until tiles land again.
  //
  // `useFocusEffect` rather than `useIsFocused`: @react-navigation/native is
  // not a direct dependency here, and expo-router's re-export is what the rest
  // of the app already uses.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        // Re-arm the fade: a remounted map fires onReady again, and without
        // this the layer would already be at opacity 1 over a blank map.
        setReady(false);
      };
    }, []),
  );

  // The map fades in over the plate once it actually has tiles. Without the
  // gate it pops in over a circle that is already there, which reads as a
  // glitch rather than as loading — and `onReady` never fires at all when the
  // SDK cannot start, which is precisely when the plate must stay.
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!ready) {
      opacity.value = 0;
      return;
    }
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: motion.fast });
  }, [ready, reduceMotion, opacity]);
  const mapStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const drawable =
    SHOW_MAP &&
    Platform.OS !== 'web' &&
    focused &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  // ⚠️ MEMOISED, and not for render cost. AppMap's fly-to effect depends on the
  // region's IDENTITY (AppMap.tsx), so a fresh object every render re-runs it —
  // and its `shownRef` holds the region Google SETTLED on, which is not the one
  // requested once a square viewport re-fits the bounds, so the epsilon guard
  // can miss and fire animateToRegion. Android lite mode cannot animate its
  // camera at all. One stable object per (point, span) and the effect never
  // runs after mount.
  const region = useMemo(() => {
    const span = Math.max(radiusMiles, 0.5) * 2 * FIT_PADDING * DEGREES_PER_MILE;
    return { latitude, longitude, latitudeDelta: span, longitudeDelta: span };
  }, [latitude, longitude, radiusMiles]);

  return (
    // Decorative: the card already names the alert and reads its summary, and
    // a screen reader announcing "image" between them adds nothing.
    <View
      style={styles.frame}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AlertZoneGlyph dimmed={dimmed} />

      {drawable ? (
        // pointerEvents none, not an overlay Pressable: it propagates to every
        // descendant, so the map can neither take the card's press nor fight
        // the list's scroll. `interactive={false}` turns the gestures off too —
        // both, because the second is what the other static cards rely on.
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, mapStyle]}>
          <AppMap
            interactive={false}
            liteMode
            onReady={() => setReady(true)}
            region={region}
            // instant: the region never changes after mount, so there is no
            // fly-to to animate and AppMap's effect never fires.
            animateDurationMs={motion.instant}
            onRegionChangeStart={() => {}}
            onRegionChangeComplete={() => {}}
          >
            <AppMapCircle
              center={{ latitude, longitude }}
              radius={milesToMetres(radiusMiles)}
              fillColor={dimmed ? 'transparent' : palette.mapZoneFill}
              strokeColor={palette.mapZoneStroke}
              strokeWidth={1}
            />
          </AppMap>
        </Animated.View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    frame: {
      width: sizes.alertThumb,
      height: sizes.alertThumb,
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
  });

/**
 * WHAT:  LocationPicker — an Airbnb-style map location selector. The pin is
 *        FIXED at the map's centre; the user pans the map underneath it and the
 *        centre IS the value. A floating pill reads back the reverse-geocoded
 *        address and doubles as a search box; an optional bottom card carries a
 *        privacy toggle. Ships embedded (for wizard steps) and as a full-screen
 *        LocationPickerModal (own Confirm) for standalone use.
 * WHY:   Two features need "pick a point on a map": the posting wizard's "where
 *        did you last see it?" step and the spotter's alert-location setting.
 *        Design decisions baked in:
 *        - The map is INJECTED (`MapComponent`), not imported. No map SDK
 *          exists in the repo yet, so the picker owns all the chrome + the
 *          moving/settled state machine and renders whatever map surface it's
 *          given. That keeps this file free of native modules (unit-testable)
 *          and lets react-native-maps drop in later behind one interface.
 *        - Geocoding + current position are INJECTED via `locationServices`
 *          (default: a graceful no-op). The real expo-location adapter is
 *          opt-in at src/shared/lib/location. Reverse geocoding is debounced
 *          off the settle and never blocks the pan — panning stays 60fps and a
 *          network hiccup falls back to "Pin location will be used" with the
 *          value STILL valid (a hiccup must never block someone mid-post).
 *        - `isSettled` is the validity gate: a never-touched default map is not
 *          settled, so the wizard's Next stays disabled until the user actually
 *          pans, searches, or locates. Plug the emitted value into a wizard
 *          answers slice and gate with `settledLocationSchema`.
 *        - The pan is a visual-only interaction, so the SEARCH path is the
 *          accessible path: the pill opens search, address changes announce
 *          politely (once per settle, never per pan frame).
 * LINKS: docs/DESIGN_SYSTEM.md (Map screens, Motion, Accessibility);
 *        src/shared/types/location.ts (injected contracts + LocationValue);
 *        src/shared/lib/location/expoLocationServices.ts (real adapter, opt-in);
 *        src/shared/ui/{BottomSheet,TextField,Button}.tsx.
 *
 * Usage:
 *   <LocationPicker
 *     MapComponent={AppMap}
 *     locationServices={expoLocationServices}
 *     onLocationChange={(v) => setAnswers((a) => ({ ...a, lastSeen: v }))}
 *   />
 */

import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useAnimatedValue,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { colors, motion, opacity, radii, shadows, sizes, spacing, typography } from '../theme';
import type {
  ForwardGeocodeResult,
  GeoCoord,
  GeoRegion,
  LocationServices,
  LocationValue,
} from '../types';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';
import { TextField } from './TextField';

/**
 * Props the injected map surface receives. It renders a full-bleed map at the
 * given `region` and reports USER gestures only — programmatic `region`
 * changes (search/locate) must NOT echo back as onRegionChange* (the real
 * adapter suppresses events while animating), so the picker never loops.
 */
export interface MapComponentProps {
  region: GeoRegion;
  /** Duration for the next programmatic region change: 0 snaps, >0 animates. */
  animateDurationMs: number;
  /** User began panning/zooming — badge lifts, pill shimmers. */
  onRegionChangeStart: () => void;
  /** User let go — the centre settled here. */
  onRegionChangeComplete: (region: GeoRegion) => void;
}

export type LocationPickerMap = ComponentType<MapComponentProps>;

/** Bottom overlay card config (Airbnb-style). Omit to hide the card entirely. */
export interface LocationOptionSlot {
  title: string;
  caption?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

export interface LocationPickerProps {
  /** The map surface to render (injected; see MapComponentProps). */
  MapComponent: LocationPickerMap;
  /** Geocoding + current position. Defaults to a graceful no-op. */
  locationServices?: LocationServices;
  /** Starting centre. If set, the picker starts SETTLED (a known point). */
  initialLocation?: GeoCoord | null;
  onLocationChange?: (value: LocationValue) => void;
  /** Bottom option card; hidden entirely when omitted. */
  optionSlot?: LocationOptionSlot;
  /** Pill copy shown before the first settle. */
  promptLabel?: string;
  /** Show the circular "use my current location" button. */
  showCurrentLocationButton?: boolean;
}

/** No map, no address, no position — just enough to render and stay valid. */
export const noopLocationServices: LocationServices = {
  async reverseGeocode() {
    return null;
  },
  async forwardGeocode() {
    return [];
  },
  async getCurrentPosition() {
    return null;
  },
};

/** Whole-UK view: the fallback when there's no initial or current location, so
 *  the user MUST pan/search to their area (and the value stays un-settled). */
export const UK_DEFAULT_REGION: GeoRegion = {
  latitude: 54.0,
  longitude: -2.5,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

/** ~1km span — the street-level zoom a chosen point drops to. */
const STREET_DELTA = 0.01;

/** Reverse-geocode fires this long after the map settles (never during pan). */
const GEOCODE_DEBOUNCE_MS = 400;
/** Forward-geocode (search) fires this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
/** Badge lift on pan-start — just under motion.fast, per the spec's ~150ms. */
const BADGE_LIFT_MS = 150;
/** How far the badge rises off its pin while the map moves. */
const BADGE_LIFT_DISTANCE = spacing.sm;
/** Badge grows slightly as it lifts. */
const BADGE_LIFT_SCALE = 1.06;

const BADGE_SIZE = sizes.touchTarget; // ~44pt dark circle
const STEM_HEIGHT = spacing.sm;
/** Hairline width of the pin's stem. */
const STEM_WIDTH = 2;
const DOT_SIZE = spacing.sm;
/** Raise the whole pin so the stem's DOT (not the group's centre) marks the
 *  precise point at the card's exact centre. */
const PIN_TIP_OFFSET = (BADGE_SIZE + STEM_HEIGHT + DOT_SIZE) / 2 - DOT_SIZE / 2;

const RESOLVING_LABEL = 'Finding address…';
const GEOCODE_FAILED_LABEL = 'Pin location will be used';
const DEFAULT_PROMPT = 'Move the map to the last place you saw it';
const LOCATION_UNAVAILABLE_HINT = "Couldn't find your location";
/** Placeholder rows shown while a search is in flight (skeleton, no spinner). */
const SEARCH_SKELETON_KEYS = ['a', 'b', 'c'];

/** Zod shape of the emitted value — plug straight into a wizard answers slice. */
export const locationValueSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  addressLabel: z.string(),
  isSettled: z.boolean(),
});

/** Wizard gate: a location is only valid once the user has settled on one. */
export const settledLocationSchema = locationValueSchema.refine((value) => value.isSettled, {
  message: 'Choose where it was last seen',
});

function regionFor(coord: GeoCoord): GeoRegion {
  return { ...coord, latitudeDelta: STREET_DELTA, longitudeDelta: STREET_DELTA };
}

export function LocationPicker({
  MapComponent,
  locationServices = noopLocationServices,
  initialLocation = null,
  onLocationChange,
  optionSlot,
  promptLabel = DEFAULT_PROMPT,
  showCurrentLocationButton = true,
}: LocationPickerProps) {
  const [region, setRegion] = useState<GeoRegion>(() =>
    initialLocation ? regionFor(initialLocation) : UK_DEFAULT_REGION,
  );
  const [animateMs, setAnimateMs] = useState(0);
  const [isMoving, setIsMoving] = useState(false);
  const [hasSettled, setHasSettled] = useState(initialLocation != null);
  const [addressLabel, setAddressLabel] = useState<string | null>(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [locateHint, setLocateHint] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ForwardGeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSheetRef = useRef<BottomSheetRef>(null);

  // Refs so async callbacks read the latest props without re-subscribing the
  // map. Kept fresh in an effect (never assigned during render).
  const servicesRef = useRef(locationServices);
  const onChangeRef = useRef(onLocationChange);
  useEffect(() => {
    servicesRef.current = locationServices;
    onChangeRef.current = onLocationChange;
  });

  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeReq = useRef(0);
  const searchReq = useRef(0);
  const lastEmitted = useRef<string>('');
  const locateHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Emit only on a real change, so parents don't churn on identical values. */
  const emit = useCallback((coord: GeoCoord, label: string, settled: boolean) => {
    const value: LocationValue = {
      latitude: coord.latitude,
      longitude: coord.longitude,
      addressLabel: label,
      isSettled: settled,
    };
    const key = `${value.latitude}|${value.longitude}|${value.addressLabel}|${value.isSettled}`;
    if (key === lastEmitted.current) {
      return;
    }
    lastEmitted.current = key;
    onChangeRef.current?.(value);
  }, []);

  const runGeocode = useCallback(
    async (coord: GeoCoord) => {
      const reqId = ++geocodeReq.current;
      setIsResolving(true);
      try {
        const label = await servicesRef.current.reverseGeocode(coord);
        if (reqId !== geocodeReq.current) {
          return; // a newer settle superseded this resolve
        }
        if (label) {
          setAddressLabel(label);
          setGeocodeFailed(false);
          // Announce the settled address ONCE — the a11y counterpart to the
          // visual pin, never per pan frame. This is the single announcement
          // strategy (the pill carries no live region), so it fires on both
          // platforms and skips the transient "Finding address…" state.
          AccessibilityInfo.announceForAccessibility(label);
          emit(coord, label, true);
        } else {
          // No address, but the coordinates are fine — value stays valid.
          setAddressLabel(null);
          setGeocodeFailed(true);
          AccessibilityInfo.announceForAccessibility(GEOCODE_FAILED_LABEL);
          emit(coord, '', true);
        }
      } catch {
        if (reqId !== geocodeReq.current) {
          return;
        }
        // Network hiccup must never block the post: keep the value valid.
        setAddressLabel(null);
        setGeocodeFailed(true);
        AccessibilityInfo.announceForAccessibility(GEOCODE_FAILED_LABEL);
        emit(coord, '', true);
      } finally {
        if (reqId === geocodeReq.current) {
          setIsResolving(false);
        }
      }
    },
    [emit],
  );

  const scheduleGeocode = useCallback(
    (coord: GeoCoord) => {
      if (geocodeTimer.current) {
        clearTimeout(geocodeTimer.current);
      }
      geocodeTimer.current = setTimeout(() => runGeocode(coord), GEOCODE_DEBOUNCE_MS);
    },
    [runGeocode],
  );

  // Emit the initial value once; geocode it only if we started settled.
  useEffect(() => {
    const settled = initialLocation != null;
    emit(region, '', settled);
    if (settled) {
      scheduleGeocode(region);
    }
    return () => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (locateHintTimer.current) clearTimeout(locateHintTimer.current);
    };
    // Mount-only: initial region/emit are seeded from the first props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegionChangeStart = useCallback(() => {
    setIsMoving(true);
    // A fresh pan invalidates any pending/in-flight resolve for the old point.
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeReq.current++;
  }, []);

  const handleRegionChangeComplete = useCallback(
    (next: GeoRegion) => {
      setRegion(next);
      setAnimateMs(0); // subsequent user pans are already on-screen, never animate
      setIsMoving(false);
      setHasSettled(true);
      // Flip validity immediately (label may still be resolving) so Next
      // unlocks without waiting on the network. Label emits empty until known.
      emit(next, '', true);
      scheduleGeocode(next);
    },
    [emit, scheduleGeocode],
  );

  /** Move the camera to a point programmatically (search pick / locate). */
  const moveTo = useCallback(
    (coord: GeoCoord, options?: { label?: string }) => {
      const next = regionFor(coord);
      geocodeReq.current++; // supersede anything in flight
      setAnimateMs(motion.mapFly);
      setRegion(next);
      setIsMoving(false);
      setHasSettled(true);
      if (options?.label) {
        // Optimistic: show the picked label at once; the debounced reverse
        // geocode may refine it.
        setAddressLabel(options.label);
        setGeocodeFailed(false);
        AccessibilityInfo.announceForAccessibility(options.label);
        emit(next, options.label, true);
      } else {
        emit(next, '', true);
      }
      scheduleGeocode(next);
    },
    [emit, scheduleGeocode],
  );

  const runSearch = useCallback(async (query: string) => {
    const reqId = ++searchReq.current;
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      // TODO(oliver): swap expo-location's coords-only geocodeAsync for Google
      // Places Autocomplete here for richer, labelled suggestions.
      const results = await servicesRef.current.forwardGeocode(query);
      if (reqId !== searchReq.current) return;
      setSearchResults(results);
    } catch {
      if (reqId !== searchReq.current) return;
      setSearchResults([]);
    } finally {
      if (reqId === searchReq.current) setSearching(false);
    }
  }, []);

  const onSearchChange = (query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
  };

  const openSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    searchSheetRef.current?.open();
  };

  const pickResult = (result: ForwardGeocodeResult) => {
    searchSheetRef.current?.close();
    moveTo(result, { label: result.label });
  };

  const onUseCurrentLocation = async () => {
    const coord = await servicesRef.current.getCurrentPosition();
    if (coord) {
      moveTo(coord);
      return;
    }
    // Denied or unavailable: degrade gracefully with a brief, announced hint.
    AccessibilityInfo.announceForAccessibility(LOCATION_UNAVAILABLE_HINT);
    setLocateHint(true);
    if (locateHintTimer.current) clearTimeout(locateHintTimer.current);
    locateHintTimer.current = setTimeout(() => setLocateHint(false), 2500);
  };

  // --- Pin lift + pill shimmer -------------------------------------------
  const lift = useAnimatedValue(0);
  useEffect(() => {
    if (isMoving) {
      Animated.timing(lift, {
        toValue: 1,
        duration: BADGE_LIFT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      // Drop with a soft ease-out bounce.
      Animated.spring(lift, {
        toValue: 0,
        friction: 5,
        tension: 140,
        useNativeDriver: true,
      }).start();
    }
  }, [isMoving, lift]);

  const shimmer = useAnimatedValue(1);
  useEffect(() => {
    if (!isMoving && !isResolving) {
      shimmer.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: opacity.inactive,
          duration: motion.fast,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 1,
          duration: motion.fast,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      shimmer.setValue(1);
    };
  }, [isMoving, isResolving, shimmer]);

  const badgeTranslate = lift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -BADGE_LIFT_DISTANCE],
  });
  const badgeScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, BADGE_LIFT_SCALE] });

  // --- Pill text ----------------------------------------------------------
  let pillText: string;
  if (geocodeFailed) {
    pillText = GEOCODE_FAILED_LABEL;
  } else if (addressLabel) {
    pillText = addressLabel;
  } else if (hasSettled) {
    pillText = RESOLVING_LABEL;
  } else {
    pillText = promptLabel;
  }

  return (
    <View style={styles.root}>
      <View style={styles.mapCard}>
        <MapComponent
          region={region}
          animateDurationMs={animateMs}
          onRegionChangeStart={handleRegionChangeStart}
          onRegionChangeComplete={handleRegionChangeComplete}
        />

        {/* Overlay layer: box-none so pans reach the map; only real controls
            capture touches. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Address pill = readout AND search entry. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Location, ${pillText}, opens search`}
            onPress={openSearch}
            style={styles.pill}
          >
            <Feather name="map-pin" size={typography.body.fontSize} color={colors.primary} />
            {/* No live region here: settles are announced once explicitly (see
                runGeocode), which avoids re-announcing the transient
                "Finding address…" state on every pillText change. */}
            <Animated.Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[styles.pillText, { opacity: shimmer }]}
            >
              {pillText}
            </Animated.Text>
            <Feather name="search" size={typography.body.fontSize} color={colors.textSecondary} />
          </Pressable>

          {/* Fixed centre pin. Non-interactive; the dot marks the exact point. */}
          <View style={styles.pinLayer} pointerEvents="none">
            <View style={styles.pinGroup}>
              <Animated.View
                style={[
                  styles.badge,
                  isMoving ? shadows.lifted : shadows.soft,
                  { transform: [{ translateY: badgeTranslate }, { scale: badgeScale }] },
                ]}
              >
                <MaterialCommunityIcons
                  name="car"
                  size={typography.heading.fontSize}
                  color={colors.textOnPrimary}
                />
              </Animated.View>
              <View style={styles.stem} />
              <View style={styles.dot} />
            </View>
          </View>

          {/* Bottom stack: locate button above the (optional) option card. */}
          <View style={styles.bottomStack} pointerEvents="box-none">
            {showCurrentLocationButton ? (
              <View style={styles.locateRow} pointerEvents="box-none">
                {locateHint ? (
                  <View style={styles.hint}>
                    <Text style={styles.hintText}>{LOCATION_UNAVAILABLE_HINT}</Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Use my current location"
                  onPress={onUseCurrentLocation}
                  style={({ pressed }) => [styles.locateButton, pressed && styles.locatePressed]}
                >
                  <Feather name="navigation" size={typography.heading.fontSize} color={colors.primary} />
                </Pressable>
              </View>
            ) : null}

            {optionSlot ? (
              <View style={styles.optionCard}>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{optionSlot.title}</Text>
                  {optionSlot.caption ? (
                    <Text style={styles.optionCaption}>{optionSlot.caption}</Text>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel={optionSlot.title}
                  value={optionSlot.value}
                  onValueChange={optionSlot.onValueChange}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor={colors.surface}
                  ios_backgroundColor={colors.border}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Search sheet (accessible path for the visual pan). */}
      <BottomSheet ref={searchSheetRef} title="Search for a place">
        <TextField
          label="Search"
          placeholder="Street, area or postcode"
          value={searchQuery}
          onChangeText={onSearchChange}
          autoFocus
        />
        <View style={styles.results}>
          {searching
            ? // Skeleton placeholders while results load (no spinners on lists).
              SEARCH_SKELETON_KEYS.map((key) => <View key={key} style={styles.resultSkeleton} />)
            : searchResults.map((result, index) => (
                <Pressable
                  key={`${result.latitude},${result.longitude},${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={result.label}
                  onPress={() => pickResult(result)}
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                >
                  <Feather
                    name="map-pin"
                    size={typography.body.fontSize}
                    color={colors.textSecondary}
                  />
                  <Text numberOfLines={1} style={styles.resultLabel}>
                    {result.label}
                  </Text>
                </Pressable>
              ))}
          {searchQuery.trim() && !searching && searchResults.length === 0 ? (
            <Text style={styles.resultsEmpty}>No matches — try a nearby street or postcode.</Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}

export interface LocationPickerModalProps extends LocationPickerProps {
  visible: boolean;
  onConfirm: (value: LocationValue) => void;
  onCancel: () => void;
  /** Footer CTA label. */
  confirmLabel?: string;
  /** Optional header title. */
  title?: string;
}

/**
 * Full-screen wrapper for standalone use (e.g. alert-location settings) where
 * there's no wizard footer to commit the value. Renders LocationPicker with its
 * own Confirm, enabled only once a location is settled.
 */
export function LocationPickerModal({
  visible,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm location',
  title,
  onLocationChange,
  ...pickerProps
}: LocationPickerModalProps) {
  const [current, setCurrent] = useState<LocationValue | null>(null);

  const handleChange = (value: LocationValue) => {
    setCurrent(value);
    onLocationChange?.(value);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.modalRoot} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={styles.modalClose}
          >
            <Feather name="x" size={typography.title.fontSize} color={colors.textPrimary} />
          </Pressable>
          {title ? (
            <Text numberOfLines={1} style={styles.modalTitle}>
              {title}
            </Text>
          ) : null}
          <View style={styles.modalClose} />
        </View>

        <View style={styles.modalBody}>
          <LocationPicker {...pickerProps} onLocationChange={handleChange} />
        </View>

        <View style={styles.modalFooter}>
          <Button
            label={confirmLabel}
            onPress={() => current && onConfirm(current)}
            disabled={!current?.isSettled}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  mapCard: {
    flex: 1,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceSubtle, // shows through until the map paints
    // Android's react-native-maps draws in a SurfaceView that renders solid
    // BLACK when a parent clips it with overflow:'hidden' + borderRadius. Clip
    // to the rounded card on iOS only; on Android the map keeps square corners
    // but actually renders. (Round it later via a mask if needed.)
    ...Platform.select({ ios: { overflow: 'hidden' as const }, default: {} }),
  },
  pill: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  pillText: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
  },
  pinLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGroup: {
    alignItems: 'center',
    transform: [{ translateY: -PIN_TIP_OFFSET }],
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stem: {
    width: STEM_WIDTH,
    height: STEM_HEIGHT,
    backgroundColor: colors.primary,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.primary,
  },
  bottomStack: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    gap: spacing.sm,
  },
  locateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  hint: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  locateButton: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: sizes.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  locatePressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  optionText: {
    flex: 1,
    gap: spacing.xs,
  },
  optionTitle: {
    ...typography.label,
    color: colors.textPrimary,
  },
  optionCaption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  results: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  resultRowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  resultLabel: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
  },
  resultsEmpty: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultSkeleton: {
    height: sizes.touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  modalClose: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    ...typography.heading,
    color: colors.textPrimary,
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  modalFooter: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
});

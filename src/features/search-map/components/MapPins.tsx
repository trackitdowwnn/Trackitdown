/**
 * WHAT:  MapPins — the search map's markers. Every car in view is a white £
 *        pill; the selected car's pill is swapped for a larger dark one.
 * WHY:   Airbnb's map, kept simple. Three ideas, and that is all of it:
 *          1. A pill is drawn ONCE. On Android a custom marker is a bitmap
 *             captured shortly after mount and then frozen, and every attempt
 *             to repaint a mounted one failed on device (late, stale, clipped).
 *             So anything a pill shows (price, theme, selected) is in its React
 *             key: a change is a new marker, never a repaint.
 *          2. Selection is a SWAP, not an overlay: the selected car has only
 *             its dark pill, so nothing can ever sit on top of it, and it takes
 *             the highest zIndex. (The overlay version put a white pill over
 *             the dark one whenever the paint order went wrong — see bountyZ.)
 *          3. Three Android rules keep the bitmap right — see TRANSPARENT_PIXEL,
 *             TRACK_MS and the collapsable wrapper below — and a fourth keeps
 *             paint order right: zIndex is read once, at creation (bountyZ).
 *        And a TAP IS CHECKED AGAINST THE FINGER: Google's enlarged marker
 *        tap areas let a tap select a neighbour, so a press selects the drawn
 *        pill under the touch instead (see handlePress / pillUnderFinger).
 *        Never a price-less pill: an empty marker reads as a group of cars
 *        (docs/DESIGN_SYSTEM.md). Overlapping pills are left to overlap.
 * LINKS: src/features/search-map/lib/mapPins.ts (pinsInView — which posts;
 *        pinAt — which pill a tap is on); src/shared/ui/AppMap.tsx
 *        (AppMapHandle — the touch and the projection); docs/DESIGN_SYSTEM.md.
 */

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import {
  mapPinFontScaleCap,
  radii,
  spacing,
  typography,
  useThemeControls,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { bountyLabel, NO_BOUNTY_LABEL } from '@/shared/ui';
import { AppMapMarker, type AppMapHandle } from '@/shared/ui/AppMap';

import { pinAt, type PinRect } from '../lib/mapPins';
import type { MapPost } from '../types';

const log = createLogger('search-map');

/** Android rule 1: how long a new marker re-captures its view before freezing.
 *  Freezing too early leaves Google's default red pin on screen for good. */
const TRACK_MS = 500;

/** Android rule 2: a 1×1 transparent PNG on every marker. With an image set,
 *  each capture goes into a fresh bitmap (without one, an early, empty capture
 *  can stick — "only an outline"), and an uncaptured marker shows nothing
 *  instead of the red pin. A data URI, so an OTA can ship it. */
const TRANSPARENT_PIXEL = {
  uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
} as const;

const CENTRE = { x: 0.5, y: 0.5 } as const;

/**
 * ⚠️ PAINT ORDER IS FIXED AT BIRTH. On Android (new architecture) react-native-
 * maps reads a marker's zIndex ONCE, when it is created — RNMapsMarker has no
 * zIndex setter (fabric/MarkerManager.java). So a zIndex must never depend on
 * anything that changes while the marker lives. A count-based one (cars in
 * view − position) went stale on zoom and put the dark pill UNDER a white one:
 * the "outline" and the "takes several taps", 2026-09-23.
 *
 * Derived from the price alone, which is in the key: bigger bounty on top,
 * no-reward at the bottom, never 0 (iOS Google markers drop a falsy zIndex).
 */
const SELECTED_Z = 1_000_000;
function bountyZ(bountyPence: number | null): number {
  return bountyPence === null ? 1 : 2 + Math.min(Math.floor(bountyPence / 100), SELECTED_Z - 3);
}

function pinZ(post: MapPost, selected: boolean): number {
  return selected ? SELECTED_Z : bountyZ(post.bountyPence);
}

type PillSize = { width: number; height: number };

/** Measured sizes are per drawn state: the dark pill is larger. */
function sizeKey(id: string, selected: boolean): string {
  return `${id}:${selected ? 'on' : 'off'}`;
}

/** Used until a pill has reported its layout — a typical "£1,250" pill. */
const UNMEASURED_PILL: PillSize = { width: 72, height: 28 };

/** A touch older than this is not the one behind the press being handled. */
const TOUCH_MAX_AGE_MS = 1500;

/** How long a press may wait for the map's projection before Google's pick
 *  stands. It normally answers within a frame. */
const PROJECTION_TIMEOUT_MS = 250;

/** What the finger check concluded: the drawn pill under the touch (null: on
 *  no pill — Google's pick stands), or why it could not check at all. */
type FingerCheck = { id: string | null } | { skipped: string };

/**
 * The drawn pill under `touch` — see MapPins' press handler. Never throws:
 * every failure is a `skipped` reason, and means "keep Google's pick".
 */
async function pillUnderFinger(
  map: AppMapHandle | null,
  touch: { x: number; y: number; at: number } | null,
  { posts, selectedPostId }: { posts: MapPost[]; selectedPostId: string | null },
  measured: Map<string, PillSize>,
): Promise<FingerCheck> {
  if (!map) {
    return { skipped: 'no-map' };
  }
  if (!touch || Date.now() - touch.at > TOUCH_MAX_AGE_MS) {
    return { skipped: 'no-touch' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const points = await Promise.race([
      Promise.all(
        posts.map((post) => map.pointFor({ latitude: post.latitude, longitude: post.longitude })),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('projection timed out')), PROJECTION_TIMEOUT_MS);
      }),
    ]);
    const rects: PinRect[] = posts.map((post, index) => {
      const selected = post.id === selectedPostId;
      const size = measured.get(sizeKey(post.id, selected)) ?? UNMEASURED_PILL;
      return { id: post.id, ...points[index], ...size, zIndex: pinZ(post, selected) };
    });
    return { id: pinAt(touch, rects) };
  } catch (error) {
    return { skipped: error instanceof Error ? error.message : 'projection failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** The word on the pill: the amount, or "No reward". Never empty. */
function pinText(bountyPence: number | null): string {
  return bountyPence === null ? NO_BOUNTY_LABEL : formatPounds(bountyPence);
}

/**
 * One pill. Memoised with stable props, so a tap re-renders only the pills it
 * swaps, not the hundred around them.
 */
const PricePin = memo(function PricePin({
  post,
  selected,
  zIndex,
  onPressPost,
  onMeasure,
}: {
  post: MapPost;
  selected: boolean;
  /** Read once by the native marker at creation — see bountyZ. */
  zIndex: number;
  onPressPost: (id: string) => void;
  /** The drawn pill's size, for deciding which pill a tap was on. */
  onMeasure: (key: string, size: PillSize) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), TRACK_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AppMapMarker
      coordinate={{ latitude: post.latitude, longitude: post.longitude }}
      anchor={CENTRE}
      image={TRANSPARENT_PIXEL}
      tracksViewChanges={tracking}
      zIndex={zIndex}
      onPress={() => onPressPost(post.id)}
      accessibilityRole="button"
      accessibilityLabel={`${bountyLabel(post.bountyPence)} — ${post.make} ${post.model}`}
      accessibilityState={{ selected }}
    >
      {/* Android rule 3: collapsable={false}. The marker sizes its bitmap from
          its first NATIVE child; a layout-only View is flattened away, which
          makes that the pill and clips it. It hugs the pill exactly, so the
          tap target is the pill and nothing more — see `pill` below. */}
      <View collapsable={false}>
        <View
          style={[styles.pill, selected && styles.pillSelected]}
          onLayout={(event) =>
            onMeasure(sizeKey(post.id, selected), {
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
        >
          <Text
            maxFontSizeMultiplier={mapPinFontScaleCap}
            style={[styles.text, selected && styles.textSelected]}
          >
            {pinText(post.bountyPence)}
          </Text>
        </View>
      </View>
    </AppMapMarker>
  );
});

export interface MapPinsProps {
  /** The pills to draw, highest bounty first (pinsInView). */
  posts: MapPost[];
  selectedPostId: string | null;
  onPressPost: (id: string) => void;
  /** The map these pills are on — lets a press be checked against where the
   *  finger really was. Without it, Google's pick stands. */
  map?: RefObject<AppMapHandle | null>;
}

export const MapPins = memo(function MapPins({
  posts,
  selectedPostId,
  onPressPost,
  map,
}: MapPinsProps) {
  // The theme is drawn too: a frozen pill would keep light colours on a dark map.
  const { scheme } = useThemeControls();

  // ⚠️ GOOGLE'S PICK IS CHECKED AGAINST THE FINGER. Google Maps gives every
  // marker a tap area larger than its drawn pill and hands an overlap to the
  // top marker (react-native-maps#4386, not configurable), so between two close
  // pills a tap on one selected the other ("the wrong marker is selected", the
  // owner, 2026-09-23). So a press asks: which DRAWN pill is under the last
  // touch? That one wins; where two pills overlap, the one painted on top —
  // the one you can see there. A tap on no pill keeps Google's pick, as does
  // anything that fails (no touch recorded, projection unavailable, too slow).
  const measured = useRef(new Map<string, PillSize>());
  const onMeasure = useCallback((key: string, size: PillSize) => {
    measured.current.set(key, size);
  }, []);
  // The press handler must stay one stable function (every pill is memoised
  // on it), so it reads the current posts through a ref.
  const current = useRef({ posts, selectedPostId });
  useEffect(() => {
    current.current = { posts, selectedPostId };
    // Forget the sizes of pills no longer drawn, so this stays one screenful.
    const drawn = new Set(posts.map((post) => post.id));
    for (const key of measured.current.keys()) {
      if (!drawn.has(key.slice(0, key.lastIndexOf(':')))) {
        measured.current.delete(key);
      }
    }
  }, [posts, selectedPostId]);

  // Bumped by every press AND on unmount: an answer only lands if nothing has
  // happened since — no newer press, and the screen still here.
  const pressToken = useRef(0);
  useEffect(
    () => () => {
      pressToken.current += 1;
    },
    [],
  );

  const handlePress = useCallback(
    (googleId: string) => {
      const token = ++pressToken.current;
      const handle = map?.current ?? null;
      const touch = handle?.lastTouch() ?? null;
      void pillUnderFinger(handle, touch, current.current, measured.current).then((check) => {
        if (token !== pressToken.current) {
          return; // a newer press, or the screen has gone
        }
        // A newer touch-down since this press — a map-background tap that has
        // already deselected, say. Answering now would undo it.
        if (touch !== null && handle?.lastTouch()?.at !== touch.at) {
          return;
        }
        if ('skipped' in check) {
          // Loud on purpose: a check that never runs looks exactly like one
          // that always agrees with Google.
          log.info('map_pin_tap_check_skipped', { reason: check.skipped });
        }
        const chosen = ('id' in check ? check.id : null) ?? googleId;
        if (chosen !== googleId) {
          log.info('map_pin_tap_corrected', { from: googleId, to: chosen });
        }
        onPressPost(chosen);
      });
    },
    [map, onPressPost],
  );

  return (
    <>
      {posts.map((post) => {
        const selected = post.id === selectedPostId;
        return (
          <PricePin
            // Everything the pill draws is in the key — see the header — so
            // selecting a car swaps its white pill for a new dark one.
            key={`${scheme}:${post.id}:${pinText(post.bountyPence)}:${selected ? 'on' : 'off'}`}
            post={post}
            selected={selected}
            zIndex={pinZ(post, selected)}
            onPressPost={handlePress}
            onMeasure={onMeasure}
          />
        );
      })}
    </>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  // ⚠️ THE PILL IS THE TAP BOX — nothing around it. A marker's tap area is
  // its whole bitmap, transparent pixels included, and Google Maps already
  // widens it past that (react-native-maps#4386). A 44×52 box around a 28pt
  // pill made taps land on cars a finger was nowhere near (the owner,
  // 2026-09-23: "the hit box is way larger than the marker"). So no min size,
  // no padding, and no shadow — Android never drew one on a marker, and on
  // iOS it needed a 16pt transparent margin that was tappable too. The
  // borderStrong hairline is what separates the pill from the land in both
  // themes (docs/DESIGN_SYSTEM.md).
  pill: {
    backgroundColor: c.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  // Selected: inverts and grows. surfaceInverse flips with the theme, so it
  // stays visible on the dark basemap.
  pillSelected: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: c.surfaceInverse,
    borderColor: c.surfaceInverse,
  },
  text: {
    ...typography.mapPin,
    color: c.accentText,
  },
  textSelected: {
    color: c.textOnPrimary,
  },
});

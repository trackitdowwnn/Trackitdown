/**
 * WHAT:  MapPins — the search map's markers. EVERY post in view gets the same
 *        BOUNTY PILL; the selected one inverts to the dark surface and grows.
 *        Clustering was removed 2026-08-06, and the price-less second tier that
 *        replaced it went on 2026-08-07.
 * WHY:   The second tier had to go because of what it SAID. A marker with no
 *        price on it reads as a group — there is nothing else it could be
 *        saying — so a demoted pin was quietly claiming to be several cars.
 *        The owner reported it as "grouping" four times before that landed.
 *        Overlapping pills are fine where overlapping dots were not: a pill has
 *        an edge and a number, so a pile of them still reads as a pile of
 *        prices (the reference does exactly this — docs/design-refs/map/).
 *
 *        Markers with custom views are the classic Android jank source. Each
 *        marker TRACKS view changes for a few frames after mount (so the
 *        custom view rasterises AFTER layout — setting tracksViewChanges
 *        false from frame 0 is the blank-marker trap), then stops tracking
 *        so it pans free.
 *
 *        RE-RASTERISING IS A PROP, NOT A KEY. Selection used to re-key the
 *        marker, remounting it to force the repaint; `retrackKey` re-arms
 *        tracking IN PLACE instead. It now carries selection alone — with one
 *        appearance there is nothing else that changes what is drawn — so the
 *        churn that made this mechanism necessary (a top-N set turning over on
 *        every pan) no longer exists.
 *
 *        Rank, paint order and the assistive-tech cap are decided in
 *        mapPins.pinsForRegion — this component is a dumb renderer of that.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapMarker re-export — the single
 *        react-native-maps import); src/features/search-map/lib/
 *        mapPins.ts (MapPinItem); docs/DESIGN_SYSTEM.md (tokens).
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib';
import { colors, mapPinFontScaleCap, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { AppMapMarker } from '@/shared/ui/AppMap';

import { AT_MARKER_LIMIT } from '../lib/mapPins';
import type { MapPinItem } from '../types';

/** How long a freshly-mounted marker keeps tracking view changes before it
 *  freezes — long enough for the custom view to lay out and rasterise. */
const TRACK_SETTLE_MS = 500;

/** The usual anchor: the marker box centred on its coordinate. Hoisted so an
 *  unshifted marker gets a stable object rather than a new one per render. */
const MARKER_CENTRE = { x: 0.5, y: 0.5 } as const;

/** Ceiling for marker paint order. Selection takes it; everything else sits
 *  below by bounty rank, floored at 1 (a falsy zIndex is dropped by the iOS
 *  Google marker when it re-creates). */
const MAX_PIN_Z = 200;

/** A marker that rasterises its custom child AFTER layout, then freezes. */
function TrackedMarker({
  latitude,
  longitude,
  onPress,
  accessibilityLabel,
  selected = false,
  accessible = true,
  anchor,
  zIndex,
  retrackKey,
  children,
}: {
  latitude: number;
  longitude: number;
  onPress: () => void;
  accessibilityLabel: string;
  /** false drops the marker from the assistive-tech tree — it stays tappable
   *  by sight, but the sheet's list is the AT path. See the call site. */
  accessible?: boolean;
  /** Where the box sits relative to the coordinate. Shifted only for markers
   *  a viewport edge would otherwise cut in half (see keepMarkersOnScreen). */
  anchor: { x: number; y: number };
  /** Paint order. Without it, up to a hundred sibling markers stack in an
   *  undefined order — and with every marker now a full-width pill, overlap is
   *  the normal case rather than the exception. */
  zIndex: number;
  /** Exposed to assistive tech: selection changes the pill's appearance, so
   *  it must be perceivable non-visually too. */
  selected?: boolean;
  /** Change this whenever the DRAWN content changes — selection is the only
   *  such change now — and the marker re-rasterises in place. See the header
   *  for why this is a prop rather than a key. */
  retrackKey: string;
  children: ReactNode;
}) {
  const [tracking, setTracking] = useState(true);
  // Re-arm DURING RENDER, not in an effect: setting state synchronously in an
  // effect body cascades renders (and the lint rule forbids it). This is the
  // adjust-state-on-prop-change pattern used elsewhere in the codebase.
  const [seenKey, setSeenKey] = useState(retrackKey);
  if (retrackKey !== seenKey) {
    setSeenKey(retrackKey);
    setTracking(true);
  }

  // Freeze a beat after each arming. Keyed on `tracking` so a re-arm restarts
  // the clock; the setState here is async (inside the timeout), which is the
  // sanctioned shape.
  useEffect(() => {
    if (!tracking) {
      return;
    }
    const timer = setTimeout(() => setTracking(false), TRACK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [tracking]);

  return (
    <AppMapMarker
      coordinate={{ latitude, longitude }}
      anchor={anchor}
      tracksViewChanges={tracking}
      zIndex={zIndex}
      onPress={onPress}
      accessible={accessible}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      {/* Transparent 44pt hit area around the drawn marker — markers don't
          honour hitSlop, so the touch target is this wrapper. */}
      <View style={styles.hitTarget}>{children}</View>
    </AppMapMarker>
  );
}

export interface MapPinsProps {
  pins: MapPinItem[];
  selectedPostId: string | null;
  onPressPost: (id: string) => void;
}

export const MapPins = memo(function MapPins({
  pins,
  selectedPostId,
  onPressPost,
}: MapPinsProps) {
  return (
    <>
      {pins.map((pin) => {
        const selected = pin.post.id === selectedPostId;
        return (
          <TrackedMarker
            // The key is the post id ALONE — see the header. Anything that
            // changes the drawn content goes through retrackKey instead.
            key={pin.key}
            selected={selected}
            // Selection on top, then HIGHEST BOUNTY FIRST. Under heavy overlap
            // paint order is what decides which marker a tap actually hits, and
            // between overlapping Android markers with equal zIndex that order
            // is undefined — so ranking it is not decoration. Never 0: the iOS
            // Google marker skips a falsy zIndex when it re-creates a marker.
            zIndex={selected ? MAX_PIN_Z : Math.max(1, MAX_PIN_Z - 1 - pin.rank)}
            // ⚠️ The DRAWN set and the REACHABLE set deliberately differ. Every
            // marker is drawn and tappable, but only the top few are individual
            // stops for a screen reader: without a cap that is up to a hundred
            // swipes to get past the map, and the sheet below lists every car
            // with more detail and a live count. That is the intended path, not
            // a consolation. The selected pin is always reachable.
            accessible={pin.rank < AT_MARKER_LIMIT || selected}
            anchor={pin.anchor ?? MARKER_CENTRE}
            retrackKey={String(selected)}
            // The car's OWN coordinates, always. A marker displaced to avoid
            // an overlap used to live here; it moved with the zoom, because a
            // constant on-screen gap needs a ground offset that grows as you
            // zoom out. Markers that slide around the map are worse than
            // markers that overlap.
            latitude={pin.post.latitude}
            longitude={pin.post.longitude}
            onPress={() => onPressPost(pin.post.id)}
            accessibilityLabel={`${formatPounds(pin.post.bountyPence)} bounty — ${pin.post.make} ${pin.post.model}`}
          >
            <View style={[styles.bountyPill, selected && styles.bountyPillSelected]}>
              <Text
                // Capped: an uncapped 14pt at the OS 200% setting doubles
                // every pill and buries the map. The full amount stays
                // scalable in the sheet list, the card, and the label below.
                maxFontSizeMultiplier={mapPinFontScaleCap}
                style={[styles.bountyText, selected && styles.bountyTextSelected]}
              >
                {formatPounds(pin.post.bountyPence)}
              </Text>
            </View>
          </TrackedMarker>
        );
      })}
    </>
  );
});

const styles = StyleSheet.create({
  // 44pt minimum touch target wrapping the smaller drawn marker.
  hitTarget: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ⚠️ The border is also a deliberate divergence — the reference's pill is
  // shadow-only. Same reason as the tone above: white on #EEEEEE land is
  // 1.09:1, and directly over a #FFFFFF road our own shadow is all that's
  // left. The hairline is what gives the pill an edge on this map style; if
  // mapStyle's land ever darkens, revisit it.
  bountyPill: {
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  // Selection GROWS as well as inverting (DESIGN_SYSTEM: "selected pin grows").
  // Tone alone stopped carrying it once clustering went: a field of near-black
  // dots makes near-black the map's dominant ink, so size and paint order have
  // to do the work. Costs no remount — it rides the existing retrackKey.
  bountyPillSelected: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    borderColor: colors.surfaceInverse,
  },
  bountyText: {
    // mapPin, not label: same size, one weight up. A pin has to hold its own
    // against map tiles and its overlapping neighbours.
    ...typography.mapPin,
    color: colors.accentText, // near-black bounty amount on the light pill
  },
  bountyTextSelected: {
    color: colors.textOnPrimary,
  },
});

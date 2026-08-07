/**
 * WHAT:  MapPins — the search map's markers: BOUNTY PILLS for the few
 *        highest-bounty posts in view (the reference's price-pin analogue;
 *        selected inverts to the dark surface) and MINI-PINS (the same lozenge
 *        with the price hidden) for the rest. Every post in view gets its own
 *        marker — clustering was removed 2026-08-06 and the pill/mini split
 *        de-clutters instead.
 * WHY:   Markers with custom views are the classic Android jank source. Each
 *        marker TRACKS view changes for a few frames after mount (so the
 *        custom view rasterises AFTER layout — setting tracksViewChanges
 *        false from frame 0 is the blank-marker trap), then stops tracking
 *        so it pans free.
 *
 *        RE-RASTERISING IS A PROP, NOT A KEY. Selection used to re-key the
 *        marker, remounting it to force the repaint. Emphasis (pill vs dot)
 *        changes far more often than selection — the top-N set churns on
 *        every pan — so keying on it would remount dozens of markers per pan
 *        and re-arm 500ms of tracking on each, which is precisely the jank
 *        this file exists to avoid. `retrackKey` re-arms tracking IN PLACE
 *        instead, and now carries selection too: one mechanism, no remounts.
 *        ⚠️ If a device ever shows blank markers on emphasis change, fall
 *        back to re-keying for SELECTION only (rare, one marker) and keeping
 *        retrackKey for emphasis.
 *
 *        Which posts get a pill is decided in mapPins.pinsForRegion — this
 *        component is a dumb renderer of that decision.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapMarker re-export — the single
 *        react-native-maps import); src/features/search-map/lib/
 *        mapPins.ts (MapPinItem); docs/DESIGN_SYSTEM.md (tokens).
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib';
import { colors, mapPinFontScaleCap, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { AppMapMarker } from '@/shared/ui/AppMap';

import type { MapPinItem } from '../types';

/** How long a freshly-mounted marker keeps tracking view changes before it
 *  freezes — long enough for the custom view to lay out and rasterise. */
const TRACK_SETTLE_MS = 500;

/** A marker that rasterises its custom child AFTER layout, then freezes. */
function TrackedMarker({
  latitude,
  longitude,
  onPress,
  accessibilityLabel,
  selected = false,
  accessible = true,
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
  /** Paint order. Without it, up to a hundred sibling markers stack in an
   *  undefined order and the SELECTED pin can end up behind a neighbouring
   *  dot — clustering used to keep the population small enough to hide this. */
  zIndex: number;
  /** Exposed to assistive tech: selection is load-bearing here — it is what
   *  reveals a demoted pin's price — so it must be perceivable non-visually. */
  selected?: boolean;
  /** Change this whenever the DRAWN content changes (selection, emphasis) and
   *  the marker re-rasterises in place. See the header for why this is a prop
   *  rather than a key. */
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
      anchor={{ x: 0.5, y: 0.5 }}
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
        // A selected mini is PROMOTED to a pill: a selected dot is nearly
        // invisible, and the card already carries the bounty, so the promotion
        // costs nothing and makes the selection findable at a glance.
        const showPill = pin.emphasis === 'full' || selected;
        return (
          <TrackedMarker
            // The key is the post id ALONE — see the header. Anything that
            // changes the drawn content goes through retrackKey instead.
            key={pin.key}
            selected={selected}
            // Selected above priced above demoted. This also biases taps in a
            // crowded field towards the markers worth tapping, now that up to
            // a hundred 44pt targets can overlap. Never 0 — the iOS Google
            // marker skips a falsy zIndex when it re-creates the marker.
            zIndex={selected ? 3 : pin.emphasis === 'full' ? 2 : 1}
            // A demoted pin is NOT an individual stop for assistive tech.
            // Clustering used to bound the marker count; without it a screen
            // reader would swipe through up to a hundred of these to reach the
            // sheet — which lists every one of them with more detail and a
            // live count. The priced pills and the selected pin stay reachable.
            accessible={pin.emphasis === 'full' || selected}
            retrackKey={`${selected}_${pin.emphasis}`}
            latitude={pin.post.latitude}
            longitude={pin.post.longitude}
            onPress={() => onPressPost(pin.post.id)}
            accessibilityLabel={`${formatPounds(pin.post.bountyPence)} bounty — ${pin.post.make} ${pin.post.model}`}
          >
            {showPill ? (
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
            ) : (
              <View style={styles.miniPin} testID="mini-pin" />
            )}
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
  // The demoted pin: presence without a price. A LOZENGE, not a dot — the
  // reference draws this as its price pill with the price hidden, so the two
  // read as one family rather than two kinds of object.
  //
  // ⚠️ DELIBERATE DIVERGENCE: the reference's is WHITE. Ours cannot be. Their
  // base map is mid-tone green, so a white mark separates from it; mapStyle.ts
  // paints our land #EEEEEE and our roads #FFFFFF, where white is 1.09:1 and
  // 1.0:1 — at 18×11 the shadow would be the entire mark, which is not a mark.
  // So we take the anatomy and keep our own ink.
  //
  // But textSecondary, NOT primary. Filling the DEMOTED tier with the map's
  // blackest ink inverted the hierarchy: the quiet tier outshouted the priced
  // pill, which is a white fill held by a hairline. The reference runs the
  // other way round — its quiet tier is the pale one and its loud tier carries
  // the dark type. #6A6A6A is 4.7:1 on the land and 5.4:1 over a white road,
  // comfortably past the 3:1 a graphic needs, while reading as the background
  // tier it is. Growing the selected pill was treating the symptom of this.
  //
  // The ring's job is SEPARATION, not contrast: pins that sit close but no
  // longer cluster would otherwise merge into a blob.
  miniPin: {
    width: sizes.mapPinMiniWidth,
    height: sizes.mapPinMiniHeight,
    borderRadius: radii.full,
    backgroundColor: colors.textSecondary,
    borderWidth: sizes.mapPinRing,
    borderColor: colors.surface,
    ...shadows.soft,
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

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
 *        ⚠️ RE-RASTERISING IS A PROP, NOT A KEY. Everything DRAWN goes
 *        through `retrackKey` — selection and the price — and re-arms
 *        tracking in place. NOTHING remounts the marker, and the React key is
 *        the post id alone.
 *
 *        ⚠️ THIS WAS TRIED THE OTHER WAY AND REVERTED, 2026-09-23. Selection
 *        was briefly folded into the KEY to guarantee a fresh bitmap, after
 *        pills the owner had tapped through came back dark and clipped. It
 *        did guarantee that, and it cost more than it bought: a remount
 *        DESTROYS the native marker and builds a new one, and a new marker
 *        shows react-native-maps' DEFAULT PIN until its custom view has
 *        rasterised. The owner saw exactly that — "the red marker flicker
 *        into view then back to the price marker" — and taps landing in the
 *        recreation window went nowhere, which is the "not registering
 *        clicks" half of the same report.
 *
 *        The clipping it was reaching for has a smaller cause and already has
 *        a smaller fix: the marker's FOOTPRINT used to change on selection
 *        (padding md/xs -> lg/sm), and a view that resizes while frozen is
 *        what strands a bitmap. The unselected pill now carries that
 *        difference as transparent margin, so the box is constant and there
 *        is nothing to strand. Keep that invariant and the in-place re-arm is
 *        enough; break it and no amount of re-arming will save this.
 *
 *        Rank must never enter either the key or `retrackKey`: it churns on
 *        every pan, and dozens of markers re-arming at once is the jank this
 *        component exists to avoid.
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
import { lightHaptic } from '@/shared/lib/haptics';
import {
  mapPinFontScaleCap,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { bountyLabel, NO_BOUNTY_LABEL } from '@/shared/ui';
import { AppMapMarker } from '@/shared/ui/AppMap';

import { AT_MARKER_LIMIT } from '../lib/mapPins';
import type { MapPinItem } from '../types';

/**
 * How long a marker keeps tracking view changes after it is armed — on mount,
 * and again whenever `retrackKey` changes — before it freezes.
 *
 * ⚠️ `tracksViewChanges` means "re-rasterise this custom view EVERY FRAME", so
 * this is not an idle wait: it is real bitmap work per marker, which is why
 * the mount is batched (useProgressivePins) rather than done in one commit.
 *
 * ⚠️ IT WAS SHORTENED AND PUT BACK, 2026-09-23. Freezing two frames after the
 * marker reported its own layout was smoother, and sometimes froze BEFORE the
 * native tracker had captured the custom view — which leaves react-native-maps'
 * DEFAULT PIN on screen, the red marker the owner saw flicker in. Layout is
 * necessary for the bitmap but not sufficient, and the cost of being early is
 * the one marker state this product has already been burned by: a pill that is
 * not a price reads as a cluster. 500ms is generous on purpose; the batching
 * is what keeps it affordable.
 */
const TRACK_SETTLE_MS = 500;

/** The usual anchor: the marker box centred on its coordinate. Hoisted so an
 *  unshifted marker gets a stable object rather than a new one per render. */
const MARKER_CENTRE = { x: 0.5, y: 0.5 } as const;

/** Ceiling for marker paint order. Selection takes it; everything else sits
 *  below by bounty rank, floored at 1 (a falsy zIndex is dropped by the iOS
 *  Google marker when it re-creates). */
const MAX_PIN_Z = 200;

/**
 * How far `shadows.soft` reaches past the pill it is cast from — its downward
 * offset plus its blur radius, which is the larger of the two directions and
 * so the one the marker box has to clear. See `hitTarget`.
 */
const SHADOW_BLEED = shadows.soft.shadowOffset.height + shadows.soft.shadowRadius;

/**
 * What a pin prints. Short by necessity — the pill sits on map tiles at a capped
 * font size, so "No reward" is already the longest thing it can carry. NEVER
 * empty: docs/DESIGN_SYSTEM.md forbids a price-less marker, because a pill with
 * nothing in it reads as a cluster rather than as a car offering no bounty.
 *
 * The word alone, not bountyLabel's full sentence — a pin has no room for
 * "bounty" after the amount. The spoken label DOES use the shared sentence.
 */
function pinBountyText(bountyPence: number | null): string {
  return bountyPence === null ? NO_BOUNTY_LABEL : formatPounds(bountyPence);
}

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
  /** Change this whenever the DRAWN content changes — selection, the price —
   *  and the marker re-rasterises IN PLACE. See the header for why this is a
   *  prop rather than a key. */
  retrackKey: string;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      {pins.map((pin) => {
        const selected = pin.post.id === selectedPostId;
        return (
          <TrackedMarker
            // ⚠️ SELECTION IS BACK IN THE KEY (2026-09-22), reversing the
            // 2026-08 decision recorded in the header. Re-arming
            // tracksViewChanges in place is the CHEAP repaint — and on
            // Android it is not a RELIABLE one: a marker whose appearance and
            // size both change can keep its previous bitmap and have it
            // clipped to the new bounds. Owner's screenshot: three pills the
            // map had been tapped through were still wearing their SELECTED
            // dark fill, each cut off where the smaller unselected box ended,
            // while an untouched pill beside them drew perfectly.
            //
            // Re-keying remounts the marker, so the native side builds a new
            // marker from a new bitmap and there is no stale-icon path at all.
            // The cost the old note feared does not apply here: it was written
            // about RANK, which churns on every pan and would remount dozens
            // of markers at once. Selection changes one or two per TAP.
            //
            // ⚠️ THE PRICE IS IN THE KEY FOR THE SAME REASON SELECTION IS:
            // it is DRAWN. A frozen marker keeps its bitmap, so an owner who
            // raised their reward had the new figure land in the React tree
            // and the OLD one stay on the map — a price that is wrong is worse
            // than one that is late, and this is the number people are
            // deciding on. Keyed on the rendered STRING rather than on
            // `bountyPence`, so a change that does not alter what is drawn
            // cannot remount anything.
            //
            // Cheap by construction: a reward changes when its owner edits it,
            // which is nothing like the per-pan churn rank would cause.
            // Anything NOT drawn — make, model, the a11y label, zIndex —
            // stays out, because React updates those props in place.
            key={pin.key}
            // Everything DRAWN, re-rasterised in place: selection (the fill
            // and the padding) and the price. Not the key — see the header.
            retrackKey={`${selected ? 'on' : 'off'}:${pinBountyText(pin.post.bountyPence)}`}
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
            // The car's OWN coordinates, always. A marker displaced to avoid
            // an overlap used to live here; it moved with the zoom, because a
            // constant on-screen gap needs a ground offset that grows as you
            // zoom out. Markers that slide around the map are worse than
            // markers that overlap.
            latitude={pin.post.latitude}
            longitude={pin.post.longitude}
            // A tick on the finger. A marker has no pressed state — it is a
            // native map overlay, not a Pressable — so until the card springs
            // up nothing acknowledges the tap at all, which is most of what
            // made selection feel unanswered. The same light tick the app
            // already gives a colour swatch, a watch toggle and a copied
            // plate; silent on a build without the module.
            onPress={() => {
              lightHaptic();
              onPressPost(pin.post.id);
            }}
            accessibilityLabel={`${bountyLabel(pin.post.bountyPence)} — ${pin.post.make} ${pin.post.model}`}
          >
            <View style={[styles.bountyPill, selected && styles.bountyPillSelected]}>
              <Text
                // Capped: an uncapped 14pt at the OS 200% setting doubles
                // every pill and buries the map. The full amount stays
                // scalable in the sheet list, the card, and the label below.
                maxFontSizeMultiplier={mapPinFontScaleCap}
                style={[styles.bountyText, selected && styles.bountyTextSelected]}
              >
                {/* NEVER blank. docs/DESIGN_SYSTEM.md: "never ship a price-less
                    map marker" — an empty pill reads as a cluster, not as a car
                    with no reward. A no-reward listing (ADR-0014) says so. */}
                {pinBountyText(pin.post.bountyPence)}
              </Text>
            </View>
          </TrackedMarker>
        );
      })}
    </>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  // 44pt minimum touch target wrapping the smaller drawn marker.
  //
  // ⚠️ THE PADDING IS THE MARKER'S SHADOW ROOM, NOT DECORATION. A marker's
  // children are rasterised to THIS VIEW'S BOUNDS, so anything drawn outside
  // them is cut off — and `shadows.soft` is drawn below the pill by its offset
  // plus its blur radius. The box is 44 and centres its child, so a selected
  // pill (18pt line + 8pt padding each side + 2pt border = 36) left 4pt under
  // it for 16pt of shadow, and the bottom of the marker came back clipped
  // (owner, on device, 2026-09-22). Unselected was clipped too — 8pt of 16 —
  // just less visibly, which is why it went unnoticed.
  //
  // SYMMETRIC, and that is load-bearing: the anchor is MARKER_CENTRE, so the
  // box's centre is what sits on the car's coordinate. Padding the bottom
  // alone would have bought the shadow its room by sliding every pill north
  // of the place it is reporting.
  //
  // Derived from the token rather than written as 16, so a change to
  // `shadows.soft` cannot silently start clipping again.
  hitTarget: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SHADOW_BLEED,
  },
  // ⚠️ The border is a deliberate divergence — the reference's pill is
  // shadow-only. The pill barely separates from the land by FILL in either
  // theme (surface-on-land is 1.16:1 light, 1.09:1 dark), so the edge is what
  // makes it a pill rather than floating text.
  //
  // borderStrong, not border (2026-08-10). The old note here ended "if
  // mapStyle's land ever darkens, revisit it" — dark mode darkened it, and this
  // is that revisit. `border` measured 1.08:1 against the dark land, and
  // `shadows.soft` casts a literal black that contributes nothing on dark
  // tiles, so the pill lost every edge it had at once. borderStrong is 3.55:1
  // on the dark land and 2.61:1 on the light one — which also fixes light,
  // where the old hairline was only 1.17:1 and the shadow was doing all the
  // work alone.
  // ⚠️ THE MARGIN RESERVES THE GROWTH, AND IT IS WHY THE PILL STOPS CLIPPING.
  // Selection swaps this padding for a larger one, which made the marker's
  // view — and so the bitmap Android rasterises it into — CHANGE SIZE on tap.
  // A marker whose icon resizes while it is being re-tracked comes back half
  // drawn; with pins overlapping, that reads as the selected one being cut in
  // half by its neighbours (owner, on device, 2026-09-22, after a first fix
  // that addressed the shadow and not this).
  //
  // So the unselected pill carries the difference as transparent margin: 4pt a
  // side, exactly the step from md/xs to lg/sm below. The DRAWN pill is
  // unchanged in both states and still grows on selection; the marker's outer
  // footprint never does, so the bitmap keeps its dimensions and there is
  // nothing to re-measure.
  bountyPill: {
    backgroundColor: c.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    margin: spacing.xs,
    borderWidth: 1,
    borderColor: c.borderStrong,
    ...shadows.soft,
  },
  // Selection GROWS as well as inverting (DESIGN_SYSTEM: "selected pin grows").
  // Tone alone stopped carrying it once clustering went: a field of near-black
  // dots makes near-black the map's dominant ink, so size and paint order have
  // to do the work. Costs the marker a remount (see the header): a fresh
  // bitmap is the only reliable way Android draws this state change.
  // surfaceInverse, NOT surfaceOverMedia: a pin sits on the BASEMAP, which is
  // themed (mapStyleFor), not on photography. On the dark basemap this flips to
  // near-white — a dark bubble on dark tiles measures ~1.2:1 and vanishes.
  bountyPillSelected: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    // The growth spends the margin above rather than adding to the footprint.
    margin: 0,
    backgroundColor: c.surfaceInverse,
    borderColor: c.surfaceInverse,
  },
  bountyText: {
    // mapPin, not label: same size, one weight up. A pin has to hold its own
    // against map tiles and its overlapping neighbours.
    ...typography.mapPin,
    color: c.accentText, // the bounty amount, in ink, on the unselected pill
  },
  bountyTextSelected: {
    color: c.textOnPrimary,
  },
});

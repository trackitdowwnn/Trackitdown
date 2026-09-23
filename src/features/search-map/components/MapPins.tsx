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
 *        ⚠️ A MARKER IS DRAWN ONCE AND NEVER REDRAWN. That is the design, and
 *        it is the whole design. On Android a custom marker is a BITMAP of
 *        its view, captured during a short `tracksViewChanges` window after
 *        mount (false from frame 0 is the blank-marker trap) and then frozen
 *        so the marker pans free. Every mechanism for changing that bitmap
 *        afterwards was shipped on 2026-09-22/23 and every one of them failed
 *        on the owner's phone in its own way:
 *          · re-arming `tracksViewChanges` — the native tracker only
 *            rasterises while an internal counter is positive, so the
 *            highlight landed late or not at all ("clunky");
 *          · the imperative `redraw()` — one icon swap, which on device left
 *            the old pill highlighted alongside the new one, or drew only its
 *            outline ("I have to click a few times");
 *          · anything that let the pill's own layout drive the bitmap — sized
 *            it to the wrong view and clipped it (four reports, one photo).
 *        So: nothing drawn ever changes on a mounted marker. Everything the
 *        pill shows is in its React KEY, and a change to it is a NEW marker.
 *
 *        SELECTION IS ITS OWN MARKER. Every car has a static pill that is
 *        never touched after mount. The selected car gets a SECOND marker on
 *        top of it — the larger, dark pill, at MAX_PIN_Z — keyed on the car,
 *        so moving the selection unmounts one and mounts another, and
 *        clearing it uncovers the static pill beneath. Two highlighted pills
 *        cannot happen: there is one selection marker. A stale pill cannot
 *        happen: none is ever redrawn. This is the Airbnb shape at the level
 *        that matters — each state is a finished bitmap, and changing state
 *        means showing a different one, not editing the one on screen.
 *
 *        A NEW MARKER IS BORN INVISIBLE. A marker joins the map before its
 *        custom view is inserted, and until that view is captured it wears
 *        Google's DEFAULT RED PIN — the flicker the owner saw whenever
 *        selection remounted a marker (2026-09-23). Every PinMarker mounts at
 *        opacity 0 and is revealed a frame later, by which time its view has
 *        been captured. A frame of nothing, never a frame of red.
 *
 *        ⚠️ WHY THE SELECTED PILL WAS CLIPPED — THE REAL CAUSE, 2026-09-23,
 *        found in react-native-maps 1.27.2's Android source after three
 *        guesses (the shadow, the footprint, the remount) each shipped and
 *        each failed on device. On the new architecture, MarkerManager.addView
 *        hangs an OnLayoutChangeListener on the marker's FIRST NATIVE CHILD,
 *        and whenever THAT child's layout changes it calls
 *        marker.update(childWidth, childHeight) — which sizes the marker's
 *        bitmap to the CHILD, not to the marker. Our wrapper below carries
 *        only layout styles, so React Native flattens it out of the native
 *        tree and the first native child is the PILL. Tap a pill: its layout
 *        changes, the bitmap is resized to the pill, and the pill is drawn at
 *        its padded offset into a pill-sized bitmap — cut off at the right and
 *        the bottom, exactly as photographed. Mount was never affected because
 *        the listener is attached at insert time, after the first layout.
 *
 *        The fix is `collapsable={false}` on the wrapper, which makes it a
 *        real native view and so the child the marker measures: its box is
 *        the whole subtree, so the bitmap is always the marker's true size.
 *        Now that a pill never changes after mount the listener only ever
 *        fires once, at layout — but the wrapper must stay unflattened, or
 *        that one report is the pill's size rather than the box's.
 *
 *        This is what Airbnb's native app gets for free: each pill state is
 *        rendered to a bitmap sized from the very view that was drawn, then
 *        swapped in with setIcon. Upstream fixed their half of it in 1.29.5
 *        (#5913, sizing the bitmap to the union of the subtree), but Expo 57
 *        pins 1.27.2 and a native upgrade needs a new build; this fix needs
 *        neither, and holds on 1.29.5 too.
 *
 *        Rank must never enter the key: it churns on every pan, and dozens
 *        of markers remounting at once is the jank this component exists to
 *        avoid. React updates rank's only effect, zIndex, in place.
 *
 *        Rank, paint order and the assistive-tech cap are decided in
 *        mapPins.pinsForRegion — this component is a dumb renderer of that.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapMarker re-export — the single
 *        react-native-maps import); src/features/search-map/lib/
 *        mapPins.ts (MapPinItem); docs/DESIGN_SYSTEM.md (tokens).
 */

import { memo, useCallback, useEffect, useState } from 'react';
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
 * How long a freshly-mounted marker keeps tracking view changes before it
 * freezes. Mount only — nothing on a mounted marker is ever redrawn.
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

/**
 * One pill on the map. Drawn ONCE — its custom view is captured during the
 * mount window and never re-rasterised — so nothing this component receives
 * afterwards may change what the pill shows. That is enforced by the caller:
 * anything drawn (the price, selection) is in the React KEY, and a change to
 * it is a new marker, not a repaint.
 *
 * Memoised, with every prop stable across a tap, so selecting a car does not
 * re-render the hundred static pills around it. Two things keep that true and
 * both look like pedantry: it takes `postId` + `onPressPost` rather than a
 * ready-made handler (an inline arrow at the call site is a new prop every
 * render), and it draws the pill itself from `bountyText` + `selected` rather
 * than taking children (a child element is a new prop every render, however
 * identical it looks).
 */
const PinMarker = memo(function PinMarker({
  latitude,
  longitude,
  postId,
  onPressPost,
  accessibilityLabel,
  bountyText,
  selected = false,
  accessible = true,
  anchor,
  zIndex,
}: {
  latitude: number;
  longitude: number;
  postId: string;
  onPressPost: (id: string) => void;
  accessibilityLabel: string;
  /** What the pill prints — see pinBountyText. Never empty. */
  bountyText: string;
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
  /** The selection marker: the dark, larger pill. Also exposed to assistive
   *  tech, since selection changes appearance and must be perceivable
   *  non-visually too. */
  selected?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  // The mount window: track until the custom view has laid out and been
  // captured, then freeze. Once only — nothing re-arms this, ever.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), TRACK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  // ⚠️ BORN INVISIBLE. A marker joins the map BEFORE its custom view is
  // inserted, and until that view is captured react-native-maps hands it
  // Google's DEFAULT RED PIN (getIcon(): no view, no image → defaultMarker).
  // Alpha 0 goes into the marker's creation options, so the pin is never
  // drawn; the view is captured within the same mount pass (the native layout
  // listener), and the next frame reveals a finished pill. A frame of nothing,
  // never a frame of red — which the owner saw every time a marker was
  // remounted before this (2026-09-23). Deferred a frame rather than set in
  // the effect body: a synchronous setState there cascades a render.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // A tick on the finger. A marker has no pressed state — it is a native map
  // overlay, not a Pressable — so until the card springs up nothing else
  // acknowledges the tap, which was most of what made selection feel
  // unanswered. The same light tick the app gives a colour swatch, a watch
  // toggle and a copied plate; silent on a build without the module.
  const handlePress = useCallback(() => {
    lightHaptic();
    onPressPost(postId);
  }, [onPressPost, postId]);

  return (
    <AppMapMarker
      coordinate={{ latitude, longitude }}
      anchor={anchor}
      opacity={shown ? 1 : 0}
      tracksViewChanges={tracking}
      zIndex={zIndex}
      onPress={handlePress}
      accessible={accessible}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      {/* Transparent 44pt hit area around the drawn marker — markers don't
          honour hitSlop, so the touch target is this wrapper.

          ⚠️ collapsable={false} IS THE CLIPPING FIX. Read the header before
          touching it. This View has only layout styles, so React Native
          FLATTENS it away and the pill becomes the marker's first native
          child — and on Android the marker sizes its BITMAP from whatever
          its first native child last reported as its layout. Unflattened,
          the first child is this box, whose size never changes. */}
      <View collapsable={false} style={styles.hitTarget}>
        <View style={[styles.bountyPill, selected && styles.bountyPillSelected]}>
          <Text
            // Capped: an uncapped 14pt at the OS 200% setting doubles every
            // pill and buries the map. The full amount stays scalable in the
            // sheet list, the card, and the label below.
            maxFontSizeMultiplier={mapPinFontScaleCap}
            style={[styles.bountyText, selected && styles.bountyTextSelected]}
          >
            {/* NEVER blank. docs/DESIGN_SYSTEM.md: "never ship a price-less
                map marker" — an empty pill reads as a cluster, not as a car
                with no reward. A no-reward listing (ADR-0014) says so. */}
            {bountyText}
          </Text>
        </View>
      </View>
    </AppMapMarker>
  );
});

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
  // The car under the selection marker, if it is on screen. revealPins never
  // withholds the selected post, so during a staggered mount this is only
  // ever missing because the car is outside the viewport.
  const selectedPin =
    selectedPostId === null ? undefined : pins.find((pin) => pin.post.id === selectedPostId);
  return (
    <>
      {pins.map((pin) => {
        const bountyText = pinBountyText(pin.post.bountyPence);
        // While the selection marker stands on this pill it is covered
        // completely, so it leaves the assistive-tech tree: one stop per car,
        // and that stop is the selected one.
        const covered = pin.post.id === selectedPostId;
        return (
          <PinMarker
            // ⚠️ THE KEY IS EVERYTHING THIS PILL DRAWS. A static pill is
            // rasterised once, so a change to what it shows must be a NEW
            // marker. The price is the only such thing (a reward changes when
            // its owner edits it — rare, and nothing like the per-pan churn
            // rank would cause). Keyed on the rendered STRING rather than the
            // pence, so a change that does not alter what is drawn remounts
            // nothing. Rank, make, model, the a11y label: NOT in here.
            key={`${pin.key}:${bountyText}`}
            bountyText={bountyText}
            // HIGHEST BOUNTY FIRST. Under heavy overlap paint order is what
            // decides which marker a tap actually hits, and between
            // overlapping Android markers with equal zIndex that order is
            // undefined — so ranking it is not decoration. Never 0: the iOS
            // Google marker skips a falsy zIndex when it re-creates a marker.
            // The selection marker sits above all of these.
            zIndex={Math.max(1, MAX_PIN_Z - 1 - pin.rank)}
            // ⚠️ The DRAWN set and the REACHABLE set deliberately differ. Every
            // marker is drawn and tappable, but only the top few are individual
            // stops for a screen reader: without a cap that is up to a hundred
            // swipes to get past the map, and the sheet below lists every car
            // with more detail and a live count. That is the intended path, not
            // a consolation.
            accessible={pin.rank < AT_MARKER_LIMIT && !covered}
            anchor={pin.anchor ?? MARKER_CENTRE}
            // The car's OWN coordinates, always. A marker displaced to avoid
            // an overlap used to live here; it moved with the zoom, because a
            // constant on-screen gap needs a ground offset that grows as you
            // zoom out. Markers that slide around the map are worse than
            // markers that overlap.
            latitude={pin.post.latitude}
            longitude={pin.post.longitude}
            // The id and the handler, not an arrow: PinMarker is memoised and
            // an inline closure here would re-render all hundred markers on
            // every tap. The haptic lives inside it for the same reason.
            postId={pin.post.id}
            onPressPost={onPressPost}
            accessibilityLabel={`${bountyLabel(pin.post.bountyPence)} — ${pin.post.make} ${pin.post.model}`}
          />
        );
      })}
      {selectedPin !== undefined && (
        <PinMarker
          // ⚠️ THE SELECTION IS ITS OWN MARKER — see the header. A new one per
          // selected car (and per price, for the same reason as above): moving
          // the selection unmounts this and mounts a fresh one over the next
          // car, and clearing it unmounts it and uncovers the static pill.
          // Nothing is ever redrawn, so there is nothing to go stale.
          key={`selected:${selectedPin.post.id}:${pinBountyText(selectedPin.post.bountyPence)}`}
          selected
          bountyText={pinBountyText(selectedPin.post.bountyPence)}
          // Above every static pill, whatever their rank.
          zIndex={MAX_PIN_Z}
          // The selected car is always a stop, whatever its rank.
          accessible
          // The SAME anchor as the pill beneath, so the two boxes — equal in
          // size, by the margin in bountyPill — are concentric and the larger
          // dark pill covers the light one completely.
          anchor={selectedPin.anchor ?? MARKER_CENTRE}
          latitude={selectedPin.post.latitude}
          longitude={selectedPin.post.longitude}
          postId={selectedPin.post.id}
          onPressPost={onPressPost}
          accessibilityLabel={`${bountyLabel(selectedPin.post.bountyPence)} — ${selectedPin.post.make} ${selectedPin.post.model}`}
        />
      )}
    </>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  // 44pt minimum touch target wrapping the smaller drawn marker. It is also
  // the view the Android marker sizes its bitmap from — see the header and the
  // `collapsable={false}` at the call site, which is what makes that true.
  //
  // THE PADDING IS THE PILL'S SHADOW ROOM, and only on iOS. There the marker
  // is a live view and `shadows.soft` really is drawn past the pill by its
  // offset plus its blur radius, so the box has to reach that far. On Android
  // the marker is rasterised through a software canvas, which does not draw
  // elevation at all — the pill has no shadow there and the padding is inert
  // (the border is what separates it from the land; see bountyPill). It was
  // shipped on 2026-09-22 as a fix for the clipping the owner photographed
  // and was not one; the cause was the flattened wrapper, above.
  //
  // SYMMETRIC, and that is load-bearing: the anchor is MARKER_CENTRE, so the
  // box's centre is what sits on the car's coordinate. Padding the bottom
  // alone would slide every pill north of the place it is reporting.
  //
  // Derived from the token rather than written as 16, so a change to
  // `shadows.soft` cannot silently start clipping the iOS shadow.
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
  // ⚠️ THE MARGIN MAKES THE TWO PILLS CONCENTRIC. The selection marker's pill
  // has larger padding; the static pill carries the difference as transparent
  // margin — 4pt a side, exactly the step from md/xs to lg/sm below — so both
  // markers' boxes are the same size. The anchor is a fraction of the box, so
  // equal boxes put both centres on the coordinate and the larger dark pill
  // covers the light one completely, with 4pt to spare on every side. Drop
  // the margin and the selection marker draws off-centre over a pill whose
  // edge shows past it.
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
  // to do the work. Its own marker, mounted over the static pill (see the
  // header) — never a repaint of one.
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

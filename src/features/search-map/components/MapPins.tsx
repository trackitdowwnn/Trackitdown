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
 *        Markers with custom views are the classic Android jank source: the
 *        marker is a BITMAP of its view, and nothing re-rasterises it unless
 *        asked. Two things ask, and they are deliberately different:
 *
 *          MOUNT   — `tracksViewChanges` is held open for TRACK_SETTLE_MS so
 *                    the custom view rasterises AFTER layout (false from
 *                    frame 0 is the blank-marker trap), then freezes so the
 *                    marker pans free. Once, ever, per marker.
 *          DRAWN   — everything the pill shows forms TrackedMarker's
 *                    `drawnKey` (selection, the price) and, when it changes,
 *                    the marker is asked to `redraw()` its icon EXACTLY ONCE. The Airbnb
 *                    shape: their native app renders each pill state to a
 *                    bitmap and swaps it in with one setIcon; this is the
 *                    same swap, one call, no loop.
 *
 *        NOTHING remounts the marker, and the React key is the post id alone.
 *
 *        ⚠️ BOTH ALTERNATIVES WERE SHIPPED AND FELT WRONG, 2026-09-23.
 *          · Folding selection into the KEY guaranteed a fresh bitmap by
 *            DESTROYING the native marker; a new marker wears react-native-
 *            maps' DEFAULT PIN until its view is captured, and is not there to
 *            be tapped meanwhile. The owner saw both — "the red marker
 *            flicker into view", taps "not registering".
 *          · RE-ARMING `tracksViewChanges` for a drawn change looked cheaper
 *            and was slower. The native tracker ticks every 40ms and only
 *            rasterises while an internal `updated` counter is positive — a
 *            counter our re-arm never bumped, so the highlight was riding on
 *            the z-index change happening to bump it, and landed a tick or
 *            two late while everything else on the screen moved on time.
 *            The owner's word was "clunky". `redraw()` posts the same
 *            rasterisation to the very next main-loop pass, unconditionally.
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
 *        real native view and so the child the marker measures. Its box is
 *        the whole subtree, and — because the unselected pill carries the
 *        selected pill's growth as transparent margin — it does not change on
 *        selection at all, so the listener has nothing to report and the
 *        bitmap keeps the marker's true size. Both halves are load-bearing:
 *        drop the margin and the box grows on tap, the bitmap follows, and
 *        the anchor (a fraction of the bitmap) shifts the pill on screen.
 *
 *        This is what Airbnb's native app gets for free: each pill state is
 *        rendered to a bitmap sized from the very view that was drawn, then
 *        swapped in with setIcon. Upstream fixed their half of it in 1.29.5
 *        (#5913, sizing the bitmap to the union of the subtree), but Expo 57
 *        pins 1.27.2 and a native upgrade needs a new build; this fix needs
 *        neither, and holds on 1.29.5 too.
 *
 *        Rank must never enter either the key or `drawnKey`: it churns on
 *        every pan, and dozens of markers redrawing at once is the jank this
 *        component exists to avoid.
 *
 *        Rank, paint order and the assistive-tech cap are decided in
 *        mapPins.pinsForRegion — this component is a dumb renderer of that.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapMarker re-export — the single
 *        react-native-maps import); src/features/search-map/lib/
 *        mapPins.ts (MapPinItem); docs/DESIGN_SYSTEM.md (tokens).
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { AppMapMarker, type AppMapMarkerHandle } from '@/shared/ui/AppMap';

import { AT_MARKER_LIMIT } from '../lib/mapPins';
import type { MapPinItem } from '../types';

/**
 * How long a freshly-mounted marker keeps tracking view changes before it
 * freezes. Mount only — a drawn change is a single `redraw()`, not a re-arm.
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
 * A marker that rasterises its custom child AFTER layout, then freezes — and
 * thereafter redraws its icon exactly once per change to what is DRAWN.
 *
 * Memoised, with every prop stable across a tap except the two or three that
 * a tap actually changes (`selected`, `zIndex`, `accessible`), so selecting a
 * car re-renders that car's marker and the one it replaced — not the hundred
 * others on screen. Two things keep that true and both look like pedantry:
 * it takes `postId` + `onPressPost` rather than a ready-made handler (an
 * inline arrow at the call site is a new prop every render), and it draws the
 * PILL ITSELF from `bountyText` + `selected` rather than taking children (a
 * child element is a new prop every render, however identical it looks).
 */
const TrackedMarker = memo(function TrackedMarker({
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
  /** Exposed to assistive tech: selection changes the pill's appearance, so
   *  it must be perceivable non-visually too. */
  selected?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const markerRef = useRef<AppMapMarkerHandle>(null);

  // Everything the pill DRAWS: selection (the fill and the padding) and the
  // price. When this changes the icon is redrawn once, below. Built from the
  // rendered STRING rather than the pence, so a change that does not alter
  // what is drawn cannot redraw anything; and nothing NOT drawn — make,
  // model, the a11y label, zIndex — is in it, because React updates those in
  // place and a frozen bitmap does not care. See the header for why this is
  // not the React key.
  const drawnKey = `${selected ? 'on' : 'off'}:${bountyText}`;

  // The mount window: track until the custom view has laid out and been
  // captured, then freeze. Once only — nothing below re-arms this.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), TRACK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  // ⚠️ ONE ICON SWAP PER DRAWN CHANGE — the Airbnb shape. After the commit
  // that changed the pill lands, ask the native marker to rasterise its view
  // into its icon once. On Android that is `updateMarkerIcon()` posted to the
  // main looper: it runs on the very next pass, after this commit's props
  // have been mounted, and touches no timer and no tracker (see the header
  // for what re-arming tracksViewChanges cost). The first icon comes from
  // the mount window above, so the mount run is skipped by comparing against
  // the key that was mounted.
  const drawn = useRef(drawnKey);
  useEffect(() => {
    if (drawnKey === drawn.current) {
      return;
    }
    drawn.current = drawnKey;
    markerRef.current?.redraw();
  }, [drawnKey]);

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
      ref={markerRef}
      coordinate={{ latitude, longitude }}
      anchor={anchor}
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
  return (
    <>
      {pins.map((pin) => {
        const selected = pin.post.id === selectedPostId;
        return (
          <TrackedMarker
            // The post id ALONE. Selection and the price were in here for a
            // day (2026-09-22) to force a fresh bitmap; see the header for
            // the red pin and the dead taps that bought.
            key={pin.key}
            bountyText={pinBountyText(pin.post.bountyPence)}
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
            // The id and the handler, not an arrow: TrackedMarker is memoised
            // and an inline closure here would re-render all hundred markers
            // on every tap. The haptic lives inside it for the same reason.
            postId={pin.post.id}
            onPressPost={onPressPost}
            accessibilityLabel={`${bountyLabel(pin.post.bountyPence)} — ${pin.post.make} ${pin.post.model}`}
          />
        );
      })}
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
  // ⚠️ THE MARGIN RESERVES THE GROWTH. Selection swaps this padding for a
  // larger one; the unselected pill carries the difference as transparent
  // margin — 4pt a side, exactly the step from md/xs to lg/sm below — so the
  // DRAWN pill grows on selection and the marker's outer box never does.
  //
  // Half of the clipping fix, not the whole of it (it shipped alone on
  // 2026-09-22 and changed nothing, because the box being measured was the
  // pill — see the header). With the wrapper unflattened this is what keeps
  // the wrapper's layout constant across a tap, so the native size listener
  // never fires and the bitmap keeps the marker's true size; it also keeps
  // the anchor — a fraction of that bitmap — from shifting the pill on screen.
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
  // to do the work. Redrawn once in place via drawnKey (see the header).
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

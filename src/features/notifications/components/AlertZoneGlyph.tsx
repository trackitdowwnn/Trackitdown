/**
 * WHAT:  AlertZoneGlyph — a drawn point-and-radius mark: a tinted square with a
 *        ringed circle and a dot at its centre. No map, no assets, no SVG.
 * WHY:   It does two jobs, and doing both is the point.
 *
 *        ⚠️ IT IS THE EMPTY STATE'S ILLUSTRATION. Airbnb's empty states use a
 *        visual native to the feature (a heart in a suitcase for Wishlists),
 *        and an alert is a place — so the illustration is the same two marks
 *        the real map draws. That makes the empty screen a small preview of
 *        what a filled one looks like, rather than decoration borrowed from
 *        nowhere. Note this is the app's SECOND EmptyState illustration ever
 *        (ReportSightingScreen has the only other), so it deliberately stays a
 *        composition of tokens rather than starting an illustration library.
 *
 *        ⚠️ AND IT IS THE THUMBNAIL'S FALLBACK, which is not a nicety.
 *        MapCornerMask's header records an OPEN QUESTION: static map cards clip
 *        with overflow:'hidden' on Android and are only *believed* fine —
 *        "they may be quietly broken on Android and nobody has looked". An
 *        alert row would be a small, rounded, clipped map, five at a time, on
 *        exactly that unverified path. The row must read correctly with no map
 *        at all, and this is what guarantees it.
 * LINKS: ./AlertZoneThumb.tsx (renders this while the map loads, and instead of
 *        it when maps are off); ../screens/AlertsScreen.tsx (the empty state);
 *        src/shared/theme/sizes.ts (alertThumb / alertGlyphRing / alertGlyphDot).
 */

import { StyleSheet, View } from 'react-native';

import { radii, sizes, useThemedStyles, type Palette } from '@/shared/theme';

export interface AlertZoneGlyphProps {
  /** Paused zones recede, matching AlertZoneMap's `dimmed` circle. */
  dimmed?: boolean;
  testID?: string;
}

export function AlertZoneGlyph({ dimmed = false, testID }: AlertZoneGlyphProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    // Decorative: every caller already names the alert in text, and a screen
    // reader announcing "image" between a name and its summary adds nothing.
    <View
      style={styles.frame}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.ring, dimmed && styles.ringDimmed]}>
        <View style={[styles.dot, dimmed && styles.dotDimmed]} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // surfaceSubtle, the same ground the thumbnail sits on while its map
    // decodes — so a row does not change colour when the map arrives.
    //
    // The hairline is what keeps the tile an object when the card behind it
    // goes `surfaceSubtle` on press: without it the frame and the pressed card
    // are the same colour and the picture loses its edge exactly when it is
    // being touched.
    frame: {
      width: sizes.alertThumb,
      height: sizes.alertThumb,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // ⚠️ textSecondary FOR THE STROKE, and it took three goes to get here —
    // each measured against the ground this actually sits on, `surfaceSubtle`,
    // rather than the page.
    //
    //   mapZoneStroke  2.15 light / 3.34 dark  — the map tokens invert with the
    //                                            BASEMAP, so light fails
    //   borderStrong   2.79 light / 2.82 dark  — its 3:1 clearance is measured
    //                                            on `background` and `surface`,
    //                                            NOT on surfaceSubtle
    //   textSecondary  4.66 light / 5.69 dark  ✅
    //
    // The fill stays `mapZoneFill` for continuity with the real circle, but be
    // honest about what it contributes: at 1.22:1 on this plate it is barely
    // visible, and the ring is carried by its stroke. `mapZoneFill` is
    // calibrated to sit over map tiles, not over a flat UI surface.
    ring: {
      width: sizes.alertGlyphRing,
      height: sizes.alertGlyphRing,
      borderRadius: radii.full,
      backgroundColor: c.mapZoneFill,
      borderWidth: sizes.alertGlyphStroke,
      borderColor: c.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Paused: the fill goes, the outline stays. The area is still theirs — the
    // same thing AlertZoneMap's `dimmed` circle says on the real map.
    ringDimmed: {
      backgroundColor: 'transparent',
      borderColor: c.border,
    },
    // primary, not accent — accent is reserved for bounty and value, and this
    // is a place. Same call LastSeenMap's pin makes, and its comment says so.
    dot: {
      width: sizes.alertGlyphDot,
      height: sizes.alertGlyphDot,
      borderRadius: radii.full,
      backgroundColor: c.primary,
    },
    dotDimmed: {
      backgroundColor: c.textSecondary,
    },
  });

/**
 * WHAT:  Rounds the corners of a map card on Android by COVERING the square
 *        ones — a frame just outside the card, painted in the surrounding
 *        colour, whose inner edge is rounded. Renders nothing on iOS.
 * WHY:   react-native-maps draws into a SurfaceView that misrenders when an
 *        ancestor clips it with overflow:'hidden' + borderRadius — historically
 *        solid black, and on RN 0.86 the map draws OFFSET inside its card
 *        (seen on a Galaxy A15, 2026-07-31). So an interactive map cannot be
 *        clipped, and the rounded card the design system asks for has to be
 *        faked from the outside.
 *
 *        ⚠️ OPEN QUESTION, deliberately recorded rather than papered over.
 *        Three STATIC map cards — LastSeenMap, SightingsTrailMap and
 *        SightingDetailScreen — clip with overflow:'hidden' on both platforms
 *        and are believed fine. The difference may be that they pass
 *        `interactive={false}`, so the SurfaceView never handles a gesture; or
 *        they may be quietly broken on Android and nobody has looked. Until
 *        someone checks all four on a device, this component is used ONLY by
 *        the interactive picker, where the bug is confirmed. Do not roll it out
 *        to the others on the strength of this comment alone — check first, then
 *        make all four the same.
 *
 *        GEOMETRY: a square corner intrudes past a radius-R arc by
 *        R(√2−1)/√2 ≈ 0.29R, so at radii.xl (24) the worst gap is ~7pt and
 *        spacing.md (12) covers it. The frame sits 12pt OUTSIDE the card, so
 *        the outer radius is radii.xl + 12 — which makes the border's INNER
 *        radius exactly radii.xl, matching what iOS clips to.
 * LINKS: src/shared/ui/LocationPicker.tsx (the only consumer today);
 *        src/shared/ui/AppMap.tsx; docs/DESIGN_SYSTEM.md (Map style).
 */

import { Platform, StyleSheet, View } from 'react-native';

import { radii, spacing, usePalette } from '../theme';

/** Width of the covering frame — see the geometry note above. */
const FRAME = spacing.md;

export interface MapCornerMaskProps {
  /**
   * The colour BEHIND the card, which the frame paints. Defaults to the page
   * background. A prop rather than an assumption: on a tinted surface the wrong
   * tone shows as a halo, and that is the one way this technique fails.
   */
  tone?: 'background' | 'surface';
}

export function MapCornerMask({ tone = 'background' }: MapCornerMaskProps) {
  // Read before the platform bail-out: hooks must run on every render.
  const palette = usePalette();

  // iOS clips the card properly, so there is nothing to cover.
  if (Platform.OS !== 'android') {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[
        styles.mask,
        { borderColor: tone === 'surface' ? palette.surface : palette.background },
      ]}
    />
  );
}

// No colour of its own — the paint tone is chosen per-render above — so this
// sheet is safe to build once at module scope.
const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    top: -FRAME,
    left: -FRAME,
    right: -FRAME,
    bottom: -FRAME,
    borderWidth: FRAME,
    borderRadius: radii.xl + FRAME,
  },
});

/**
 * WHAT:  The onboarding's full-bleed background wash — a static vertical
 *        gradient from the page colour into the next neutral down.
 * WHY:   The reference (docs/design-refs/onboarding/ob1.webp) has no cards and
 *        no contained surfaces: depth comes from a soft field the content
 *        floats on. Its field is lilac, which this app does not have and does
 *        not want — ADR-0006 made monochrome an explicit decision, and every
 *        non-neutral colour here is a small SEMANTIC mark, never a decorative
 *        fill. So the structure is borrowed and the hue is not: the same
 *        depth-from-a-wash idea, drawn in the two neutrals either side of the
 *        page colour.
 *
 *        IT DEEPENS DOWNWARD, not from a white sky. The direction was first
 *        set by a hero registration plate that floated in the upper half: its
 *        fill was `colors.surface` (#FFFFFF), so a top-lit wash would have
 *        dissolved it. The plate went on 2026-08-08 and the direction stayed,
 *        because it now serves the layout that replaced it — the copy sits LOW,
 *        just above the footer, and the darker end of the wash gathers under
 *        the words and the control rather than over empty space.
 *
 *        The drift is `background` → `surfaceSubtle` — in light, #F7F7F7 →
 *        #EEEEEE, about eight points of luminance. Enough to read as depth,
 *        small enough that no banding is visible on a cheap panel, and it
 *        leaves the CTA at ~13:1 wherever it lands. It reads the LIVE palette
 *        (usePalette) rather than importing `colors`, so on a dark scheme the
 *        wash drifts #141414 → #2A2A2A: the same two neutrals either side of
 *        the page, inverted with it, rather than a light band on a dark page.
 *
 *        Drawn with react-native-svg, which is already a dependency and already
 *        draws gradients here (SightingTimeline's rail fade) — expo-linear-
 *        gradient would be a new package for one static shape. Nothing on this
 *        component animates.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (owner);
 *        src/features/sightings/components/SightingTimeline.tsx (the precedent);
 *        docs/decisions/ADR-0006-monochrome-theme.md.
 */

import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { usePalette } from '@/shared/theme';

/**
 * How much of the screen the wash holds FLAT before it starts to ramp — and,
 * because they must be the same number, the share the map hero occupies.
 *
 * Exported so the two cannot drift. It was written twice, as `offset="0.55"`
 * here and `flex: 55` there, with each file's header commenting at length about
 * the other — which is the tell.
 */
export const ONBOARDING_WASH_HOLD = 0.55;

export function OnboardingBackdrop() {
  const palette = usePalette();

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="onboarding-backdrop"
    >
      <Defs>
        <LinearGradient id="onboardingWash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.background} />
          {/* Held, not ramped, through the upper half: the wash is something
              the lower content sits in, not a tint over the whole screen. */}
          <Stop offset={String(ONBOARDING_WASH_HOLD)} stopColor={palette.background} />
          <Stop offset="1" stopColor={palette.surfaceSubtle} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#onboardingWash)" />
    </Svg>
  );
}

/**
 * WHAT:  OnboardingCloseButton — the way out of the intro: a white X on a dark
 *        rounded square, top-right, floating over the map. (The reference's is
 *        the other way round; see the ⚠️ on that below.)
 * WHY:   It replaces a ghost "Skip" text button that sat bottom-LEFT, and the
 *        move is the reference's
 *        (`docs/design-refs/onboarding/ob2-life360-gold.jpg`): dismissal lives
 *        in the top-right corner over the hero, which empties the footer for
 *        the full-width button the same reference puts there.
 *
 * ⚠️ A SQUARE, NOT A CIRCLE, and that is measured off the reference rather than
 *        assumed — its close control is a rounded rectangle where every other
 *        floating element on the screen is a full-radius pill. The distinction
 *        is doing work: the pills are CONTENT sitting on the map, this is
 *        CHROME sitting above it, and giving them different silhouettes is what
 *        stops the X reading as one more label.
 *
 * ⚠️ `shadows.lifted`, NOT `soft`. shadows.ts sanctions the deeper tier "at rest
 *        for small white circles floating over photography (header buttons, map
 *        expand)" — which is exactly this. The soft tier is for elements resting
 *        ON a surface; this one has a drawn map behind it and needs its edge to
 *        survive whatever is underneath.
 *
 * ⚠️ AND THE SHADOW IS NOT ENOUGH ON ITS OWN — a hairline does the real work.
 *        `shadows.lifted` casts a literal black, which DESIGN_SYSTEM notes
 *        "barely registers" on dark, and this chip's `surfaceOverMedia` fill
 *        (#222222, theme-invariant) sits on a dark map field of #2A2A2A at
 *        **1.11:1**. Shipped without the border it had no edge at all in dark
 *        mode: the exact "hole punched in the map" failure the note below
 *        claims to be avoiding, arrived at from the opposite direction. Both of
 *        the app's other map-chrome buttons already carry a hairline for this
 *        reason (MapCircleButton, MapSearchPill); the colour here is
 *        `textOnMedia` rather than their `borderStrong` because on a
 *        `surfaceOverMedia` fill that is what PlateChip's onMedia variant does,
 *        and because borderStrong would only reach 2.81:1 against the field
 *        anyway. In light mode the chip already carries 13.7:1 and the hairline
 *        is merely trim.
 *
 * ⚠️ DARK CHIP, WHITE GLYPH — the INVERSE of the reference, on purpose. Their
 *        close button is white with a black X. Ours uses the pairing this app
 *        already has for chrome floating over media: `surfaceOverMedia` +
 *        `textOnMedia`, which stay dark-on-white in BOTH schemes
 *        (MediaIdentityCard, CameraCapture). A white chip would have been the
 *        reference's answer and our map-pin bug: `surface` in dark mode is
 *        DARKER than the field behind it, so the control would read as a hole
 *        punched in the map rather than a button on top of it — the exact
 *        mistake GAP_ANALYSIS records the first hero making. Structure from the
 *        reference, colour from our system.
 *
 * ⚠️ IT KEEPS THE "Skip" ACCESSIBILITY LABEL. The glyph is an X but the ACTION
 *        is skipping the intro, and that is what a screen-reader user needs to
 *        hear — "Close" would suggest a dialog they had opened, which they did
 *        not. The funnel still records this as `skipped`.
 * LINKS: docs/design-refs/onboarding/ob2-life360-gold.jpg;
 *        ../screens/OnboardingScreen.tsx (the only consumer);
 *        src/shared/theme/shadows.ts (why `lifted` is right here, and why it
 *          cannot hold the edge alone on dark);
 *        src/shared/ui/PlateChip.tsx (the `textOnMedia` hairline precedent);
 *        src/features/search-map/components/MapCircleButton.tsx (the other
 *          map-chrome button that learned this in August).
 */

import { X } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import {
  opacity,
  radii,
  shadows,
  sizes,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export interface OnboardingCloseButtonProps {
  onPress: () => void;
}

export function OnboardingCloseButton({ onPress }: OnboardingCloseButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The action, not the glyph — see the header.
      accessibilityLabel="Skip"
      accessibilityHint="Skips the intro and opens the app"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID="onboarding-skip"
    >
      <X size={sizes.icon} color={palette.textOnMedia} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    button: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      // Rounded square, not `radii.full` — see the header.
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceOverMedia,
      // The edge, not the shadow — see the header.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.textOnMedia,
      ...shadows.lifted,
    },
    pressed: {
      opacity: opacity.pressed,
    },
  });

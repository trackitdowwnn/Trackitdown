/**
 * WHAT:  OnboardingDots — "1 of 4", as a row of dots above the intro's button.
 * WHY:   ⚠️ THIS EXISTS BECAUSE THE REFERENCE HAS NO PROGRESS AT ALL, AND WE
 *        NEED SOME. `docs/design-refs/onboarding/ob2-life360-gold.jpg` puts a
 *        full-width pill button at the foot of the screen with nothing beside
 *        it — which it can afford, because it is ONE upsell screen. Ours is one
 *        of four, and the control it replaces (`OnboardingRingFab`) fused
 *        progress and advance into a single ring. Taking the reference's footer
 *        without replacing that signal would leave a four-step sequence with no
 *        sense of its own length — the exact complaint NN/G makes about intro
 *        carousels, and the reason the ring was built in the first place.
 *
 *        So: the reference's button, and the progress it does not need, put
 *        back as the plainest thing that carries it (owner call, 2026-09-03).
 *
 * ⚠️ NOT PRESSABLE, and that is deliberate. Dots this size cannot hold a 44pt
 *        target without invisible padding that swallows taps meant for the
 *        button beneath them, and a carousel that is stepped rather than swiped
 *        has no gesture for them to hint at. They report position; the button
 *        moves.
 *
 * ⚠️ SHAPE, NOT JUST COLOUR. The current dot is WIDER as well as darker
 *        (DESIGN_SYSTEM: never encode by colour alone) — the tones are legible
 *        apart, but the difference must survive a reader who cannot separate
 *        them. `OnboardingDots.test.tsx` pins the width gap for that reason.
 *
 * ⚠️ NOT `shared/wizard/WizardProgressBar`, WHICH IS THE SAME PICTURE — a dot
 *        row with the current slot stretched into a pill, on a screen whose own
 *        header argues the app's two stepped flows must not feel like different
 *        products. Reuse was considered and rejected on two counts:
 *
 *        1. ⚠️ IT WOULD IMPORT A CONTRAST FAILURE. Its resting slot is
 *           `borderStrong`, which clears 3:1 on the wizard's `background` /
 *           `surface` header but measures 2.79:1 light / 2.81:1 dark on the
 *           ground THIS row sits on — the lower end of OnboardingBackdrop's
 *           wash, which ramps to `surfaceSubtle`. Same token, different floor,
 *           because the two components stand on different surfaces.
 *        2. Its whole model is `fills: number[]` — a per-phase COMPLETION
 *           fraction, and an animated morph between "done" and "upcoming". A
 *           slide cannot be partly read; there is no fill to report and nothing
 *           for the pill to worm across.
 *
 *        What IS shared is the geometry, deliberately: `progressDot` and
 *        `progressPill` are the same two tokens the wizard animates between, so
 *        the two rows cannot silently drift apart in size.
 * LINKS: docs/design-refs/onboarding/ob2-life360-gold.jpg (the reference);
 *        docs/design-refs/onboarding/GAP_ANALYSIS.md;
 *        ../screens/OnboardingScreen.tsx (the only consumer);
 *        src/shared/wizard/WizardProgressBar.tsx (the same picture, not reused
 *          — see above);
 *        src/shared/ui/ChoiceChipsMulti.tsx (the `textSecondary`-over-
 *          `surfaceSubtle` precedent, with these exact ratios).
 */

import { StyleSheet, View } from 'react-native';

import { radii, sizes, spacing, useThemedStyles, type Palette } from '@/shared/theme';

export interface OnboardingDotsProps {
  /** Zero-based. */
  page: number;
  total: number;
}

export function OnboardingDots({ page, total }: OnboardingDotsProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      style={styles.row}
      // ONE node, not four: a screen reader should hear the position, never
      // four unlabelled decorations. The dots themselves are invisible to it.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${page + 1} of ${total}`}
      // ⚠️ VALUE AS WELL AS LABEL. `progressbar` without one is announced as an
      // INDETERMINATE bar — a spinner, on a four-step sequence whose length is
      // the only thing this row exists to report. WizardProgressBar's header
      // states the same rule for the same role: "role, label, and value".
      accessibilityValue={{ min: 1, max: total, now: page + 1 }}
      testID="onboarding-dots"
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[styles.dot, index === page && styles.dotCurrent]}
          importantForAccessibility="no"
        />
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    dot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
      // ⚠️ textSecondary, NOT borderStrong — and the first draft got this
      // wrong twice over. `border` was rejected at 1.15:1, correctly; the
      // replacement then landed on `borderStrong`, which reads as the app's
      // graphic-floor token but is only guaranteed against `background` and
      // `surface` (colors.test.ts asserts exactly those two). These dots sit on
      // the backdrop wash's lower end, which ramps to `surfaceSubtle`, and
      // there it measures 2.79:1 light / 2.81:1 dark — under the 3:1 floor, in
      // BOTH schemes. textSecondary clears it at 4.66:1 / 5.69:1. Same finding,
      // same two ratios, same reasoning as ChoiceChipsMulti's swatch ring.
      backgroundColor: c.textSecondary,
    },
    dotCurrent: {
      // `progressPill` — the wizard's own stretched-current-slot token, so the
      // app's two dot rows cannot drift apart. It replaced a local ×2.5
      // multiplier that produced 20pt, off both the 4pt scale and the wizard.
      width: sizes.progressPill,
      // `primary`, not `textPrimary`: DESIGN_SYSTEM reserves primary for active
      // states and selection, which is what a current-step marker is. The two
      // are near-identical today, which is precisely why the wrong one would
      // never be noticed drifting.
      backgroundColor: c.primary,
    },
  });

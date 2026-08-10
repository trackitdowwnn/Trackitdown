/**
 * WHAT:  One onboarding slide — a mixed-weight headline, supporting sentence,
 *        and the optional safety pill.
 * WHY:   THE HEADLINE ALTERNATES WEIGHT. Emphasis runs are set in
 *        Satoshi-Black against a Satoshi-Regular base, mid-sentence — the
 *        design reference's signature, borrowed as structure rather than as its
 *        palette. It replaced a trailing accent-COLOUR phrase that could only
 *        mark the end of a sentence and, at #1A1A1A on #222222, could not
 *        actually be seen.
 *
 *        NO MOTION OF ITS OWN (2026-08-08). The slide used to fade and rise
 *        against a paging ScrollView's offset, and before that it owned an
 *        illustration that parallaxed. Both are gone: the screen now steps
 *        between slides with the wizard's layout animation, which moves the
 *        whole step as one object. A second animation inside it would be a
 *        thing sliding while its own contents did something else.
 *
 *        Each slide is ONE accessibility element announcing "Slide n of N"
 *        plus its full copy — there is nothing else on the screen to read.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy);
 *        src/features/auth/screens/OnboardingScreen.tsx (owns the motion);
 *        docs/DESIGN_SYSTEM.md (Typography, Accessibility);
 *        docs/SECURITY_AND_TRUST.md (safety line treatment).
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  displayFontScaleCap,
  radii,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import { headlineText } from '../lib/onboardingSlides';
import type { OnboardingSlideData } from '../types';

export interface OnboardingSlideProps {
  slide: OnboardingSlideData;
  index: number;
  total: number;
}

export function OnboardingSlide({ slide, index, total }: OnboardingSlideProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const a11yLabel =
    `Slide ${index + 1} of ${total}. ${headlineText(slide.headline)} ${slide.body}` +
    (slide.safetyLine ? ` ${slide.safetyLine}` : '');

  return (
    <View
      style={styles.slide}
      accessible
      accessibilityLabel={a11yLabel}
      testID={`onboarding-slide-${index}`}
    >
      {/* ONE parent Text so the whole headline wraps as a single paragraph;
          the runs nest inside it. maxFontSizeMultiplier is repeated on every
          child on purpose — it is not reliably inherited across nested Text,
          so without it the emphasised words alone would blow past the cap. */}
      <Text style={styles.headline} maxFontSizeMultiplier={displayFontScaleCap}>
        {slide.headline.map((run, runIndex) => (
          <Text
            key={runIndex}
            style={run.emphasis ? styles.headlineEmphasis : undefined}
            maxFontSizeMultiplier={displayFontScaleCap}
          >
            {run.text}
          </Text>
        ))}
      </Text>
      <Text style={styles.body}>{slide.body}</Text>
      {slide.safetyLine ? (
        // SAFETY: the report-don't-approach seed — firm and unmissable,
        // warning-bordered but calm (never alarm-red). This treatment is
        // the visual seed of the future shared SafetyNotice component.
        <View style={styles.safetyPill}>
          <Feather name="alert-triangle" size={typography.label.fontSize} color={palette.warning} />
          <Text style={styles.safetyText}>{slide.safetyLine}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  slide: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  // displayHero SIZE with the REGULAR family: the base run is the light half of
  // the contrast, and emphasis steps up to Black below. Borrowing a family off
  // another role token keeps fontFamilies out of component imports.
  headline: {
    ...typography.displayHero,
    fontFamily: typography.body.fontFamily,
    color: c.textPrimary,
  },
  // FAMILY, never fontWeight: with statically loaded faces Android synthesises
  // a fake bold on top of the real one and the two runs stop being
  // distinguishable. OnboardingSlide.test.tsx pins the absence of fontWeight.
  headlineEmphasis: {
    fontFamily: typography.displayHero.fontFamily,
  },
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
  safetyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceSubtle,
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  safetyText: {
    ...typography.label,
    color: c.textPrimary,
    flexShrink: 1, // wrap inside the pill at large font scales
  },
});

/**
 * WHAT:  One onboarding slide — display headline, supporting sentence, and
 *        the optional safety pill — fading and rising as its slide centres.
 * WHY:   The slide used to own an illustration too: a placeholder emoji in a
 *        grey circle, parallaxing against the scroll. That art slot is gone
 *        (2026-08-06). The hero is now a single registration plate that lives
 *        ABOVE the pager and does not page (OnboardingPlate), because the four
 *        slides are one car's story rather than four subjects — so a slide is
 *        now purely the words, and the words get the whole moment.
 *
 *        Motion is choreographed against the finger, not timers: text fades
 *        and rises as its slide centres. Reduced motion drops the translate
 *        and keeps a plain crossfade. Each slide is ONE accessibility element
 *        announcing "Slide n of N" plus its full copy — the plate above is
 *        decorative, so this label is the entire message for a screen reader.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy);
 *        src/features/auth/components/OnboardingPlate.tsx (the hero);
 *        docs/DESIGN_SYSTEM.md (Motion, Typography, Accessibility);
 *        docs/SECURITY_AND_TRUST.md (safety line treatment).
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { colors, displayFontScaleCap, radii, spacing, typography } from '@/shared/theme';

import type { OnboardingSlideData } from '../types';

export interface OnboardingSlideProps {
  slide: OnboardingSlideData;
  index: number;
  total: number;
  /** Horizontal scroll offset of the pager, in px. */
  scrollX: SharedValue<number>;
  pageWidth: number;
  reduceMotion: boolean;
}

/** How far the text block rises as its slide centres. */
const TEXT_RISE = spacing.lg;

export function OnboardingSlide({
  slide,
  index,
  total,
  scrollX,
  pageWidth,
  reduceMotion,
}: OnboardingSlideProps) {
  'use no memo';
  const range = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];

  const textStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [range[0] / 2 + range[1] / 2, range[1], range[1] / 2 + range[2] / 2],
      [0, 1, 0],
      'clamp',
    );
    if (reduceMotion) {
      return { opacity, transform: [{ translateY: 0 }] };
    }
    return {
      opacity,
      transform: [
        { translateY: interpolate(scrollX.value, range, [TEXT_RISE, 0, TEXT_RISE], 'clamp') },
      ],
    };
  });

  const fullHeadline = slide.headlineAccent
    ? `${slide.headline} ${slide.headlineAccent}`
    : slide.headline;
  const a11yLabel =
    `Slide ${index + 1} of ${total}. ${fullHeadline} ${slide.body}` +
    (slide.safetyLine ? ` ${slide.safetyLine}` : '');

  return (
    <View
      style={[styles.slide, { width: pageWidth }]}
      accessible
      accessibilityLabel={a11yLabel}
      testID={`onboarding-slide-${index}`}
    >
      <Animated.View style={[styles.textBlock, textStyle]}>
        <Text style={styles.headline} maxFontSizeMultiplier={displayFontScaleCap}>
          {slide.headline}
          {slide.headlineAccent ? (
            <Text style={styles.headlineAccent}> {slide.headlineAccent}</Text>
          ) : null}
        </Text>
        <Text style={styles.body}>{slide.body}</Text>
        {slide.safetyLine ? (
          // SAFETY: the report-don't-approach seed — firm and unmissable,
          // warning-bordered but calm (never alarm-red). This treatment is
          // the visual seed of the future shared SafetyNotice component.
          <View style={styles.safetyPill}>
            <Feather name="alert-triangle" size={typography.label.fontSize} color={colors.warning} />
            <Text style={styles.safetyText}>{slide.safetyLine}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    paddingHorizontal: spacing.xl,
  },
  // Natural height: the pager hugs its tallest slide, and the plate above
  // absorbs whatever vertical room is left over at any font scale.
  textBlock: {
    gap: spacing.md,
  },
  headline: {
    ...typography.display,
    color: colors.textPrimary,
  },
  headlineAccent: {
    color: colors.accent, // display-size near-black accent: the bounty value moment
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  safetyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  safetyText: {
    ...typography.label,
    color: colors.textPrimary,
    flexShrink: 1, // wrap inside the pill at large font scales
  },
});

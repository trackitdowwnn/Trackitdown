/**
 * WHAT:  One onboarding slide — illustration circle (placeholder emoji),
 *        display headline, supporting sentence, optional safety pill — with
 *        scroll-linked parallax/fade/scale driven by the pager's offset.
 * WHY:   Motion is choreographed against the finger, not timers: the
 *        illustration parallaxes gently against the scroll, text fades and
 *        rises as its slide centres, the outgoing illustration scales down a
 *        touch (the design system's press-scale amount) — calm, never
 *        carnival. Reduced motion drops parallax/translate/scale and keeps a
 *        plain crossfade. Each slide is ONE accessibility element announcing
 *        "Slide n of N" plus its full copy.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy);
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

import { colors, displayFontScaleCap, motion, radii, spacing, typography } from '@/shared/theme';

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

/** How far the illustration drifts against the scroll. */
const PARALLAX_DISTANCE = spacing.xxl;
/** How far the text block rises as its slide centres. */
const TEXT_RISE = spacing.lg;
/** Placeholder emoji size until final art. TODO(art). */
const EMOJI_SIZE = typography.display.fontSize * 2;

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

  const illustrationStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return {
        opacity: interpolate(scrollX.value, range, [0, 1, 0], 'clamp'),
        transform: [{ translateX: 0 }, { scale: 1 }],
      };
    }
    return {
      opacity: 1,
      transform: [
        // Drifting WITH the finger direction reads as depth behind the text.
        {
          translateX: interpolate(
            scrollX.value,
            range,
            [PARALLAX_DISTANCE, 0, -PARALLAX_DISTANCE],
            'clamp',
          ),
        },
        {
          scale: interpolate(
            scrollX.value,
            range,
            [motion.pressScale, 1, motion.pressScale],
            'clamp',
          ),
        },
      ],
    };
  });

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
      <Animated.View style={[styles.illustrationArea, illustrationStyle]}>
        <View style={styles.illustrationCircle}>
          <Text
            style={styles.emoji}
            // Decorative and inside a fixed circle — never scales.
            maxFontSizeMultiplier={1}
            accessible={false}
            importantForAccessibility="no"
          >
            {slide.emoji}
          </Text>
        </View>
      </Animated.View>

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
            <Feather
              name="alert-triangle"
              size={typography.label.fontSize}
              color={colors.warning}
            />
            <Text style={styles.safetyText}>{slide.safetyLine}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  // The illustration takes whatever the text doesn't need (~55% at default
  // type) and SHRINKS at large font scales, so text never collides with the
  // footer — art is the flexible party, copy is not.
  illustrationArea: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationCircle: {
    width: '60%',
    aspectRatio: 1,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: EMOJI_SIZE,
    // Emoji glyphs clip at their font's default line height when scaled.
    lineHeight: EMOJI_SIZE + spacing.md,
  },
  // Natural height: the text block takes what its copy needs at any font
  // scale; the illustration above absorbs the difference.
  textBlock: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
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
  },
  safetyText: {
    ...typography.label,
    color: colors.textPrimary,
    flexShrink: 1, // wrap inside the pill at large font scales
  },
});

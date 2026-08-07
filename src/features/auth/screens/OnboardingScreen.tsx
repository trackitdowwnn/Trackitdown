/**
 * WHAT:  OnboardingScreen — the first-launch intro. A single registration
 *        plate is pinned above four swipeable text slides; the plate does not
 *        page, its STATUS does (Reported → Broadcast → Sighted → Recovered).
 *        Below: a numbered step rail, a Skip action (slides 1–3), and a
 *        primary CTA whose label cross-fades from "Next" to "Get started".
 * WHY:   A stolen-car app needs trust fast: the intro teaches the loop
 *        (post → alert → spot safely → paid) in four calm screens and plants
 *        the report-don't-approach safety rule before the user ever sees a
 *        post. Swipe and button both advance; Android back walks back a
 *        slide (exits only from slide 1). Skip and Get started both persist
 *        the versioned seen-flag and continue to auth — in `revisit` mode
 *        (settings' "How Trackitdown works") they simply go back and the
 *        flag/log noise is skipped. Slide views, skips, and completion are
 *        logged with the [auth] tag: this is the app's first funnel.
 *
 *        REDESIGNED 2026-08-06. The previous intro gave every slide its own
 *        placeholder emoji in a grey circle — 🚗 📣 📸 🎉 — which read as
 *        unfinished, told four unrelated stories, and celebrated a recovery
 *        with party confetti at someone whose car had just been stolen. The
 *        hero is now the one object the product actually turns on, and it is
 *        SHARED across the four slides on purpose: one car, one case, four
 *        states. That is also why the footer numbers the steps — these slides
 *        are a real sequence, so the numbering carries information rather
 *        than decorating the screen.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy + stamps);
 *        src/features/auth/lib/onboardingStorage.ts (seen flag);
 *        src/features/auth/components/OnboardingPlate.tsx (the hero),
 *        OnboardingSlide.tsx, OnboardingPagerDots.tsx;
 *        docs/DESIGN_SYSTEM.md (Motion, Tone); docs/LOGGING.md.
 *
 * Usage (route file):
 *   <OnboardingScreen />            // first launch
 *   /onboarding?revisit=1           // re-viewing from settings later
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button } from '@/shared/ui/Button';

import { OnboardingPagerDots } from '../components/OnboardingPagerDots';
import { OnboardingPlate } from '../components/OnboardingPlate';
import { OnboardingSlide } from '../components/OnboardingSlide';
import { markOnboardingSeenInGate } from '../hooks/useOnboardingGate';
import { ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import { markOnboardingSeen } from '../lib/onboardingStorage';

const log = createLogger('auth');

export function OnboardingScreen() {
  // React Compiler opt-out: shared values are written from the scroll worklet.
  'use no memo';
  const router = useRouter();
  const params = useLocalSearchParams<{ revisit?: string }>();
  const revisit = params.revisit === '1';
  const reduceMotion = useReducedMotion();
  const { width: pageWidth } = useWindowDimensions();

  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);

  const total = ONBOARDING_SLIDES.length;
  const lastPage = total - 1;
  const onLastPage = page === lastPage;

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  // First funnel: which slides people actually see (per settle, not per px).
  useEffect(() => {
    log.info('Onboarding slide viewed', { slide: page + 1, revisit });
  }, [page, revisit]);

  // Programmatic navigation sets page OPTIMISTICALLY: non-animated scrolls
  // (reduce motion) fire no momentum event, and even animated programmatic
  // scrolls are flaky about it on Android. Swipes reconcile via
  // onMomentumScrollEnd, which is idempotent when both fire.
  const goTo = (target: number) => {
    const clamped = Math.min(lastPage, Math.max(0, target));
    setPage(clamped);
    scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: !reduceMotion });
  };

  // Android back walks back a slide; only slide 1 exits normally.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page > 0) {
        goTo(page - 1);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
    // goTo is recreated per render; the effect only needs to re-arm on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageWidth, reduceMotion]);

  // Width changes (rotation, foldables, split screen) leave the offset in
  // stale pixels — re-snap to the current page so scrollX/pageWidth maths
  // (dots, parallax, CTA morph) stay true.
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: pageRef.current * pageWidth, animated: false });
  }, [pageWidth]);

  const leave = async (reason: 'skipped' | 'completed') => {
    if (revisit) {
      // Settings re-view: nothing to persist, nothing to log. Guard against
      // a deep link with no history behind it.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
      return;
    }
    log.info(`Onboarding ${reason}`, { atSlide: page + 1 });
    await markOnboardingSeen();
    // Flip the live gate NOW (before navigating) so the always-mounted AuthGate
    // sees 'seen' and lets the redirect stick instead of bouncing back.
    markOnboardingSeenInGate();
    // Straight into the tabs as a GUEST — no auth wall. Sign-in happens later,
    // in the AuthSheet, at the first action that needs an account.
    router.replace('/(tabs)/explore');
  };

  const advance = () => {
    if (onLastPage) {
      void leave('completed');
      return;
    }
    goTo(page + 1);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.skipRow}>
        {!onLastPage ? (
          <SkipFade scrollX={scrollX} pageWidth={pageWidth} lastPage={lastPage}>
            <Button
              label="Skip"
              variant="ghost"
              fullWidth={false}
              onPress={() => void leave('skipped')}
            />
          </SkipFade>
        ) : null}
      </View>

      {/* The fixed point of the screen. It sits OUTSIDE the pager: the car
          does not change from slide to slide, only what has happened to it. */}
      <View style={styles.hero}>
        <OnboardingPlate scrollX={scrollX} pageWidth={pageWidth} reduceMotion={reduceMotion} />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        // Hugs its tallest slide rather than filling: the hero above is the
        // flexible party at large font scales, exactly as the illustration
        // it replaced was.
        style={styles.pager}
        onMomentumScrollEnd={(event) => {
          setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
        }}
        testID="onboarding-pager"
      >
        {ONBOARDING_SLIDES.map((slide, index) => (
          <OnboardingSlide
            key={slide.key}
            slide={slide}
            index={index}
            total={total}
            scrollX={scrollX}
            pageWidth={pageWidth}
            reduceMotion={reduceMotion}
          />
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <View style={styles.rail}>
          <OnboardingPagerDots count={total} scrollX={scrollX} pageWidth={pageWidth} />
          <StepLabel scrollX={scrollX} pageWidth={pageWidth} />
        </View>
        <MorphingCta
          scrollX={scrollX}
          pageWidth={pageWidth}
          lastPage={lastPage}
          onLastPage={onLastPage}
          reduceMotion={reduceMotion}
          onPress={advance}
        />
      </View>
    </SafeAreaView>
  );
}

/** Fades Skip out as the last slide approaches (state removes it entirely). */
function SkipFade({
  scrollX,
  pageWidth,
  lastPage,
  children,
}: {
  scrollX: SharedValue<number>;
  pageWidth: number;
  lastPage: number;
  children: React.ReactNode;
}) {
  'use no memo';
  const style = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [(lastPage - 1) * pageWidth, lastPage * pageWidth],
      [1, 0],
      'clamp',
    );
    return {
      opacity,
      // A nearly-invisible Skip must not be pressable mid-drag — an
      // accidental tap would permanently persist the seen-flag.
      pointerEvents: opacity < 0.5 ? 'none' : 'auto',
    };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The step rail's right-hand half: "01 Post", "02 Alert"… cross-fading with
 * the scroll, in a fixed slot so the numerals never shift the dots beside
 * them. Numbering is honest here — these four slides are the product loop in
 * order, so the numeral tells the reader where they are in a PROCESS, which a
 * dot alone cannot. Decorative to assistive tech: each slide already
 * announces "Slide n of N".
 */
function StepLabel({ scrollX, pageWidth }: { scrollX: SharedValue<number>; pageWidth: number }) {
  'use no memo';
  return (
    <View
      style={styles.stepSlot}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {ONBOARDING_SLIDES.map((slide, index) => (
        <StepLabelItem
          key={slide.key}
          index={index}
          step={slide.step}
          scrollX={scrollX}
          pageWidth={pageWidth}
        />
      ))}
    </View>
  );
}

function StepLabelItem({
  index,
  step,
  scrollX,
  pageWidth,
}: {
  index: number;
  step: string;
  scrollX: SharedValue<number>;
  pageWidth: number;
}) {
  'use no memo';
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollX.value,
      [(index - 0.5) * pageWidth, index * pageWidth, (index + 0.5) * pageWidth],
      [0, 1, 0],
      'clamp',
    ),
  }));

  return (
    <Animated.View style={[styles.step, style]}>
      <Text style={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</Text>
      <Text style={styles.stepName}>{step}</Text>
    </Animated.View>
  );
}

/**
 * The primary CTA: full-width sage button whose two labels cross-fade with
 * the scroll ("Next" → "Get started"). A custom pressable rather than
 * shared/ui Button because the label swap is scroll-linked — visuals mirror
 * Button's primary variant tokens exactly.
 */
function MorphingCta({
  scrollX,
  pageWidth,
  lastPage,
  onLastPage,
  reduceMotion,
  onPress,
}: {
  scrollX: SharedValue<number>;
  pageWidth: number;
  lastPage: number;
  onLastPage: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  'use no memo';
  const morphRange = [(lastPage - 1) * pageWidth, lastPage * pageWidth];

  const nextStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? onLastPage
        ? 0
        : 1
      : interpolate(scrollX.value, morphRange, [1, 0], 'clamp'),
  }));
  const getStartedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? onLastPage
        ? 1
        : 0
      : interpolate(scrollX.value, morphRange, [0, 1], 'clamp'),
  }));

  return (
    <Pressable
      style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={onLastPage ? 'Get started' : 'Next'}
      testID="onboarding-cta"
    >
      <Animated.Text style={[styles.ctaLabel, nextStyle]}>Next</Animated.Text>
      <Animated.Text style={[styles.ctaLabel, styles.ctaLabelOverlay, getStartedStyle]}>
        Get started
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // No horizontal padding: the ghost Button's own padding lands the Skip
  // label on the same 24px grid as the slide content.
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: sizes.touchTarget,
  },
  // Takes whatever the copy doesn't need and SHRINKS at large font scales, so
  // the text never collides with the footer — the hero is the flexible party,
  // the words are not.
  hero: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  pager: {
    flexGrow: 0,
  },
  footer: {
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  // Position on the left, the named step on the right: the dots say "where in
  // four", the label says "which part of the loop".
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepSlot: {
    // Fixed slot: the four labels are absolute inside it and cross-fade in
    // place, so the longest name never nudges the dots across the row.
    minWidth: sizes.touchTarget * 2,
    height: typography.label.lineHeight,
  },
  step: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepNumber: {
    ...typography.label,
    fontFamily: typography.plate.fontFamily,
    color: colors.primary,
  },
  stepName: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  // Mirrors shared/ui Button's primary variant — including minHeight (not
  // height) + padding so the label can grow with dynamic type.
  cta: {
    minHeight: sizes.control,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    backgroundColor: colors.primaryPressed,
  },
  ctaLabel: {
    ...typography.label,
    color: colors.textOnPrimary,
  },
  ctaLabelOverlay: {
    position: 'absolute',
  },
});

/**
 * WHAT:  OnboardingScreen — the first-launch intro. Four text slides, stepped
 *        one at a time: Skip on the left, a circular next control on the right
 *        whose ring tracks progress, and one full-width "Get started" on the
 *        last slide.
 * WHY:   A stolen-car app needs trust fast: the intro teaches the loop
 *        (post → alert → spot safely → paid) in four calm screens and plants
 *        the report-don't-approach safety rule before the user ever sees a
 *        post. Android back walks back a slide (exits only from slide 1). Skip
 *        and Get started both persist the versioned seen-flag and continue to
 *        auth — in `revisit` mode (settings' "How Trackitdown works") they
 *        simply go back and the flag/log noise is skipped. Slide views, skips,
 *        and completion are logged with the [auth] tag: the app's first funnel.
 *
 *        IT IS THE WIZARD'S MOTION, ON PURPOSE (2026-08-08). Steps slide in
 *        from the right and out to the left via Reanimated LAYOUT animations
 *        keyed on the page index — the same SlideIn/SlideOut pair, the same
 *        250ms ease-out, the same ReduceMotion.System — as
 *        shared/wizard/WizardScreen. Onboarding and post-a-car are the two
 *        stepped flows in the app and there is no reason for them to feel like
 *        different products.
 *
 *        THAT MEANT GIVING UP THE SWIPE, knowingly. The previous build was a
 *        horizontal paging ScrollView whose offset drove everything —
 *        cross-fades, a parallax hero, the progress. Layout animations move a
 *        step as one object between two settled states, which is a different
 *        idea from tracking a finger, and running both would put two systems on
 *        the same position mid-drag. The wizard has never had a swipe either,
 *        so the flows still match. Advance with the button; Android back steps
 *        back.
 *
 *        NO HERO ABOVE THE WORDS (2026-08-08). A registration plate lived here
 *        for two days and it did not earn the room. What replaced it is
 *        nothing: the headline takes the space at 40pt against the wash, which
 *        is what the design reference's own opening slide does — type-led, no
 *        object. The alternative was per-slide artwork, and this app owns no
 *        illustration assets to do that honestly.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy);
 *        src/features/auth/lib/onboardingStorage.ts (seen flag);
 *        src/shared/wizard/WizardScreen.tsx (the motion this matches);
 *        src/features/auth/components/OnboardingSlide.tsx,
 *        OnboardingRingFab.tsx, OnboardingBackdrop.tsx;
 *        docs/DESIGN_SYSTEM.md (Motion, Tone); docs/LOGGING.md.
 *
 * Usage (route file):
 *   <OnboardingScreen />            // first launch
 *   /onboarding?revisit=1           // re-viewing from settings later
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  ReduceMotion,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { createLogger } from '@/shared/lib/logger';
import {
  displayFontScaleCap,
  motion,
  spacing,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { Button } from '@/shared/ui/Button';

import { OnboardingBackdrop, ONBOARDING_WASH_HOLD } from '../components/OnboardingBackdrop';
import { OnboardingMap } from '../components/OnboardingMap';
import { OnboardingRingFab, RING_SLOT } from '../components/OnboardingRingFab';
import { OnboardingSlide } from '../components/OnboardingSlide';
import { markOnboardingSeenInGate } from '../hooks/useOnboardingGate';
import { ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import { markOnboardingSeen } from '../lib/onboardingStorage';

const log = createLogger('auth');

export function OnboardingScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ revisit?: string }>();
  const revisit = params.revisit === '1';

  const [page, setPage] = useState(0);
  // Which way the next transition travels: +1 forward, -1 back. Held as state
  // rather than derived, because the animation has to know the direction of the
  // move that PRODUCED this page, which the page number alone cannot say.
  const [direction, setDirection] = useState<1 | -1>(1);

  const total = ONBOARDING_SLIDES.length;
  const lastPage = total - 1;
  const onLastPage = page === lastPage;

  // First funnel: which slides people actually see.
  useEffect(() => {
    log.info('Onboarding slide viewed', { slide: page + 1, revisit });
  }, [page, revisit]);

  const goTo = (target: number) => {
    const clamped = Math.min(lastPage, Math.max(0, target));
    setDirection(clamped >= page ? 1 : -1);
    setPage(clamped);
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
    // goTo is recreated per render; the effect only needs to re-arm on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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

  // The wizard's filling-step rule, applied here: past 1.3× the hero yields its
  // room to the copy rather than squeezing it. STRICTLY less-than — at exactly
  // 1.3 the headline is 52pt and needs the screen, so `<=` kept the map for the
  // one scale that could least afford it.
  // `?? 1` because fontScale is not populated on every platform/test host, and
  // an undefined comparison is false — which would have silently hidden the
  // hero everywhere rather than only at large text.
  const mapFits = (fontScale ?? 1) < displayFontScaleCap;

  return (
    <View style={styles.root}>
      {/* FIRST in the tree so nothing later can paint over it on Android,
          where z-order follows elevation. */}
      <OnboardingBackdrop />


      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* ⚠️ A SIBLING OF THE STAGE, NOT A LAYER UNDER IT. Absolutely
            positioned, the map and the copy shared the same pixels and the
            headline landed inside the image at ordinary text sizes — which the
            README states as an absolute rule, and which was only survivable
            because the fade happened to have washed the ink out that far down.
            As flex siblings they cannot overlap at any size on any device.

            The negative top margin is what lets it still bleed under the status
            bar, which is where the reference puts its imagery.

            ⚠️ OUTSIDE the keyed stage below, and that is the whole design: the
            map is the one thing that persists while the words step over it, so
            the four slides read as one car’s story rather than four pictures.
            Inside the stage it would remount and slide with the copy — exactly
            the objection that removed the last two heroes.

            Gone entirely past 1.3× text: the wizard's `fills` rule, "big text
            beats the full-bleed map". */}
        {mapFits ? (
          <View style={[styles.mapBand, { marginTop: -insets.top }]}>
            <OnboardingMap stage={ONBOARDING_SLIDES[page].mapStage} />
          </View>
        ) : null}

        {/* `key` is what makes this a transition at all: changing it unmounts
            the old step and mounts a new one, which is what fires the exiting
            and entering animations. Identical mechanism to WizardScreen. */}
        <Animated.View
          key={page}
          style={styles.stage}
          testID="onboarding-step-slide"
          entering={(direction === 1 ? SlideInRight : SlideInLeft)
            .duration(motion.standard)
            .easing(easeOut)
            .reduceMotion(ReduceMotion.System)}
          exiting={(direction === 1 ? SlideOutLeft : SlideOutRight)
            .duration(motion.standard)
            .easing(easeOut)
            .reduceMotion(ReduceMotion.System)}
        >
          {/* ⚠️ THE SCROLL RESCUE the wizard's `fills` rule assumes. Hiding
              the map past 1.3× gives the words the screen, but at 2× a
              four-line 40pt headline plus a body plus the safety pill still
              overflows — and a stage that cannot scroll simply loses the
              bottom of it. `flexGrow: 1` keeps the copy bottom-aligned at
              ordinary sizes and lets it scroll only when it has to. */}
          <ScrollView
            contentContainerStyle={styles.stageContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <OnboardingSlide slide={ONBOARDING_SLIDES[page]} index={page} total={total} />
          </ScrollView>
        </Animated.View>

        {/* Skip left, advance right — the same footer grammar as the wizard's
            (shared/wizard/WizardFooter), so the two stepped flows read as one
            system. minHeight holds the row steady across the last-slide swap
            from a 78pt ring to a 52pt button. */}
        <View style={[styles.footer, onLastPage && styles.footerSingle]} testID="onboarding-footer">
          {onLastPage ? (
            <Button label="Get started" onPress={() => void leave('completed')} />
          ) : (
            <>
              <Button
                label="Skip"
                variant="ghost"
                fullWidth={false}
                onPress={() => void leave('skipped')}
              />
              <OnboardingRingFab page={page} total={total} onPress={advance} />
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // Holds the backdrop behind everything. The background colour stays as the
  // base coat so the screen is never transparent for the frame before the
  // gradient paints.
  root: {
    flex: 1,
    backgroundColor: c.background,
  },
  container: {
    flex: 1,
  },
  // The step occupies everything above the footer, and the copy sits low in it
  // so the words land near the control that advances them rather than floating
  // in the middle of an empty screen.
  // 55/45 against the stage. The map keeps the share OnboardingBackdrop holds
  // its wash flat through, so the picture lives in the calm band and the wash's
  // own ramp begins where the map has already faded out.
  mapBand: {
    flex: ONBOARDING_WASH_HOLD,
  },
  stage: {
    flex: 1 - ONBOARDING_WASH_HOLD,
  },
  stageContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
  // Skip left, ring right. minHeight is the ring's slot so the last-slide swap
  // to a 52pt button changes the control in place instead of jolting the page.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: RING_SLOT,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  // The last slide holds ONE full-width button, and the direction has to flip
  // for it. Button's `fullWidth` is alignSelf: 'stretch', which stretches the
  // CROSS axis — in a row that is the vertical, so "Get started" would have
  // hugged its own text and grown to the ring's 78pt height instead of
  // spanning the footer. In column, stretch means width, which is what was
  // wanted. justifyContent then centres it in the height the row reserved.
  footerSingle: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
});

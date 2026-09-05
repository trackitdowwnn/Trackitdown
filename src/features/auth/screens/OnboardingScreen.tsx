/**
 * WHAT:  OnboardingScreen — the first-launch intro. Four text slides over a map
 *        that persists between them, stepped one at a time: an X top-right to
 *        skip, on every slide, and a footer holding progress dots above one
 *        full-width button — "Continue", and "Get started" on the last slide.
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
 *        A HERO RETURNED (2026-08-23), after two were removed — placeholder
 *        emoji, then a registration plate that "did not earn the room". It is
 *        `OnboardingMap`, and it differs from both in being the SUBJECT of the
 *        product rather than an accompaniment: a map of stolen cars is what
 *        this app IS, so it answers "what is this?" before a word is read.
 *        Crucially it is NOT remounted per slide — it is a SIBLING of the keyed
 *        stage below, so the words step over a map that persists and morphs,
 *        which is the objection that removed the other two. Still no image
 *        assets: it is drawn, like the wash.
 *
 *        THE CONTROLS WERE REBUILT (2026-09-03) against a second reference,
 *        `docs/design-refs/onboarding/ob2-life360-gold.jpg`. The ring FAB that
 *        fused progress and advance is gone — the funnel had one completed run
 *        against six skipped, and a circle-with-a-gap is a lot to ask a
 *        first-time reader to decode. Progress moved into `OnboardingDots`,
 *        advance into one full-width `Button`, and Skip became the X over the
 *        hero. See features/auth/README.md for the full record.
 * LINKS: src/features/auth/lib/onboardingSlides.ts (copy);
 *        src/features/auth/components/OnboardingMap.tsx (the hero);
 *        src/features/auth/lib/onboardingStorage.ts (seen flag);
 *        src/shared/wizard/WizardScreen.tsx (the motion this matches);
 *        src/features/auth/components/OnboardingSlide.tsx,
 *        OnboardingDots.tsx, OnboardingCloseButton.tsx,
 *        OnboardingBackdrop.tsx;
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
  sizes,
  spacing,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { Button } from '@/shared/ui/Button';

import { OnboardingBackdrop, ONBOARDING_WASH_HOLD } from '../components/OnboardingBackdrop';
import { OnboardingCloseButton } from '../components/OnboardingCloseButton';
import { OnboardingDots } from '../components/OnboardingDots';
import { OnboardingMap } from '../components/OnboardingMap';
import { OnboardingSlide } from '../components/OnboardingSlide';
import { markOnboardingSeenInGate } from '../hooks/useOnboardingGate';
import { ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import {
  endOnboardingRun,
  startOnboardingRun,
  trackOnboardingStep,
} from '../lib/onboardingFunnel';
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

  // ⚠️ A REVISIT IS NOT A RUN. Re-reading the intro from Profile → "How
  // Trackitdown works" must not open one: counting it would inflate both ends
  // of the funnel with people who already finished, and the completion rate —
  // the one number this exists to produce — would drift upward every time
  // somebody browsed the tour. Nothing below fires without an open run.
  useEffect(() => {
    if (revisit) return;
    startOnboardingRun();
    // Ended by `leave`, which every exit path goes through — including the
    // Android back press out of slide 1, which unmounts this screen.
    return () => endOnboardingRun();
  }, [revisit]);

  // The funnel: which slides people actually see. The local log stays — it is
  // what `__DEV__` "Copy recent logs" reads — and the server call is what a
  // completion rate can be computed from.
  useEffect(() => {
    log.info('Onboarding slide viewed', { slide: page + 1, revisit });
    // Guarded HERE as well as inside the funnel, which no-ops with no run open.
    // Belt and braces on purpose: the funnel's guard is invisible from this
    // file, so a future reader moving `startOnboardingRun` somewhere else would
    // silently start counting revisits — and the symptom is a completion rate
    // that quietly climbs rather than anything that looks broken.
    if (!revisit) trackOnboardingStep('slide_viewed', page + 1);
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
    trackOnboardingStep(reason);
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
  // room to the copy rather than squeezing it.
  //
  // `<=`, matching WizardScreen and DESIGN_SYSTEM, which states the rule as
  // "stops filling ABOVE 1.3×". A stricter `<` read better on its own terms
  // but left the design system wrong for one of its two consumers, which is a
  // worse trade than 0.4pt of headline.
  //
  // `?? 1` because fontScale is not populated on every host, and an undefined
  // comparison is false — which would silently hide the hero everywhere.
  const mapFits = (fontScale ?? 1) <= displayFontScaleCap;

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
            // ⚠️ THE EXTRA TOP PADDING IS NOT COSMETIC. With the band gone the
            // stage starts at the top of the SafeAreaView, directly under the
            // floating X — and `justifyContent: 'flex-end'` stops applying the
            // moment the copy is taller than the scroll view, which at 2× is
            // exactly when it happens. The headline then begins at y=0 and
            // scrolls UNDER a chip that does not scroll with it. Reserving the
            // chip's own height plus its inset is what keeps the first line
            // readable at the text size the hero was dropped to serve.
            contentContainerStyle={[
              styles.stageContent,
              !mapFits && styles.stageContentBelowClose,
            ]}
            showsVerticalScrollIndicator={false}
            bounces={false}
            testID="onboarding-stage-scroll"
          >
            <OnboardingSlide slide={ONBOARDING_SLIDES[page]} index={page} total={total} />
          </ScrollView>
        </Animated.View>

        {/* ⚠️ AN OVERLAY, NOT A CHILD OF THE MAP BAND — and that is not a
            layout preference, it is the only version that survives. Past 1.3×
            text the band is not rendered at all, and an X living inside it
            would take the ONLY way out of the intro with it: a reader at large
            type would be locked into four slides with no skip.

            Absolute so it floats over the hero exactly as the reference's does,
            and so it costs the copy beneath it no vertical space.

            ⚠️ LAST IN THE TREE, THOUGH IT DRAWS AT THE TOP. Source order is
            reading order: mounted before the stage, a screen reader announced
            "Skip, button" ahead of the headline on every slide — offering the
            way out before saying what was being left. Absolute positioning and
            `zIndex` are unaffected by the move. */}
        <View style={styles.closeSlot} pointerEvents="box-none">
          <OnboardingCloseButton onPress={() => void leave('skipped')} />
        </View>

        {/* ⚠️ REBUILT 2026-09-03 to the Life360 reference (owner request):
            dots over a full-width button, replacing the ring FAB and the ghost
            Skip that sat opposite it.

            The reference has NO progress indicator, because it is one upsell
            screen rather than a sequence — so its footer is a single pill
            button and nothing else. Ours is one of four, and the ring it
            replaces FUSED progress with advance. The dots are that signal put
            back (owner call): the reference's button, plus the thing the
            reference does not need.

            Skip did not disappear, it MOVED — it is the X over the map now, so
            this row holds one control and the eye has one place to go.

            The last slide keeps its own label: "Get started" is a different
            promise from "Continue", and it is the one press that means the
            intro is finished rather than advanced. */}
        <View style={styles.footer} testID="onboarding-footer">
          {/* ⚠️ ON EVERY SLIDE, THE LAST ONE INCLUDED (2026-09-05). The dots
              were hidden on slide 4 — "nothing left to be a step THROUGH" —
              which meant a four-step sequence dropped its length signal at
              exactly the step where it completes. "4 of 4" is the payoff of
              having dots at all: the reader arrives and SEES they arrived.
              Not a reversal of the funnel-protected rebuild — dots, one
              full-width button and the X all stand; this completes it. The
              button does not move: fixed paddingBottom anchors it, and the
              footer's extra height comes out of the stage above. */}
          <OnboardingDots page={page} total={total} />
          {/* ⚠️ `advance` on BOTH, not a ternary picking `leave` on the last
              slide. `advance` already ends the run when there is no next page,
              and duplicating that here made the branch in `advance` dead while
              allocating a fresh closure every render. One control, one
              handler; only the LABEL changes. */}
          <Button label={onLastPage ? 'Get started' : 'Continue'} onPress={advance} />
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
  // ⚠️ THE STAGE IS ALWAYS THE FILL; the band carries the ratio.
  //
  // Yoga floors the total flex-grow factor to 1 only when the sum is BELOW
  // one. Written as 0.55/0.45 the two summed to exactly 1 and behaved — until
  // the map was hidden, when the stage became the lone growing child at 0.45,
  // was floored to 1, and took 45% of the free space. That left ~42% of the
  // screen blank under the footer at exactly the text size the gate exists to
  // serve, while the comment above it claimed the words got the screen.
  mapBand: {
    flex: ONBOARDING_WASH_HOLD / (1 - ONBOARDING_WASH_HOLD),
  },
  stage: {
    flex: 1,
  },
  stageContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
  // Only when the map band is gone: the X's own square, plus the inset it sits
  // at, plus the same gap again beneath it — so overflowing copy starts clear
  // of the chip rather than under it. With the band present the hero already
  // holds this room and the copy never reaches up here.
  stageContentBelowClose: {
    paddingTop: sizes.touchTarget + spacing.md * 2,
  },
  // ⚠️ A COLUMN NOW, dots over one full-width button (2026-09-03 reference
  // rebuild). It was a row — Skip left, ring right — and both of those controls
  // are gone: Skip moved to the X over the map, the ring's progress moved into
  // the dots.
  //
  // Column matters mechanically, not just visually: Button's `fullWidth` is
  // `alignSelf: 'stretch'`, which stretches the CROSS axis. In a row that is
  // the vertical, so the button hugged its own text and grew tall instead of
  // spanning the footer — the reason the old last-slide style had to flip
  // direction. In a column, stretch means width, which is what is wanted on
  // every slide now.
  //
  // No `minHeight`: with one control of one height on every slide, and the
  // dots now present on every slide too (2026-09-05), nothing in this footer
  // ever appears or disappears — the box is simply constant, which is what a
  // minHeight would have been simulating.
  footer: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    // `xl`, matching the horizontal gutter. It was `lg`, which left the CTA
    // closer to the screen edge below it than to either side of it — and on
    // Android, where there is no bottom safe-area inset to make up the
    // difference, 16pt is the whole gap.
    paddingBottom: spacing.xl,
  },
  // Top-right over the hero, matching the reference. `insets` are applied by
  // SafeAreaView above, so `top` is measured from below the status bar.
  closeSlot: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.xl,
    zIndex: 1,
  },
});

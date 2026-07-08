/**
 * WHAT:  FullscreenLoader — the app's ONLY sanctioned blocking loader: a
 *        calm full-opacity page (app background, not a scrim) with a slow
 *        three-dot sage wave and an optional live-updating status message.
 * WHY:   Reserved for the few moments the user genuinely must wait and must
 *        not interact — submitting a post + escrow payment, confirming
 *        recovery/payout, auth transitions. It is NEVER used for loading
 *        lists, feeds, or screens: those use skeleton placeholders
 *        (docs/DESIGN_SYSTEM.md, Loading). Reaching for this out of
 *        laziness makes the app feel broken — don't.
 *        Presented as a statusBarTranslucent Modal so it covers everything
 *        (headers included), swallows Android back, and traps screen-reader
 *        focus. Once shown it stays for at least motion.loaderMinVisible
 *        even if the operation finishes instantly, so fast paths never
 *        flash. Pair with useFullscreenLoader, which guarantees the loader
 *        hides when the wrapped operation throws.
 * LINKS: src/shared/hooks/useFullscreenLoader.ts (the safe way to drive
 *        this); docs/DESIGN_SYSTEM.md (Loading, Motion, Accessibility);
 *        src/shared/ui/SelectScreen.tsx (same modal exit choreography).
 *
 * Usage:
 *   const { loaderProps, run, update } = useFullscreenLoader();
 *   <FullscreenLoader {...loaderProps} />
 *   await run(submitPost, 'Uploading photos…');
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, motion, opacity, sizes, spacing, typography } from '../theme';

const motionEasing = Easing.out(Easing.quad);

export interface FullscreenLoaderProps {
  visible: boolean;
  /** Status line under the mark; updates cross-fade while visible. */
  message?: string;
  testID?: string;
}

export function FullscreenLoader({ visible, message, testID }: FullscreenLoaderProps) {
  // Lifecycle: shown → (visible=false) wait out the minimum-display window →
  // closing (exit animation plays) → unmounted. Mirrors SelectScreen's
  // delayed-unmount choreography, with the min-display wait in front.
  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);
  const shownAtRef = useRef(0);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMounted(true);
      setClosing(false); // a reopen mid-exit cancels the close
    }
  }

  // Stamp the show time when the loader actually mounts (effects may write
  // refs; render must not). A reopen mid-exit keeps the original stamp —
  // the loader never visually left.
  useEffect(() => {
    if (mounted) {
      shownAtRef.current = Date.now();
    }
  }, [mounted]);

  useEffect(() => {
    if (visible || !mounted) {
      return;
    }
    const elapsed = Date.now() - shownAtRef.current;
    const wait = Math.max(0, motion.loaderMinVisible - elapsed);
    const minTimer = setTimeout(() => setClosing(true), wait);
    // Fallback unmount in case the exit-animation callback never lands.
    const unmountTimer = setTimeout(
      () => setMounted(false),
      wait + motion.standard * 2,
    );
    return () => {
      clearTimeout(minTimer);
      clearTimeout(unmountTimer);
    };
  }, [visible, mounted]);

  // Announce appearance and every message change to screen readers.
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility(message ?? 'Loading');
    }
  }, [visible, message]);

  if (!mounted) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      // Blocking by design: Android back must not dismiss the wait.
      onRequestClose={() => {}}
    >
      {!closing ? (
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={styles.page}
          entering={FadeIn.duration(motion.fast)
            .easing(motionEasing)
            .reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(motion.fast)
            .easing(motionEasing)
            .reduceMotion(ReduceMotion.System)
            .withCallback((finished) => {
              'worklet';
              if (finished) {
                runOnJS(setMounted)(false);
              }
            })}
        >
          <SafeAreaView style={styles.safe}>
            <EnterScale>
              <LoaderMark />
              {message ? (
                // Keyed by message: the outgoing text fades out while the
                // incoming fades in — a 200ms cross-fade on every update.
                <View style={styles.messageSlot}>
                  {/* No accessibilityLiveRegion: keyed remounts announce
                      unreliably on Android, and the explicit
                      announceForAccessibility above covers both platforms
                      exactly once. */}
                  <Animated.Text
                    key={message}
                    entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
                    exiting={FadeOut.duration(motion.fast).reduceMotion(ReduceMotion.System)}
                    style={styles.message}
                  >
                    {message}
                  </Animated.Text>
                </View>
              ) : null}
            </EnterScale>
          </SafeAreaView>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/** The "slight scale" of the entrance: 0.98 → 1 alongside the fade. */
function EnterScale({ children }: { children: ReactNode }) {
  const scale = useSharedValue<number>(motion.pressScale);

  useEffect(() => {
    scale.set(withTiming(1, { duration: motion.fast, easing: motionEasing }));
  }, [scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return <Animated.View style={[styles.content, style]}>{children}</Animated.View>;
}

/**
 * The animated mark: three sage dots in a soft staggered scale/opacity wave
 * (slow and calm — never frantic). Reduced motion swaps the wave for a
 * gentle whole-row opacity pulse.
 *
 * TODO(lottie): to move to a Lottie logo animation later, replace ONLY this
 * component's body — the loader's API and layout stay untouched.
 */
function LoaderMark() {
  const reduceMotion = useReducedMotion();

  return (
    <View
      style={styles.mark}
      accessible
      accessibilityLabel="Loading"
      testID="fullscreen-loader-mark"
    >
      {[0, 1, 2].map((index) =>
        reduceMotion ? (
          <PulseDot key={index} />
        ) : (
          <WaveDot key={index} delay={(index * motion.loaderLoop) / 6} />
        ),
      )}
    </View>
  );
}

function WaveDot({ delay }: { delay: number }) {
  const wave = useSharedValue(0);

  useEffect(() => {
    // Half the loop rising, half falling; each dot offset by its delay.
    wave.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: motion.loaderLoop / 2, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: motion.loaderLoop / 2, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        ),
      ),
    );
  }, [delay, wave]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.loaderRest + (1 - opacity.loaderRest) * wave.get(),
    transform: [{ scale: 1 + (motion.loaderWaveScale - 1) * wave.get() }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

/** Reduced motion: no movement — the whole dot breathes opacity only. */
function PulseDot() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: motion.loaderLoop, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: motion.loaderLoop, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.loaderRest + (1 - opacity.loaderRest) * pulse.get(),
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    // Full-opacity page, NOT a scrim: this is a calm place of its own.
    backgroundColor: colors.background,
  },
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  mark: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dot: {
    width: sizes.loaderDot,
    height: sizes.loaderDot,
    borderRadius: sizes.loaderDot / 2,
    backgroundColor: colors.primary,
  },
  // Fixed slot so message changes (and their cross-fade) never shift the mark.
  messageSlot: {
    minHeight: typography.body.lineHeight * 2,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

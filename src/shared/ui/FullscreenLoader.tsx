/**
 * WHAT:  FullscreenLoader — the app's ONLY sanctioned blocking loader: a
 *        calm full-opacity page (app background, not a scrim) carrying the
 *        BrandLoader — the SAME wordmark-plus-rotating-phrase face as the
 *        cold-start splash, so every wait in the app looks like the app,
 *        with an optional live-updating status message that overrides the
 *        phrases while set.
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
 * LINKS: src/shared/ui/BrandLoader.tsx (the one loading visual);
 *        src/shared/hooks/useFullscreenLoader.ts (the safe way to drive
 *        this); docs/DESIGN_SYSTEM.md (Loading, Motion, Accessibility);
 *        src/shared/ui/SelectScreen.tsx (same modal exit choreography).
 *
 * Usage:
 *   const { loaderProps, run, update } = useFullscreenLoader();
 *   <FullscreenLoader {...loaderProps} />
 *   await run(submitPost, 'Uploading photos…');
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Modal, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { motion, spacing, useThemedStyles, type Palette } from '../theme';
import { BrandLoader } from './BrandLoader';

const motionEasing = Easing.out(Easing.quad);

export interface FullscreenLoaderProps {
  visible: boolean;
  /** Status line under the mark; updates cross-fade while visible. */
  message?: string;
  testID?: string;
}

export function FullscreenLoader({ visible, message, testID }: FullscreenLoaderProps) {
  const styles = useThemedStyles(makeStyles);
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
              {/* The one loading face (BrandLoader): wordmark + rotating
                  phrase, with `message` overriding the phrases while set.
                  No accessibilityLiveRegion inside: the explicit
                  announceForAccessibility above covers both platforms. */}
              <BrandLoader message={message} testID="fullscreen-loader-mark" />
            </EnterScale>
          </SafeAreaView>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/** The "slight scale" of the entrance: 0.98 → 1 alongside the fade. */
function EnterScale({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const scale = useSharedValue<number>(motion.pressScale);

  useEffect(() => {
    scale.set(withTiming(1, { duration: motion.fast, easing: motionEasing }));
  }, [scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return <Animated.View style={[styles.content, style]}>{children}</Animated.View>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: {
      flex: 1,
      // Full-opacity page, NOT a scrim: this is a calm place of its own.
      backgroundColor: c.background,
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
  });

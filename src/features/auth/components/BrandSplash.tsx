/**
 * WHAT:  BrandSplash — the opening screen: the T mark alone, breathing gently,
 *        exactly where the native splash left it. A thin progress line joins it
 *        only if the start is slow, and it fades into the app when AuthGate
 *        lifts it.
 * WHY:   Launch is two screens — the OS splash (baked into the APK) and this —
 *        and they must read as ONE. So this one paints the native splash's
 *        background, in the scheme the phone launched in, with the mark at the
 *        native splash's size and centre: the handover is invisible, and the
 *        first thing that moves is the breath. (2026-10-20 redesign — before
 *        it the mark jumped from 59dp to 56dp at a different height, gained a
 *        spinner and phrases, and the screen cut out in one frame.)
 *
 *        The scheme is the one the phone LAUNCHED in (launchScheme), read
 *        before ThemeProvider can push a saved Light/Dark preference into
 *        Appearance. The native splash cannot see that preference, so a
 *        phone in dark with the app set to light used to flash: dark splash,
 *        light screen, app. Now this screen stays in the phone's scheme (its
 *        mark in the PNG's own ink, its status bar to match — AuthGate) and
 *        its fade-out IS the crossfade into the app's (ADR-0013).
 *
 *        AuthGate owns WHEN this lifts and caps how long it can hold; this only
 *        owns how it looks and how it leaves.
 * LINKS: src/features/auth/components/AuthGate.tsx (consumer + hold rules);
 *        app.json (expo-splash-screen: background + imageWidth);
 *        scripts/brand/markSpec.mjs (the splash PNGs' mark fill);
 *        docs/DESIGN_SYSTEM.md (Loading); ADR-0013 (dark mode).
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { MARK_ASPECT, MARK_INK, MARK_INK_DARK } from '@/shared/brand/markGeometry';
import { motion, opacity, paletteFor, radii, sizes, spacing } from '@/shared/theme';
import { easeOut, linear } from '@/shared/theme/motionEasing';
import { BrandMark } from '@/shared/ui';

import { launchScheme } from '../lib/launchScheme';

/** The native splash image's width in dp — app.json, expo-splash-screen's
 *  `imageWidth`. */
export const NATIVE_SPLASH_IMAGE_DP = 76;
/** How much of that image's width the mark fills — the splash targets' `fill`
 *  in scripts/brand/markSpec.mjs. */
export const NATIVE_SPLASH_MARK_FILL = 0.78;
/** The mark as the native splash draws it, in dp (≈59). BrandMark's `size` is
 *  the mark's width, the same measure as `fill`, so this is the whole match.
 *  BrandSplash.test pins both inputs to their sources, so a change to either
 *  fails CI instead of bringing the jump back. */
export const NATIVE_SPLASH_MARK_DP = NATIVE_SPLASH_IMAGE_DP * NATIVE_SPLASH_MARK_FILL;

/** The share of the track the progress line's moving bar covers. */
const PROGRESS_BAR_SHARE = 0.4;

const MARK_HEIGHT = NATIVE_SPLASH_MARK_DP * MARK_ASPECT;
const TRACK_WIDTH = NATIVE_SPLASH_MARK_DP;
const BAR_WIDTH = TRACK_WIDTH * PROGRESS_BAR_SHARE;

export interface BrandSplashProps {
  /** False starts the fade-out. One-way: AuthGate never raises it again. */
  visible: boolean;
  /** Called once the fade-out has finished, so the gate can unmount this. */
  onHidden: () => void;
}

/** The opening screen: covers the app, in the native splash's likeness, until
 *  `visible` turns false — then dissolves and calls `onHidden`. */
export function BrandSplash({ visible, onHidden }: BrandSplashProps) {
  const scheme = launchScheme();
  const palette = paletteFor(scheme);
  // The PNG's ink, not `primary`: the mark must be the native splash's mark.
  const ink = scheme === 'dark' ? MARK_INK_DARK : MARK_INK;
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);
  const presence = useSharedValue(1);
  const [slow, setSlow] = useState(false);

  // The breath starts at full ink — where the native splash left the mark —
  // and only after a beat, so the mark is still whole when the native splash
  // hands over, even on a slow phone.
  useEffect(() => {
    if (reduceMotion || !visible) return;
    breath.set(
      withDelay(
        motion.standard,
        withRepeat(
          // Inline, not a motionEasing token: a module-scope Easing.inOut there
          // would stop suites whose partial Reanimated mocks lack it (AppTabBar)
          // from loading. Same curve as ProgressSteps' breathe.
          withTiming(1, { duration: motion.splashPulse, easing: Easing.inOut(Easing.ease) }),
          -1,
          true,
        ),
      ),
    );
    return () => cancelAnimation(breath);
  }, [breath, reduceMotion, visible]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setSlow(true), motion.splashSlowAfter);
    return () => clearTimeout(timer);
  }, [visible]);

  // The exit: a dissolve, under Reduce Motion too — an opacity change moves
  // nothing, and cutting instead would turn the crossfade into the app's theme
  // into a one-frame flash whenever the phone and the app disagree. A JS
  // timer, not the animation's callback, says when it is over: the screen
  // must come off even if the animation never reports back.
  useEffect(() => {
    if (visible) return;
    // ReduceMotion.Never: Reanimated otherwise follows the system setting and
    // jumps straight to 0 — the cut this dissolve exists to avoid.
    presence.set(
      withTiming(0, {
        duration: motion.standard,
        easing: easeOut,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    const timer = setTimeout(onHidden, motion.standard);
    return () => clearTimeout(timer);
  }, [visible, presence, onHidden]);

  const fade = useAnimatedStyle(() => ({ opacity: presence.get() }));
  const pulse = useAnimatedStyle(() => ({
    opacity: 1 - breath.get() * (1 - opacity.splashBreathLow),
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: palette.background }, fade]}
      // Leaving, it is out of the way at once — of touches and of screen
      // readers: the app beneath is live from the moment the gate lifts, not
      // when the fade ends.
      pointerEvents={visible ? 'auto' : 'none'}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!visible}
      accessible={visible}
      accessibilityRole="progressbar"
      accessibilityLabel="Trackitdown, loading"
      testID="brand-splash"
    >
      <Animated.View style={reduceMotion ? null : pulse} testID="brand-splash-mark">
        <BrandMark size={NATIVE_SPLASH_MARK_DP} color={ink} />
      </Animated.View>
      {slow ? (
        <ProgressLine
          // At rest (Reduce Motion) the track must read as a loading line on
          // its own, so it takes the stronger hairline; gliding, the moving
          // bar carries the signal and the track can stay quiet.
          track={reduceMotion ? palette.borderStrong : palette.border}
          bar={palette.primary}
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * A slow start's quiet "still working": a hairline track under the mark with a
 * short bar gliding across it. Placed OUTSIDE the flow, so its arrival never
 * nudges the mark off the native splash's centre. Reduce Motion: no glide —
 * the bar rests in the middle of a stronger track, and it arrives without a
 * fade.
 */
function ProgressLine({ track, bar }: { track: string; bar: string }) {
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const shown = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    shown.set(withTiming(1, { duration: motion.fast, easing: easeOut }));
    sweep.set(
      withRepeat(
        withTiming(1, { duration: motion.splashProgressSweep, easing: linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(sweep);
  }, [reduceMotion, shown, sweep]);

  const arrive = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const glide = useAnimatedStyle(() => ({
    transform: [{ translateX: -BAR_WIDTH + sweep.get() * (TRACK_WIDTH + BAR_WIDTH) }],
  }));

  return (
    <Animated.View style={[styles.lineSlot, arrive]} testID="brand-splash-progress">
      <View style={[styles.track, { backgroundColor: track }]}>
        <Animated.View
          style={[styles.bar, { backgroundColor: bar }, reduceMotion ? styles.barStill : glide]}
        />
      </View>
    </Animated.View>
  );
}

// Static: the colours come from the LAUNCH palette above, never the app's, so
// useThemedStyles (which follows the app's preference) is deliberately unused.
const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineSlot: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: MARK_HEIGHT / 2 + spacing.xl,
    alignItems: 'center',
  },
  track: {
    width: TRACK_WIDTH,
    height: sizes.splashProgressStroke,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  bar: {
    width: BAR_WIDTH,
    height: '100%',
    borderRadius: radii.full,
  },
  barStill: {
    transform: [{ translateX: (TRACK_WIDTH - BAR_WIDTH) / 2 }],
  },
});

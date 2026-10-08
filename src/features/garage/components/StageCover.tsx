/**
 * WHAT:  StageCover — swaps what a screen shows IN PLACE: when `stageKey`
 *        changes, the new stage renders underneath at once and the previous
 *        one stays on top for motion.fast, fading out, then goes. Instant
 *        under reduced motion.
 * WHY:   The report flow used to change stage by navigating — the chooser
 *        replaced itself with the form, a second full-screen transition after
 *        the first (2026-10-07: "janky, slow and not smooth"). Now the host
 *        screen slides up once and its stages dissolve into each other.
 *
 *        Two rules this keeps on purpose:
 *        - NO `entering` on the new stage. A first-mount Reanimated entering
 *          once finished on a stale frame and parked a wizard body over its X
 *          (dead taps); the new stage simply appears, uncovered by the fade.
 *        - The leaving stage keeps its LIVE instance: both layers are the same
 *          component, under their stage keys, in one parent, so React moves
 *          the old one to the top rather than remounting it for its fade.
 *          It receives no touches while it fades.
 * LINKS: src/features/garage/screens/StartReportScreen.tsx (the host);
 *        src/shared/theme/motion.ts (fast); docs/DESIGN_SYSTEM.md (Motion).
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { motion } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

interface Layer {
  key: string;
  node: ReactNode;
}

export function StageCover({ stageKey, children }: { stageKey: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [current, setCurrent] = useState<Layer>({ key: stageKey, node: children });
  const [leaving, setLeaving] = useState<Layer | null>(null);

  // Derived state, set during render (React's documented pattern for it): a
  // new key moves the current layer to `leaving` in the same render that
  // shows the new one, so there is never a frame with neither.
  if (current.key !== stageKey) {
    setLeaving(reduceMotion ? null : current);
    setCurrent({ key: stageKey, node: children });
  }

  return (
    <Animated.View style={styles.fill}>
      <StageLayer key={stageKey} leaving={false}>
        {current.key === stageKey ? children : current.node}
      </StageLayer>
      {leaving ? (
        <StageLayer key={leaving.key} leaving onLeft={() => setLeaving(null)}>
          {leaving.node}
        </StageLayer>
      ) : null}
    </Animated.View>
  );
}

function StageLayer({
  leaving,
  onLeft,
  children,
}: {
  leaving: boolean;
  onLeft?: () => void;
  children: ReactNode;
}) {
  // React Compiler opt-out: a shared value written from an effect.
  'use no memo';
  const opacity = useSharedValue(1);
  // The latest callback, read when the fade ends — the parent re-renders
  // during the fade with a new function each time, and depending on it would
  // restart the fade on every render.
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    onLeftRef.current = onLeft;
  });

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const done = () => onLeftRef.current?.();
    opacity.value = withTiming(0, { duration: motion.fast, easing: easeOut }, (finished) => {
      if (finished) {
        scheduleOnRN(done);
      }
    });
  }, [leaving, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[leaving ? styles.cover : styles.fill, fade]}
      pointerEvents={leaving ? 'none' : 'auto'}
      // The leaving stage is on its way out: screen readers skip it.
      importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={leaving}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

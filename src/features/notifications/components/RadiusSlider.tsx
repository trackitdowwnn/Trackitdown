/**
 * WHAT:  RadiusSlider — the 1–50 mile alert radius control: a power-curve
 *        track with a tiered snap grid and a live readout that follows the
 *        thumb on the UI thread.
 * WHY:   Modelled on MoneySlider's gesture structure (the house slider), minus
 *        everything money-specific: no typed entry, no transparency panel, no
 *        pence. It is NOT MoneySlider reused directly — that component's
 *        readout divides by 100 to format pounds, so 10 miles would render as
 *        "£0". Only the MATHS is shared, through radiusSliderMath.
 *        The value is always whole miles and always in range.
 * LINKS: ../lib/radiusSliderMath.ts (curve/snap); src/shared/ui/MoneySlider.tsx
 *        (the pattern this follows); ./AlertZoneMap.tsx (the circle it scales).
 */

/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are
   mutable-by-design boxes written from gesture worklets; the compiler's
   immutability model doesn't apply to them. Same opt-out as MoneySlider. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, motion, opacity, shadows, sizes, spacing, typography } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

import {
  clampMiles,
  formatMiles,
  milesToPosition,
  positionToMiles,
  snapMiles,
  stepAtMiles,
} from '../lib/radiusSliderMath';
import { MAX_RADIUS_MILES, MIN_RADIUS_MILES } from '../types';

const THUMB_SIZE = sizes.sliderThumb;
const TRACK_HEIGHT = sizes.sliderTrack;
const GRAB_SCALE = motion.grabScale;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface RadiusSliderProps {
  /** Controlled value in whole miles; out-of-range values are clamped. */
  valueMiles: number;
  /** Fires on every snap crossing while dragging. Keep the reference stable
   *  (useCallback) — a new identity re-registers the gesture mid-drag. */
  onChangeMiles: (miles: number) => void;
  disabled?: boolean;
  testID?: string;
}

export function RadiusSlider({
  valueMiles,
  onChangeMiles,
  disabled = false,
  testID,
}: RadiusSliderProps) {
  // React Compiler opt-out for the same reason MoneySlider opts out.
  'use no memo';
  const reduceMotion = useReducedMotion();
  const value = clampMiles(valueMiles);

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthSv = useSharedValue(0);
  const position = useSharedValue(milesToPosition(value));
  /** The number the readout shows — follows the finger, settles on snaps. */
  const displayMiles = useSharedValue(value);
  const lastSnapped = useSharedValue(value);
  const grabbed = useSharedValue(0);
  const dragging = useSharedValue(false);
  const [dragGeneration, setDragGeneration] = useState(0);
  const endDrag = useCallback(() => setDragGeneration((generation) => generation + 1), []);

  const settleMs = reduceMotion ? 0 : motion.standard;
  const grabMs = reduceMotion ? 0 : motion.fast;

  // External value changes (load, reset, a parent that rejects a change):
  // glide rather than teleport. Skipped mid-drag — the finger owns the thumb.
  useEffect(() => {
    if (dragging.value || value === lastSnapped.value) return;
    lastSnapped.value = value;
    const timing = { duration: settleMs, easing: easeOut };
    position.value = withTiming(milesToPosition(value), timing);
    displayMiles.value = withTiming(value, timing);
  }, [value, dragGeneration, settleMs, dragging, lastSnapped, position, displayMiles]);

  const pan = useMemo(() => {
    const touchPosition = (x: number) => {
      'worklet';
      const usable = trackWidthSv.value - THUMB_SIZE;
      if (usable <= 0) return -1;
      return Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
    };
    // Only called once the gesture ACTIVATED: before that a parent ScrollView
    // can still claim the touch, and a cancelled gesture must commit nothing.
    const applyTouch = (x: number) => {
      'worklet';
      const nextPosition = touchPosition(x);
      if (nextPosition < 0) return;
      position.value = nextPosition;
      const unsnapped = positionToMiles(nextPosition);
      displayMiles.value = unsnapped;
      const snapped = snapMiles(unsnapped);
      if (snapped !== lastSnapped.value) {
        lastSnapped.value = snapped;
        scheduleOnRN(onChangeMiles, snapped);
      }
    };
    return Gesture.Pan()
      .enabled(!disabled)
      .minDistance(0)
      .onBegin((event) => {
        dragging.value = true;
        grabbed.value = withTiming(1, { duration: grabMs });
        const nextPosition = touchPosition(event.x);
        if (nextPosition >= 0) {
          position.value = nextPosition;
          displayMiles.value = positionToMiles(nextPosition);
        }
      })
      .onStart((event) => applyTouch(event.x))
      .onUpdate((event) => applyTouch(event.x))
      .onFinalize(() => {
        dragging.value = false;
        grabbed.value = withTiming(0, { duration: grabMs });
        const timing = { duration: grabMs, easing: easeOut };
        position.value = withTiming(milesToPosition(lastSnapped.value), timing);
        displayMiles.value = withTiming(lastSnapped.value, timing);
        scheduleOnRN(endDrag);
      });
  }, [
    disabled,
    grabMs,
    onChangeMiles,
    endDrag,
    dragging,
    grabbed,
    position,
    displayMiles,
    lastSnapped,
    trackWidthSv,
  ]);

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthSv.value = width;
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const next = snapMiles(value + direction * stepAtMiles(value));
    if (next !== value) onChangeMiles(next);
  };

  const thumbStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, trackWidthSv.value - THUMB_SIZE);
    return {
      transform: [
        { translateX: position.value * usable },
        { scale: 1 + (GRAB_SCALE - 1) * grabbed.value },
      ],
    };
  });

  const fillStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, trackWidthSv.value - THUMB_SIZE);
    return { width: position.value * usable + THUMB_SIZE / 2 };
  });

  const readoutProps = useAnimatedProps(() => {
    // Round: mid-drag values are un-snapped, and "12.4 miles" reads as noise.
    return { text: formatMiles(Math.round(displayMiles.value)) } as never;
  });

  const formatted = formatMiles(value);

  return (
    <View style={[styles.container, disabled && styles.disabled]} testID={testID}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Alert radius</Text>
        <AnimatedTextInput
          style={styles.readout}
          editable={false}
          defaultValue={formatted}
          animatedProps={readoutProps}
          // The track below carries the accessible interaction and value.
          accessible={false}
          importantForAccessibility="no"
          pointerEvents="none"
          testID={testID ? `${testID}-readout` : undefined}
        />
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.trackRow}
          onLayout={handleTrackLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Alert radius"
          accessibilityValue={{
            min: MIN_RADIUS_MILES,
            max: MAX_RADIUS_MILES,
            now: value,
            text: formatted,
          }}
          accessibilityState={{ disabled }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={handleAccessibilityAction}
          testID={testID ? `${testID}-track` : undefined}
        >
          <View style={styles.rail} />
          <Animated.View style={[styles.fill, fillStyle]} />
          {trackWidth > 0 ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  readout: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    paddingVertical: 0,
    textAlign: 'right',
  },
  trackRow: {
    height: sizes.touchTarget,
    justifyContent: 'center',
  },
  rail: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    // borderStrong, not border — a hairline track vanishes on this background.
    backgroundColor: colors.borderStrong,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
});

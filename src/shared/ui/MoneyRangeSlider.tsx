/**
 * WHAT:  MoneyRangeSlider — a dual-thumb version of MoneySlider for choosing a
 *        bounty RANGE ({ minPence, maxPence }) in search filters: two draggable
 *        thumbs on one non-linear track, a highlighted segment between them, a
 *        "£low – £high" readout (a trailing "+" when the top thumb sits at the
 *        ceiling), and per-thumb accessible increment/decrement stepping.
 * WHY:   The bounty search filter needs a range, but MoneySlider is single-value
 *        and payment-adjacent (the posting wizard's bounty step) — overloading it
 *        with a second thumb would risk that money-critical control. This is the
 *        range consumer the slider's TODO(range) anticipated: it reuses the pure
 *        curve/snap maths (moneySliderMath.ts) UNCHANGED and lives as a sibling,
 *        importing NONE of MoneySlider's component code. Values are always integer
 *        pence, always clamped, and the low thumb can never cross above the high
 *        (or vice versa) — the two stay ordered on the shared snap grid.
 * LINKS: src/shared/ui/moneySliderMath.ts (curve/snap maths, shared with
 *        MoneySlider); src/shared/ui/MoneySlider.tsx (single-value sibling);
 *        docs/DESIGN_SYSTEM.md (accent rules, Motion).
 *
 * Usage:
 *   <MoneyRangeSlider
 *     label="Bounty"
 *     valuePence={{ minPence: 5000, maxPence: 500000 }}
 *     onChange={setRange}
 *     minPence={5000}
 *     maxPence={500000}
 *     snapSteps={[{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }]}
 *   />
 */

/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are
   mutable-by-design boxes written from gesture worklets and handlers; the
   compiler's immutability model doesn't apply to them. The component also
   opts out of the React Compiler ('use no memo' below) for the same reason. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatPounds } from '../lib/money';
import { easeOut } from '@/shared/theme/motionEasing';
import {
  motion,
  opacity,
  shadows,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '../theme';
import {
  clampPence,
  type CurveConfig,
  penceToPosition,
  positionToPence,
  type SnapStep,
  snapPence,
  stepAtPence,
} from './moneySliderMath';

export type { SnapStep } from './moneySliderMath';

/** An inclusive bounty range in integer pence. */
export interface MoneyRange {
  minPence: number;
  maxPence: number;
}

export interface MoneyRangeSliderProps {
  /** Controlled range in integer pence. Out-of-range/inverted values are
   *  clamped and ordered (min never exceeds max). */
  valuePence: MoneyRange;
  /** Fires on every snap crossing while dragging and on each a11y step.
   *  Keep the reference stable (useCallback) — a new identity re-registers
   *  the drag gestures mid-interaction. */
  onChange: (range: MoneyRange) => void;
  /** The track's floor and ceiling (the selectable universe). */
  minPence: number;
  maxPence: number;
  /** Tiered snap grid; defaults to a single £25 grid. Both thumbs share it.
   *  Keep the reference stable (module const / useMemo). */
  snapSteps?: SnapStep[];
  /** Power-curve shape: >1 gives lower amounts more track. Default 2. */
  curveExponent?: number;
  /** Small label above the readout. */
  label?: string;
  disabled?: boolean;
  /** Base label; the thumbs announce as "<label>, minimum/maximum". */
  accessibilityLabel?: string;
  testID?: string;
}

const DEFAULT_SNAP_STEPS: SnapStep[] = [{ stepPence: 2500 }];
/** Local aliases of the theme tokens so gesture worklets capture plain numbers. */
const THUMB_SIZE = sizes.sliderThumb;
const TRACK_HEIGHT = sizes.sliderTrack;
const GRAB_SCALE = motion.grabScale;

type Thumb = 'low' | 'high';

export function MoneyRangeSlider({
  valuePence,
  onChange,
  minPence,
  maxPence,
  snapSteps = DEFAULT_SNAP_STEPS,
  curveExponent = 2,
  label,
  disabled = false,
  accessibilityLabel = 'Amount range',
  testID,
}: MoneyRangeSliderProps) {
  // React Compiler opt-out: Reanimated shared values are mutated from gesture
  // worklets during render-scoped callbacks (see MoneySlider for the rationale).
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();

  // The trusted, ordered pair: both clamped integer pence, low <= high.
  const low = clampPence(valuePence.minPence, minPence, maxPence);
  const high = Math.max(low, clampPence(valuePence.maxPence, minPence, maxPence));

  const config: CurveConfig = useMemo(
    () => ({ minPence, maxPence, curveExponent }),
    [minPence, maxPence, curveExponent],
  );

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthSv = useSharedValue(0);
  // 0–1 thumb positions along the curve.
  const lowPos = useSharedValue(penceToPosition(low, config));
  const highPos = useSharedValue(penceToPosition(high, config));
  // Committed pence per thumb, so a drag worklet can clamp against its
  // neighbour without reading React state.
  const lowSnapped = useSharedValue(low);
  const highSnapped = useSharedValue(high);
  // 0–1 grab progress driving each thumb's scale-up.
  const lowGrab = useSharedValue(0);
  const highGrab = useSharedValue(0);
  // True while a finger owns a thumb — blocks the external-value sync for it.
  const lowDragging = useSharedValue(false);
  const highDragging = useSharedValue(false);
  // Bumped after each gesture ends so a render (and the sync effect) runs
  // against the parent's final accepted value.
  const [dragGeneration, setDragGeneration] = useState(0);
  const endDrag = useCallback(() => setDragGeneration((generation) => generation + 1), []);

  const settleMs = reduceMotion ? 0 : motion.standard;
  const grabMs = reduceMotion ? 0 : motion.fast;

  // External value changes (a parent commit round-trip, reset, or a rejected
  // change): animate each thumb to its new spot unless a finger owns it.
  // Re-run on the post-drag render (dragGeneration) so the slider reconciles
  // with whatever the parent actually kept.
  useEffect(() => {
    if (!lowDragging.value && low !== lowSnapped.value) {
      lowSnapped.value = low;
      lowPos.value = withTiming(penceToPosition(low, config), { duration: settleMs, easing: easeOut });
    }
    if (!highDragging.value && high !== highSnapped.value) {
      highSnapped.value = high;
      highPos.value = withTiming(penceToPosition(high, config), { duration: settleMs, easing: easeOut });
    }
  }, [
    low,
    high,
    dragGeneration,
    config,
    settleMs,
    lowDragging,
    highDragging,
    lowSnapped,
    highSnapped,
    lowPos,
    highPos,
  ]);

  const makeGesture = useCallback(
    (thumb: Thumb) => {
      const pos = thumb === 'low' ? lowPos : highPos;
      const grab = thumb === 'low' ? lowGrab : highGrab;
      const dragging = thumb === 'low' ? lowDragging : highDragging;
      const ownSnapped = thumb === 'low' ? lowSnapped : highSnapped;
      const neighbourSnapped = thumb === 'low' ? highSnapped : lowSnapped;

      // 0–1 position for a touch at x, or -1 while the track has no width yet.
      const touchPosition = (x: number) => {
        'worklet';
        const usable = trackWidthSv.value - THUMB_SIZE;
        if (usable <= 0) {
          return -1;
        }
        return Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
      };
      // Move the thumb to the touch, snap on the shared grid, clamp against the
      // neighbour so the pair never crosses, and emit the ordered pair.
      const applyTouch = (x: number) => {
        'worklet';
        const nextPosition = touchPosition(x);
        if (nextPosition < 0) {
          return;
        }
        const unsnapped = positionToPence(nextPosition, config);
        const snapped = snapPence(unsnapped, snapSteps, minPence, maxPence);
        // Ordering clamp: low can't pass the high thumb's committed value, and
        // vice versa — so the range stays valid mid-drag.
        const bounded =
          thumb === 'low'
            ? Math.min(snapped, neighbourSnapped.value)
            : Math.max(snapped, neighbourSnapped.value);
        pos.value = penceToPosition(bounded, config); // thumb rides the grid
        if (bounded !== ownSnapped.value) {
          ownSnapped.value = bounded;
          const pair =
            thumb === 'low'
              ? { minPence: bounded, maxPence: neighbourSnapped.value }
              : { minPence: neighbourSnapped.value, maxPence: bounded };
          scheduleOnRN(onChange, pair);
        }
      };
      return Gesture.Pan()
        .enabled(!disabled)
        .minDistance(0)
        .onBegin(() => {
          dragging.value = true;
          grab.value = withTiming(1, { duration: grabMs });
        })
        .onStart((event) => {
          applyTouch(event.x);
        })
        .onUpdate((event) => {
          applyTouch(event.x);
        })
        .onFinalize(() => {
          dragging.value = false;
          grab.value = withTiming(0, { duration: grabMs });
          // Settle onto the committed grid point.
          pos.value = withTiming(penceToPosition(ownSnapped.value, config), {
            duration: grabMs,
            easing: easeOut,
          });
          scheduleOnRN(endDrag); // force a reconcile render against the parent
        });
    },
    [
      disabled,
      grabMs,
      config,
      snapSteps,
      minPence,
      maxPence,
      onChange,
      endDrag,
      trackWidthSv,
      lowPos,
      highPos,
      lowGrab,
      highGrab,
      lowDragging,
      highDragging,
      lowSnapped,
      highSnapped,
    ],
  );

  const lowGesture = useMemo(() => makeGesture('low'), [makeGesture]);
  const highGesture = useMemo(() => makeGesture('high'), [makeGesture]);

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthSv.value = width;
  };

  // Moving one snap step is the adjustable role's increment/decrement, clamped
  // against the other thumb so the pair stays ordered.
  const stepThumb = (thumb: Thumb, direction: 1 | -1) => {
    if (disabled) {
      return;
    }
    if (thumb === 'low') {
      const stepped = snapPence(low + direction * stepAtPence(low, snapSteps), snapSteps, minPence, maxPence);
      const next = Math.min(stepped, high); // never above the high thumb
      if (next !== low) {
        onChange({ minPence: next, maxPence: high });
      }
    } else {
      const stepped = snapPence(high + direction * stepAtPence(high, snapSteps), snapSteps, minPence, maxPence);
      const next = Math.max(stepped, low); // never below the low thumb
      if (next !== high) {
        onChange({ minPence: low, maxPence: next });
      }
    }
  };

  const handleAction = (thumb: Thumb) => (event: AccessibilityActionEvent) => {
    stepThumb(thumb, event.nativeEvent.actionName === 'increment' ? 1 : -1);
  };

  const lowThumbStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, trackWidthSv.value - THUMB_SIZE);
    return {
      transform: [
        { translateX: lowPos.value * usable },
        { scale: 1 + (GRAB_SCALE - 1) * lowGrab.value },
      ],
    };
  });
  const highThumbStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, trackWidthSv.value - THUMB_SIZE);
    return {
      transform: [
        { translateX: highPos.value * usable },
        { scale: 1 + (GRAB_SCALE - 1) * highGrab.value },
      ],
    };
  });

  const fillStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, trackWidthSv.value - THUMB_SIZE);
    return {
      left: lowPos.value * usable + THUMB_SIZE / 2,
      width: Math.max(0, (highPos.value - lowPos.value) * usable),
    };
  });

  const lowText = formatPounds(low);
  // A top thumb at the ceiling reads as open-ended ("£5,000+").
  const highText = high >= maxPence ? `${formatPounds(high)}+` : formatPounds(high);
  const rangeText = `${lowText} – ${highText}`;

  const a11yValue = (nowPence: number) => ({
    min: Math.round(minPence / 100),
    max: Math.round(maxPence / 100),
    now: Math.round(nowPence / 100),
    text: formatPounds(nowPence),
  });

  return (
    <View style={[styles.container, disabled && styles.disabled]} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Text style={styles.rangeText} testID={testID ? `${testID}-readout` : undefined}>
        {rangeText}
      </Text>

      <View
        style={styles.trackRow}
        onLayout={handleTrackLayout}
        testID={testID ? `${testID}-track` : undefined}
      >
        <View style={styles.rail} />
        <Animated.View style={[styles.fill, fillStyle]} />
        {trackWidth > 0 ? (
          <>
            <GestureDetector gesture={lowGesture}>
              <Animated.View
                style={[styles.thumb, lowThumbStyle]}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`${accessibilityLabel}, minimum`}
                accessibilityValue={a11yValue(low)}
                accessibilityState={{ disabled }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={handleAction('low')}
                testID={testID ? `${testID}-low` : undefined}
              />
            </GestureDetector>
            <GestureDetector gesture={highGesture}>
              <Animated.View
                style={[styles.thumb, highThumbStyle]}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`${accessibilityLabel}, maximum`}
                accessibilityValue={a11yValue(high)}
                accessibilityState={{ disabled }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={handleAction('high')}
                testID={testID ? `${testID}-high` : undefined}
              />
            </GestureDetector>
          </>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      gap: spacing.md,
    },
    disabled: {
      opacity: opacity.disabled,
    },
    label: {
      ...typography.label,
      color: c.textSecondary,
    },
    rangeText: {
      ...typography.title,
      color: c.accent,
    },
    trackRow: {
      height: sizes.touchTarget,
      justifyContent: 'center',
    },
    rail: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      // borderStrong, not border: small elements that must stay visible.
      backgroundColor: c.borderStrong,
    },
    fill: {
      position: 'absolute',
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: c.accent,
    },
    thumb: {
      position: 'absolute',
      // Both thumbs anchor at the track's left; translateX drives them.
      left: 0,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: c.surface,
      ...shadows.soft,
    },
  });

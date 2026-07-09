/**
 * WHAT:  MoneySlider — animated pence-integer amount selector: a non-linear
 *        slider (drag or tap the track to set), a hero amount readout,
 *        tap-to-type exact entry, and a configurable transparency panel.
 * WHY:   Choosing an amount is a value moment (bounty step of the posting
 *        wizard first; bounty-range search filters and top-ups later), so it
 *        gets the full treatment: display-scale terracotta amount that counts
 *        with the thumb (UI-thread via Reanimated), a power-curve track that
 *        gives lower amounts more room, tiered snap steps (e.g. £25 below
 *        £500, £50 above), and typed entry that respects pence integrity but
 *        not the snap grid. Value is ALWAYS integer pence and always valid —
 *        there is no empty state; out-of-range values clamp. The 95/5 panel
 *        maths come from lib/money's bountyBreakdown (the reference split).
 *        The typed path is the precise, fully-labelled accessible path; the
 *        slider announces as an adjustable moving one snap step.
 *        TODO(range): a future dual-thumb mode for search filters — the
 *        curve/snap maths already take min/max/config, so range mode adds a
 *        second thumb + value pair here without touching the maths.
 * LINKS: src/shared/ui/moneySliderMath.ts (curve/snap maths);
 *        src/shared/lib/money.ts (formatPounds, bountyBreakdown);
 *        docs/DOMAIN.md (Money & fees); docs/DESIGN_SYSTEM.md (accent rules).
 *
 * Usage:
 *   <MoneySlider
 *     label="Bounty"
 *     valuePence={bountyPence}
 *     onChangePence={setBountyPence}
 *     minPence={5000}
 *     maxPence={500000}
 *     snapSteps={[{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }]}
 *     panel={defaultBountyPanelCopy}
 *   />
 */

/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are
   mutable-by-design boxes written from gesture worklets and handlers; the
   compiler's immutability model doesn't apply to them. The component also
   opts out of the React Compiler ('use no memo' below) for the same reason. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { z } from 'zod';

import { type BountyBreakdown, bountyBreakdown, formatPounds } from '../lib/money';
import {
  colors,
  displayFontScaleCap,
  motion,
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
} from '../theme';
import {
  clampPence,
  type CurveConfig,
  formatWholePounds,
  penceToPosition,
  positionToPence,
  type SnapStep,
  snapPence,
  stepAtPence,
} from './moneySliderMath';

export type { SnapStep } from './moneySliderMath';

/** Copy slots for the transparency panel; omit the prop to hide the panel. */
export interface MoneySliderPanelCopy {
  /** Line explaining the 95/5 split, built from the live breakdown. */
  splitLine: (breakdown: BountyBreakdown) => string;
  /** Line explaining escrow, given the formatted amount ("£200"). */
  escrowLine: (formattedAmount: string) => string;
}

/** The bounty step's panel wording (docs/DOMAIN.md: split, escrow, refunds). */
export const defaultBountyPanelCopy: MoneySliderPanelCopy = {
  splitLine: (breakdown) =>
    `If your car is recovered thanks to a spotter, they receive ${formatPounds(
      breakdown.spotterPence,
    )} and our platform fee is ${formatPounds(breakdown.feePence)}.`,
  escrowLine: (formattedAmount) =>
    `${formattedAmount} is held securely when your post goes live — refunded if you cancel or recover it yourself (minus card processing costs).`,
};

/** Form-level validation matching what the slider can emit. */
export function penceAmountSchema(minPence: number, maxPence: number) {
  return z.number().int().min(minPence).max(maxPence);
}

export interface MoneySliderProps {
  /** Controlled value in integer pence. Out-of-range values are clamped. */
  valuePence: number;
  /** Fires on every snap crossing while dragging and on manual commits.
   *  Keep the reference stable (useCallback) — a new identity re-registers
   *  the drag gesture mid-interaction. */
  onChangePence: (pence: number) => void;
  minPence: number;
  maxPence: number;
  /** Tiered snap grid; defaults to a single £25 grid. Typed entry ignores it.
   *  Keep the reference stable (module const / useMemo), same as above. */
  snapSteps?: SnapStep[];
  /** Power-curve shape: >1 gives lower amounts more track. Default 2. */
  curveExponent?: number;
  /** Small label above the hero amount. */
  label?: string;
  /** Transparency panel copy; omit to hide the panel. */
  panel?: MoneySliderPanelCopy;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

const DEFAULT_SNAP_STEPS: SnapStep[] = [{ stepPence: 2500 }];
/** Local aliases of the theme tokens so gesture worklets capture plain numbers. */
const THUMB_SIZE = sizes.sliderThumb;
const TRACK_HEIGHT = sizes.sliderTrack;
const GRAB_SCALE = motion.grabScale;
/** Shake offset for out-of-range typed commits. */
const SHAKE_OFFSET = spacing.sm;
const MAX_FONT_SCALE = displayFontScaleCap;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export function MoneySlider({
  valuePence,
  onChangePence,
  minPence,
  maxPence,
  snapSteps = DEFAULT_SNAP_STEPS,
  curveExponent = 2,
  label,
  panel,
  disabled = false,
  accessibilityLabel = 'Amount',
  testID,
}: MoneySliderProps) {
  // React Compiler opt-out: Reanimated shared values are mutated from gesture
  // worklets during render-scoped callbacks, which the compiler's immutability
  // model (correctly, for plain values) forbids. Reanimated owns this state.
  'use no memo';
  const reduceMotion = useReducedMotion();
  // The value the component trusts: always clamped integer pence.
  const value = clampPence(valuePence, minPence, maxPence);
  const config: CurveConfig = useMemo(
    () => ({ minPence, maxPence, curveExponent }),
    [minPence, maxPence, curveExponent],
  );

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthSv = useSharedValue(0);
  // 0–1 thumb position along the curve.
  const position = useSharedValue(penceToPosition(value, config));
  // The number the hero readout shows — follows the finger, settles on snaps.
  const displayPence = useSharedValue(value);
  // Last snapped value emitted, so drag frames only fire on grid crossings.
  const lastSnapped = useSharedValue(value);
  // 0–1 grab progress driving the thumb scale-up.
  const grabbed = useSharedValue(0);
  // True while a finger owns the thumb — blocks the external-value sync.
  const dragging = useSharedValue(false);
  // Bumped after each gesture ends so a render (and the sync effect) is
  // guaranteed to run against the parent's final accepted value.
  const [dragGeneration, setDragGeneration] = useState(0);
  const endDrag = useCallback(() => setDragGeneration((generation) => generation + 1), []);
  // Horizontal shake for rejected (clamped) typed commits.
  const shakeX = useSharedValue(0);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const settleMs = reduceMotion ? 0 : motion.standard;
  const grabMs = reduceMotion ? 0 : motion.fast;

  // External value changes (manual commit round-trip, form reset, a parent
  // that rejects an emitted change): animate the thumb and readout to the new
  // spot instead of teleporting. Skipped mid-drag — the finger owns the thumb
  // — and re-run on the post-drag render (dragGeneration) so the slider always
  // reconciles with whatever value the parent actually kept.
  useEffect(() => {
    if (dragging.value || value === lastSnapped.value) {
      return;
    }
    lastSnapped.value = value;
    const timing = { duration: settleMs, easing: Easing.out(Easing.cubic) };
    position.value = withTiming(penceToPosition(value, config), timing);
    displayPence.value = withTiming(value, timing);
  }, [value, dragGeneration, config, settleMs, dragging, lastSnapped, position, displayPence]);

  const pan = useMemo(() => {
    // 0–1 position for a touch at x, or -1 while the track has no width yet.
    const touchPosition = (x: number) => {
      'worklet';
      const usable = trackWidthSv.value - THUMB_SIZE;
      if (usable <= 0) {
        return -1;
      }
      return Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
    };
    // Move the thumb/readout to the touch and emit on grid crossings. Only
    // called once the gesture has ACTIVATED (onStart/onUpdate): before that a
    // parent scroll view can still claim the touch, and a cancelled gesture
    // must never have committed a value.
    const applyTouch = (x: number) => {
      'worklet';
      const nextPosition = touchPosition(x);
      if (nextPosition < 0) {
        return;
      }
      position.value = nextPosition;
      const unsnapped = positionToPence(nextPosition, config);
      displayPence.value = unsnapped; // readout follows the finger
      const snapped = snapPence(unsnapped, snapSteps, minPence, maxPence);
      if (snapped !== lastSnapped.value) {
        lastSnapped.value = snapped;
        scheduleOnRN(onChangePence, snapped);
      }
    };
    return Gesture.Pan()
      .enabled(!disabled)
      .minDistance(0)
      .onBegin((event) => {
        dragging.value = true;
        grabbed.value = withTiming(1, { duration: grabMs });
        // Visual-only follow: thumb and readout jump to the touch right away,
        // but nothing commits until activation.
        const nextPosition = touchPosition(event.x);
        if (nextPosition >= 0) {
          position.value = nextPosition;
          displayPence.value = positionToPence(nextPosition, config);
        }
      })
      .onStart((event) => {
        applyTouch(event.x); // activation — this is where a plain tap commits
      })
      .onUpdate((event) => {
        applyTouch(event.x);
      })
      .onFinalize(() => {
        dragging.value = false;
        grabbed.value = withTiming(0, { duration: grabMs });
        // Settle onto the last committed grid point. For a gesture cancelled
        // before activation (a parent scroll claimed the touch) nothing was
        // emitted, so this glides the thumb back to the old value.
        const timing = { duration: grabMs, easing: Easing.out(Easing.cubic) };
        position.value = withTiming(penceToPosition(lastSnapped.value, config), timing);
        displayPence.value = withTiming(lastSnapped.value, timing);
        scheduleOnRN(endDrag); // force a reconcile render against the parent
      });
  }, [
    disabled,
    grabMs,
    config,
    snapSteps,
    minPence,
    maxPence,
    onChangePence,
    endDrag,
    dragging,
    grabbed,
    position,
    displayPence,
    lastSnapped,
    trackWidthSv,
  ]);

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthSv.value = width;
  };

  // Moving one snap step is the adjustable role's increment/decrement.
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) {
      return;
    }
    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const step = stepAtPence(value, snapSteps);
    const next = snapPence(value + direction * step, snapSteps, minPence, maxPence);
    if (next !== value) {
      onChangePence(next);
    }
  };

  // Submitting dismisses the keyboard, which fires onBlur as the input goes
  // away — this guard keeps commitEdit (and its shake) from running twice.
  const committed = useRef(false);

  const startEditing = () => {
    if (disabled) {
      return;
    }
    committed.current = false;
    setEditText(String(Math.round(value / 100)));
    setEditing(true);
  };

  // Whole pounds only: pence integrity without snap steps (£237 is fine).
  const commitEdit = () => {
    if (committed.current) {
      return;
    }
    committed.current = true;
    setEditing(false);
    const pounds = Number.parseInt(editText, 10);
    if (Number.isNaN(pounds)) {
      return; // nothing typed — keep the current value
    }
    const typedPence = pounds * 100;
    const clamped = clampPence(typedPence, minPence, maxPence);
    if (clamped !== typedPence && !reduceMotion) {
      // Gentle "that's out of range" shake before the thumb glides to the clamp.
      shakeX.value = withSequence(
        withTiming(-SHAKE_OFFSET, { duration: motion.fast / 4 }),
        withTiming(SHAKE_OFFSET, { duration: motion.fast / 4 }),
        withTiming(-SHAKE_OFFSET / 2, { duration: motion.fast / 4 }),
        withTiming(0, { duration: motion.fast / 4 }),
      );
    }
    if (clamped !== value) {
      onChangePence(clamped); // the value-sync effect animates the thumb over
    }
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

  const heroShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const heroTextProps = useAnimatedProps(() => {
    return { text: formatWholePounds(displayPence.value) } as never;
  });

  const formattedValue = formatPounds(value);
  // Shown under the editor and spoken when the input focuses, so the clamp
  // (and its shake) is never a surprise.
  const rangeText = `Between ${formatPounds(minPence)} and ${formatPounds(maxPence)}`;

  return (
    <View style={[styles.container, disabled && styles.disabled]} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Animated.View style={heroShakeStyle}>
        {editing ? (
          <>
            <View style={styles.editRow}>
              <Text
                style={styles.heroText}
                allowFontScaling
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                // The input's own label already says "in pounds" — this glyph
                // must not be a separate stop in the accessibility tree.
                accessible={false}
                importantForAccessibility="no"
              >
                £
              </Text>
              <TextInput
                ref={inputRef}
                style={[styles.heroText, styles.editInput]}
                value={editText}
                onChangeText={(text) => setEditText(text.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                returnKeyType="done"
                autoFocus
                selectTextOnFocus
                onSubmitEditing={commitEdit}
                onBlur={commitEdit}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                accessibilityLabel="Enter exact amount in pounds"
                accessibilityHint={rangeText}
                testID={testID ? `${testID}-input` : undefined}
              />
            </View>
            <Text style={styles.rangeHint}>{rangeText}</Text>
          </>
        ) : (
          <Pressable
            onPress={startEditing}
            disabled={disabled}
            style={styles.heroPressable}
            accessibilityRole="button"
            accessibilityLabel={`Edit amount, currently ${formattedValue}`}
            accessibilityHint="Opens keyboard entry for an exact amount"
            testID={testID ? `${testID}-hero` : undefined}
          >
            <AnimatedTextInput
              style={styles.heroText}
              editable={false}
              defaultValue={formattedValue}
              animatedProps={heroTextProps}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              // The Pressable above carries the accessible interaction.
              accessible={false}
              importantForAccessibility="no"
              pointerEvents="none"
            />
          </Pressable>
        )}
      </Animated.View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.trackRow}
          onLayout={handleTrackLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          // Whole pounds for min/max/now — the numeric slider semantics;
          // text is what screen readers actually announce.
          accessibilityValue={{
            min: Math.round(minPence / 100),
            max: Math.round(maxPence / 100),
            now: Math.round(value / 100),
            text: formattedValue,
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

      {panel ? (
        <View style={styles.panel}>
          <Text style={styles.panelText}>{panel.splitLine(bountyBreakdown(value))}</Text>
          <Text style={styles.panelText}>{panel.escrowLine(formattedValue)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  heroText: {
    ...typography.display,
    color: colors.accent,
    paddingVertical: 0, // TextInput default padding would unbalance the row
  },
  // Both faces of the hero (read-only and editing) must meet the 44pt target:
  // display line-height alone is ~38pt.
  heroPressable: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizes.touchTarget,
  },
  editInput: {
    flexGrow: 1,
  },
  rangeHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  trackRow: {
    height: sizes.touchTarget,
    justifyContent: 'center',
  },
  rail: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    // borderStrong, not border: "small elements that must stay visible
    // (progress tracks)" — the plain border tone vanishes on the warm bg.
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
  panel: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  panelText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

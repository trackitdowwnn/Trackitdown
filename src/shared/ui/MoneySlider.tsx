/**
 * WHAT:  MoneySlider — animated pence-integer amount selector: a non-linear
 *        slider (drag or tap the track to set), a hero amount readout,
 *        tap-to-type exact entry, and a configurable transparency panel.
 * WHY:   Choosing an amount is a value moment (bounty step of the posting
 *        wizard first; bounty-range search filters and top-ups later), so it
 *        gets the full treatment: display-scale near-black amount that counts
 *        with the thumb (UI-thread via Reanimated), a power-curve track that
 *        gives lower amounts more room, tiered snap steps (e.g. £25 below
 *        £500, £50 above), and typed entry that respects pence integrity but
 *        not the snap grid. Value is ALWAYS integer pence and always valid —
 *        there is no empty state; out-of-range values clamp. The 95/5 panel
 *        maths come from lib/money's bountyBreakdown (the reference split).
 *        The typed path is the precise, fully-labelled accessible path; the
 *        slider announces as an adjustable moving one snap step.
 *        Range mode (dual-thumb, for search filters) lives in the sibling
 *        MoneyRangeSlider.tsx — it reuses moneySliderMath.ts unchanged rather
 *        than co-tenanting a second thumb in this money-critical control.
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

import { CalendarClock, HandCoins, type LucideIcon, Undo2 } from 'lucide-react-native';
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
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { z } from 'zod';

import {
  type BountyBreakdown,
  bountyBreakdown,
  cardFeePence,
  refundPence,
  formatPounds,
} from '../lib/money';
import { REWARD_TERM_DAYS } from '../lib/bountyBounds';
import { easeOut } from '@/shared/theme/motionEasing';
import {
  displayFontScaleCap,
  motion,
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
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

/** One row of the transparency panel: a question the owner has, answered. */
export interface MoneySliderPanelRow {
  /** Leading glyph — decorative; the title carries the meaning. */
  icon: LucideIcon;
  /** The question, as a short heading ("If a spotter finds your car"). */
  title: string;
  /** The answer, in one or two short sentences. */
  detail: string;
}

/** Copy slots for the transparency panel; omit the prop to hide the panel. */
export interface MoneySliderPanelCopy {
  /** The panel's heading, built from the live amount. */
  title: (pence: number) => string;
  /** The rows, built from the live amount and its 95/5 breakdown. Takes raw
   *  PENCE because rows quote the refund figure as well as the amount. */
  rows: (pence: number, breakdown: BountyBreakdown) => MoneySliderPanelRow[];
}

/**
 * "If a spotter finds your car" — the 95/5 split, in figures. Exported so
 * every reward panel (posting, changing a live reward) says it identically.
 */
export function rewardPaidRow(breakdown: BountyBreakdown): MoneySliderPanelRow {
  return {
    icon: HandCoins,
    title: 'You only pay if a spotter finds your car',
    detail: `They get ${formatPounds(breakdown.spotterPence)}, and our fee is ${formatPounds(breakdown.feePence)}.`,
  };
}

/**
 * "Otherwise, it comes back to you" — what comes back, WHEN (all three ways:
 * cancelling, finding the car yourself, the 60 days ending — the Terms list
 * the same three), and the deduction NAMED AS A FIGURE. Our Terms promise
 * "that deduction is shown to you before you pay"
 * (features/legal/lib/legalContent.ts), and payment is Stripe's PaymentSheet —
 * there is no app checkout screen — so this panel is the only surface that can
 * keep that promise.
 *
 * EXACT, never "about" (ADR-0021): the refund withholds this fixed card fee
 * whatever the card cost, so the figure is a promise, not an estimate.
 * refundPence is the SAME function every refund quote uses.
 */
export function rewardReturnedRow(pence: number): MoneySliderPanelRow {
  return {
    icon: Undo2,
    title: 'Otherwise, it comes back to you',
    detail: `${formatPounds(refundPence(pence))} goes back to your card if you cancel, find the car yourself, or the ${REWARD_TERM_DAYS} days end. Only the ${formatPounds(
      cardFeePence(pence),
    )} card fee is kept.`,
  };
}

/**
 * The bounty step's panel (docs/DOMAIN.md: split, escrow, refunds) — three
 * rows, one per question an owner actually has: who gets it, what if nobody
 * does, and how long it lasts. It was two dense paragraphs until 2026-10-06;
 * every fact they held is still here, just findable.
 *
 * THE REFUND CONDITIONS STAY COMPLETE. "Otherwise, it comes back to you"
 * names all three ways — cancelling, finding the car yourself, and the 60
 * days ending unrenewed (ADR-0020, the most likely ending for most rewards).
 * Leaving one out once buried the headline: this is nearer to a deposit than
 * a payment, and the copy leads with that ("You only pay if…").
 */
export const defaultBountyPanelCopy: MoneySliderPanelCopy = {
  title: (pence) => `How your ${formatPounds(pence)} reward works`,
  rows: (pence, breakdown) => [
    rewardPaidRow(breakdown),
    rewardReturnedRow(pence),
    {
      icon: CalendarClock,
      title: `Lasts ${REWARD_TERM_DAYS} days`,
      detail:
        'From when your listing goes live. Renew any time to keep it going. Your listing stays up either way.',
    },
  ],
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
  /** One supporting line beneath the panel. A STRING, not a data prop: the
   *  slider must not learn what an alert or a spotter is, so the screen that
   *  knows composes the sentence and passes it down. Omit to render nothing —
   *  there is no empty state, because the caller decides when it has something
   *  worth saying. */
  footnote?: string;
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
  footnote,
  disabled = false,
  accessibilityLabel = 'Amount',
  testID,
}: MoneySliderProps) {
  // React Compiler opt-out: Reanimated shared values are mutated from gesture
  // worklets during render-scoped callbacks, which the compiler's immutability
  // model (correctly, for plain values) forbids. Reanimated owns this state.
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
    const timing = { duration: settleMs, easing: easeOut };
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
        const timing = { duration: grabMs, easing: easeOut };
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

      {/* What the amount buys, directly under the control that sets it —
          before the panel, so the slider and its consequence read as one. */}
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}

      {panel ? (
        // A heading and a short row per question, rather than two paragraphs
        // of small print: each answer is findable at a glance, and the money
        // figures sit at the start of their sentence.
        <View style={styles.panel} testID={testID ? `${testID}-panel` : undefined}>
          <Text style={styles.panelTitle} accessibilityRole="header">
            {panel.title(value)}
          </Text>
          {/* Rows spaced wider than the heading sits above them, so the
              heading reads as heading the group, not as a fourth row. */}
          <View style={styles.panelRows}>
            {panel.rows(value, bountyBreakdown(value)).map((row) => (
              // One screen-reader stop per row, read as "title. detail".
              <View
                key={row.title}
                style={styles.panelRow}
                accessible
                accessibilityLabel={`${row.title}. ${row.detail}`}
              >
                <row.icon size={sizes.iconSm} color={palette.textSecondary} />
                <View style={styles.panelRowText}>
                  <Text style={styles.panelRowTitle}>{row.title}</Text>
                  <Text style={styles.panelText}>{row.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
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
    heroText: {
      ...typography.display,
      color: c.accent,
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
      color: c.textSecondary,
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
      backgroundColor: c.borderStrong,
    },
    fill: {
      position: 'absolute',
      left: 0,
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: c.accent,
    },
    thumb: {
      position: 'absolute',
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: c.surface,
      ...shadows.soft,
    },
    panel: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    panelTitle: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    panelRows: {
      gap: spacing.lg,
    },
    // Icon beside a title/detail pair, top-aligned so a two-line detail
    // doesn't drag the icon to the middle of the row.
    panelRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    panelRowText: {
      flex: 1,
      gap: spacing.xs,
    },
    // The question: primary ink so the eye can run down the three of them.
    panelRowTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    // The answer: secondary ink, one or two short sentences.
    panelText: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // The line about what the amount BUYS, so it sits with the control that
    // sets it (directly under the track, above the panel) and is centred under
    // it — part of the slider, not a fourth row of the panel.
    footnote: {
      ...typography.label,
      color: c.textPrimary,
      textAlign: 'center',
    },
  });

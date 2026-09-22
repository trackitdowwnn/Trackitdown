/**
 * WHAT:  RadiusSlider — the 1–50 mile radius control: a power-curve track with
 *        a tiered snap grid and a live readout that follows the thumb on the
 *        UI thread. `label` names it per surface ('Alert radius', 'Distance').
 *        `unsetLabel` (optional) makes the readout say "Any" instead of a
 *        number while the consumer has no radius APPLIED — the search sheet,
 *        where the thumb has to rest somewhere but nothing is being filtered
 *        by; the first touch then commits what is under the finger.
 * WHY:   Modelled on MoneySlider's gesture structure (the house slider), minus
 *        everything money-specific: no typed entry, no transparency panel, no
 *        pence. It is NOT MoneySlider reused directly — that component's
 *        readout divides by 100 to format pounds, so 10 miles would render as
 *        "£0". Only the MATHS is shared, through radiusSliderMath.
 *        The value is always whole miles and always in range.
 *        Lives in shared/ui, not features/notifications, since 2026-08-10: the
 *        map search sheet needs the same 1–50 control, and ARCHITECTURE rule 1
 *        forbids one feature importing another's components. Its own escape
 *        hatch names this case — "if two features need the same thing
 *        constantly, it probably belongs in shared/" — which is the move
 *        shared/lib/distance.ts already made for these very bounds.
 * LINKS: ./radiusSliderMath.ts (curve/snap); ./MoneySlider.tsx (the pattern
 *        this follows); src/features/notifications/components/AlertZoneMap.tsx
 *        (the circle it scales); src/features/search-map (the other consumer).
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

import {
  motion,
  opacity,
  shadows,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

import {
  clampMiles,
  formatMiles,
  milesToPosition,
  positionToMiles,
  snapMiles,
  stepAtMiles,
} from './radiusSliderMath';
import {
  RADIUS_MAX_MILES as MAX_RADIUS_MILES,
  RADIUS_MIN_MILES as MIN_RADIUS_MILES,
} from '@/shared/lib/distance';

const THUMB_SIZE = sizes.sliderThumb;
const TRACK_HEIGHT = sizes.sliderTrack;
const GRAB_SCALE = motion.grabScale;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface RadiusSliderProps {
  /**
   * The control's visible title, also its accessibility label. Defaults to
   * 'Alert radius' — the copy it shipped with, so the alert wizard reads
   * identically — but search sets its own ('Distance'): a search sheet
   * captioned "Alert radius" would name a feature the user isn't using.
   */
  label?: string;
  /** Controlled value in whole miles; out-of-range values are clamped. */
  valueMiles: number;
  /**
   * What the readout says INSTEAD of the miles while no radius is actually
   * applied — "Any" on the search sheet. Omit it and the slider always reads
   * its value, which is what a control whose value is always applied wants.
   *
   * ⚠️ THE THUMB STILL RESTS AT `valueMiles`. A slider has no null position,
   * so a sheet that opens unfiltered has to park it somewhere; this stops that
   * resting place being READ as a filter. Search opens with `distanceMiles`
   * null and the thumb at 10, and said "10 miles" — a number nothing was
   * filtering by, with (since the "Any distance" chip was removed) nothing
   * else on screen to say so.
   *
   * Cleared ON TOUCH, from the gesture worklet, not by waiting for the parent
   * to send a value back: the first drag must show miles under the finger
   * immediately, and a React round-trip would leave the readout saying "Any"
   * for a frame or two while the thumb moved.
   */
  unsetLabel?: string;
  /** Fires on every snap crossing while dragging. Keep the reference stable
   *  (useCallback) — a new identity re-registers the gesture mid-drag. */
  onChangeMiles: (miles: number) => void;
  disabled?: boolean;
  testID?: string;
}

export function RadiusSlider({
  label = 'Alert radius',
  valueMiles,
  unsetLabel,
  onChangeMiles,
  disabled = false,
  testID,
}: RadiusSliderProps) {
  // React Compiler opt-out for the same reason MoneySlider opts out.
  'use no memo';
  const styles = useThemedStyles(makeStyles);
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
  /** Whether the readout is still showing `unsetLabel` rather than the miles.
   *  A shared value so the gesture can clear it on the UI thread. */
  const unset = useSharedValue(unsetLabel !== undefined);
  // Follows the prop: the parent turning the filter back off (Clear all) must
  // put "Any" back, and a parent that never passes the label keeps it false.
  useEffect(() => {
    unset.value = unsetLabel !== undefined;
  }, [unsetLabel, unset]);
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
      // The readout stops saying "Any" the moment the thumb moves, on this
      // thread — waiting for the parent's value to come back would leave it
      // reading "Any" under a finger that is already dragging.
      // ⚠️ CAPTURED BEFORE IT IS CLEARED, and the reason is the whole feature.
      // `lastSnapped` starts at the RESTING value, so a touch that does not
      // cross a snap boundary — and above 5 miles the step is 5, making the
      // band around a resting 10 a wide 7.5–12.5 — used to emit nothing while
      // still clearing "Any". The readout then said "10 miles" over a search
      // filtering by no distance at all: precisely the lie `unsetLabel` exists
      // to remove, reintroduced one line above it. The FIRST touch always
      // commits what is under the finger.
      const wasUnset = unset.value;
      unset.value = false;
      position.value = nextPosition;
      const unsnapped = positionToMiles(nextPosition);
      displayMiles.value = unsnapped;
      const snapped = snapMiles(unsnapped);
      if (wasUnset || snapped !== lastSnapped.value) {
        lastSnapped.value = snapped;
        scheduleOnRN(onChangeMiles, snapped);
      }
    };
    // A TAP still jumps the thumb to where you pressed. Kept as its own gesture
    // rather than as pan's minDistance(0), because a tap cannot fire once the
    // finger travels — so it can never be triggered by a scroll.
    // Glide the thumb and the readout onto the value that was actually
    // COMMITTED. applyTouch deliberately leaves both at the raw touch position
    // (so a drag tracks the finger), and the pan's onFinalize used to be the
    // only thing that reconciled them.
    const settle = () => {
      'worklet';
      const timing = { duration: grabMs, easing: easeOut };
      position.value = withTiming(milesToPosition(lastSnapped.value), timing);
      displayMiles.value = withTiming(lastSnapped.value, timing);
    };

    const tap = Gesture.Tap()
      .enabled(!disabled)
      // maxDistance makes the claim above true BY CONSTRUCTION. RNGH's tap
      // defaults cap only the DURATION, so without this a fast flick that
      // began on the track still ends in onEnd and commits a radius — and the
      // parent ScrollView cannot always save us (already at a scroll boundary,
      // or a wizard step whose content doesn't overflow).
      .maxDistance(10)
      .onEnd((event, success) => {
        // A tap that was cancelled must commit nothing.
        if (!success) {
          return;
        }
        applyTouch(event.x);
        // MUST settle. When the tap wins the race RNGH cancels the pan FIRST,
        // so pan.onFinalize runs before this handler and its settle is then
        // overwritten by applyTouch's raw values. Without this the snap is
        // committed to the parent while the thumb and the "N miles" readout
        // sit on the unsnapped touch position — a tap at raw 27 commits 30 and
        // displays 27. The external-value effect cannot rescue it either: it
        // early-returns because lastSnapped already equals the echoed value.
        settle();
      });

    const pan = Gesture.Pan()
      .enabled(!disabled)
      // ⚠️ HORIZONTAL INTENT REQUIRED. This was minDistance(0), which activates
      // the pan on touch-DOWN — so a vertical scroll that merely began on the
      // track committed a radius the user never chose, and the parent
      // ScrollView never got the chance to claim the touch that applyTouch's
      // own comment assumes it can. Verified on device 2026-08-10: a straight
      // vertical swipe over the track moved 10 -> 15 miles and switched the
      // filter on. Worse in the alert wizard, where the radius is persisted.
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onBegin(() => {
        dragging.value = true;
        grabbed.value = withTiming(1, { duration: grabMs });
      })
      // The thumb only jumps to the finger once the gesture has ACTIVATED —
      // previewing it in onBegin would move the thumb under a scroll that is
      // about to be handed to the parent.
      .onStart((event) => applyTouch(event.x))
      .onUpdate((event) => applyTouch(event.x))
      .onFinalize(() => {
        dragging.value = false;
        grabbed.value = withTiming(0, { duration: grabMs });
        settle();
        scheduleOnRN(endDrag);
      });

    // Race, not Simultaneous: whichever the user's finger turns out to mean.
    return Gesture.Race(tap, pan);
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
    unset,
    trackWidthSv,
  ]);

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthSv.value = width;
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    // From "Any", the first press APPLIES the resting value rather than
    // stepping off it. `stepAtMiles(10)` is 5, so stepping would make the
    // first increment commit 15 and the first decrement 5 — leaving the
    // resting 10 unreachable in one press, and skipping the state the touch
    // path applies. The two entry points must agree.
    if (unsetLabel !== undefined) {
      onChangeMiles(value);
      return;
    }
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
    return {
      text: unset.value && unsetLabel !== undefined
        ? unsetLabel
        : formatMiles(Math.round(displayMiles.value)),
    } as never;
  });

  // What the readout and the track's accessibility value say at REST. Mid-drag
  // the readout is driven by the worklet above; this is the static fallback
  // and the string a screen reader is handed.
  const formatted = unsetLabel !== undefined ? unsetLabel : formatMiles(value);

  return (
    <View style={[styles.container, disabled && styles.disabled]} testID={testID}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
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
          accessibilityLabel={label}
          // ⚠️ TEXT ONLY WHILE UNSET. Publishing `now: 10` beside `text: "Any"`
          // lets TalkBack build a RangeInfo from min/max/now and announce a
          // numeric position — asserting a filter that is switched off, which
          // is the same untruth in the accessibility tree that the readout
          // just stopped telling on screen.
          accessibilityValue={
            unsetLabel !== undefined
              ? { text: unsetLabel }
              : {
                  min: MIN_RADIUS_MILES,
                  max: MAX_RADIUS_MILES,
                  now: value,
                  text: formatted,
                }
          }
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

const makeStyles = (c: Palette) => StyleSheet.create({
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
    color: c.textSecondary,
  },
  readout: {
    ...typography.cardTitle,
    color: c.textPrimary,
    paddingVertical: 0,
    textAlign: 'right',
    // ⚠️ Takes the row's spare width, so the frame does not come from whatever
    // string happened to MOUNT here. The worklet writes this TextInput's text
    // natively and Yoga never re-measures, so a box sized for "Any" (3 glyphs)
    // would clip "50 miles" on the first drag. Right-aligned against
    // headerRow's space-between, so it looks identical at rest.
    flex: 1,
  },
  trackRow: {
    height: sizes.touchTarget,
    justifyContent: 'center',
  },
  rail: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    // borderStrong, not border — a hairline track vanishes on this background.
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
});

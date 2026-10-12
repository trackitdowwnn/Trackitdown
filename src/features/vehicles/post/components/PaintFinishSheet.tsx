/**
 * WHAT:  PaintFinishSheet — "What's the finish on the blue?": Metallic, Matt,
 *        Pearl, Two-tone roof, each with a short line saying what it looks
 *        like, then "Not sure". One tap answers and closes it.
 * WHY:   Owner request, 2026-10-12: the finish chips sat at the bottom of the
 *        colour step, under twenty swatches. Asked on the way OUT instead —
 *        pick a colour, tap Next, this rises (ColourStep claims the wizard's
 *        Next; the Car details editor opens it from a row). A tap is the whole
 *        answer, so there is no confirm button.
 *
 *        ⚠️ "NOT SURE" STORES NOTHING (null) — the same as never being asked;
 *        the server has no value for it. So it is never shown CHECKED: null
 *        can't tell "chose Not sure" from "never asked". Only a stored finish
 *        is ticked.
 *
 *        ⚠️ A SWIPE IS NOT AN ANSWER. Closing it without a tap reports
 *        `onClosed(false)`, and the colour step stays put (owner decision):
 *        moving on always takes a deliberate tap.
 *
 *        The rows are WithdrawSightingSheet's grey boxes (a constant-width
 *        border, primary when chosen, and a tick) — not ListRow, whose pressed
 *        state is the same grey, so a tap would show nothing.
 * LINKS: src/shared/lib/carColours.ts (COLOUR_FINISHES — the four, and
 *          their lines);
 *        ./postSteps.tsx (ColourStep — opens it);
 *        src/features/sightings/components/WithdrawSightingSheet.tsx (the rows);
 *        src/shared/wizard/types.ts (claimNext).
 */

import { Check } from 'lucide-react-native';
import { useImperativeHandle, useRef, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOUR_FINISHES, type ColourFinish } from '@/shared/lib';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { BottomSheet, type BottomSheetRef } from '@/shared/ui';

export interface PaintFinishSheetRef {
  open: () => void;
  close: () => void;
}

export interface PaintFinishSheetProps {
  ref?: Ref<PaintFinishSheetRef>;
  /** The colour it asks about ("Blue") — named in the question. */
  colour?: string | null;
  /** The stored finish — ticked when the sheet opens. */
  value: ColourFinish | null;
  /** A row was tapped: the finish, or null for "Not sure". The sheet closes
   *  itself after. */
  onPick: (finish: ColourFinish | null) => void;
  /** Fully closed — `picked` false for a swipe, the scrim or Back. */
  onClosed?: (picked: boolean) => void;
}

/**
 * A question, like the step's own "What colour is it?" — and about THIS
 * colour (UI review). Not "Is the blue metallic?": a yes/no over five answers.
 * Lower-cased mid-sentence; every plain colour is one word, and an escape
 * (the only multi-word names) never opens this.
 */
function question(colour: string | null | undefined): string {
  const name = colour?.trim().toLowerCase();
  return name ? `What’s the finish on the ${name}?` : 'What’s the paint finish?';
}

/** Long enough to absorb a double-tap while the sheet rises (it takes
 *  motion.standard), short enough that a skipped present is retried by the
 *  next deliberate Next. */
const DOUBLE_OPEN_MS = 600;

/** The four finishes, then "Not sure" (null). */
const OPTIONS: { value: ColourFinish | null; label: string; hint?: string }[] = [
  ...COLOUR_FINISHES,
  { value: null, label: 'Not sure' },
];

export function PaintFinishSheet({ ref, colour, value, onPick, onClosed }: PaintFinishSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const sheetRef = useRef<BottomSheetRef>(null);
  // A double-tapped Next must not present it twice before the scrim lands.
  // ⚠️ A WINDOW, NOT A LATCH (code review): a latch cleared only by onDismiss
  // would wedge the step for good if gorhom ever skipped a present (it can —
  // see BottomSheet's presentedRef), since no dismiss would ever come. Past
  // the window, a Next can always try again; with the sheet really up, its
  // scrim covers Next anyway.
  const openedAt = useRef(Number.NEGATIVE_INFINITY);
  // The first tap is the answer; a second one while it closes is ignored.
  const pickedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      const now = performance.now();
      if (now - openedAt.current < DOUBLE_OPEN_MS) return;
      openedAt.current = now;
      pickedRef.current = false;
      sheetRef.current?.open();
    },
    close: () => sheetRef.current?.close(),
  }));

  const pick = (finish: ColourFinish | null) => {
    if (pickedRef.current) return;
    pickedRef.current = true;
    onPick(finish);
    sheetRef.current?.close();
  };

  const title = question(colour);

  return (
    <BottomSheet
      ref={sheetRef}
      title={title}
      onDismiss={() => {
        openedAt.current = Number.NEGATIVE_INFINITY;
        onClosed?.(pickedRef.current);
      }}
    >
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {OPTIONS.map((option) => {
          // Only a stored finish is ticked — never "Not sure" (see header).
          const chosen = option.value !== null && option.value === value;
          return (
            <Pressable
              key={option.label}
              onPress={() => pick(option.value)}
              accessibilityRole="radio"
              // The line under it is CONTENT, so it is in the label — a hint
              // goes unheard with hints turned off (ListRow's title+subtitle).
              accessibilityLabel={option.hint ? `${option.label}, ${option.hint}` : option.label}
              accessibilityState={{ checked: chosen }}
              style={({ pressed }) => [
                styles.option,
                chosen && styles.optionChosen,
                pressed && styles.optionPressed,
              ]}
              testID={`paint-finish-${option.value ?? 'not-sure'}`}
            >
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                {option.hint ? <Text style={styles.optionHint}>{option.hint}</Text> : null}
              </View>
              {/* The tick's room is kept when it isn't there, so choosing a
                  row never narrows its text and rewraps it (ListRow's spacer). */}
              {chosen ? (
                <Check size={sizes.iconSm} color={palette.textPrimary} />
              ) : (
                <View style={styles.tickSpacer} />
              )}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    options: {
      gap: spacing.sm,
    },
    // WithdrawSightingSheet's grey box: a constant-width border, transparent
    // at rest, so choosing one only changes its colour — nothing reflows.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: sizes.control,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      borderWidth: sizes.selectBorder,
      borderColor: 'transparent',
      backgroundColor: c.surfaceSubtle,
    },
    optionChosen: {
      borderColor: c.primary,
    },
    optionPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    optionText: {
      flex: 1,
      gap: spacing.xs,
    },
    // Wraps at large text — never "…".
    optionLabel: {
      ...typography.body,
      color: c.textPrimary,
    },
    optionHint: {
      ...typography.caption,
      color: c.textSecondary,
    },
    tickSpacer: {
      width: sizes.iconSm,
      height: sizes.iconSm,
    },
  });

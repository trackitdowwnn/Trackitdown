/**
 * WHAT:  WithdrawSightingSheet — "Why are you taking this back?" (with a small
 *        "Optional" tag), four fixed answers each in a light grey rounded box,
 *        then [Take it back] / [Cancel].
 * WHY:   2026-10-09 (owner request): the owner is now told when a sighting is
 *        taken back, and wanted to know why. It replaces the plain
 *        ConfirmDialog the withdraw flow used, keeping its destructive confirm.
 *
 *        ⚠️ THE QUESTION IS THE WHOLE SHEET (owner request, the same day):
 *        the "Take this report back?" title and its explanatory lines went,
 *        and the "Optional. If the owner was told…" sentence became a small
 *        "Optional" tag under the question — the owner found the longer
 *        version too much to read for one tap. The irreversible facts are
 *        said by the toast that follows instead: "Report taken back — the
 *        owner no longer sees it. You can't re-file it for this car today."
 *
 *        ⚠️ GREY BOXES, LIKE THE TAG (owner request): each answer is a
 *        surfaceSubtle rounded box, one per line (chips wrapped raggedly and
 *        "looked jumbled"); the chosen one gains a primary outline — a
 *        constant-width border, colour-only on select, so nothing reflows
 *        (CardSelect's rule) — and a tick. "Keep it" became "Cancel", in the
 *        matching subtle grey. Own rows rather than ListRow: ListRow's pressed
 *        state IS surfaceSubtle, so on a grey box a tap would show nothing.
 *
 *        ⚠️ OPTIONAL, AND NOTHING PRESELECTED. Taking back a report you doubt
 *        is the right thing to do; the sheet must not make it harder, nor
 *        put words in the spotter's mouth. Tapping the chosen answer again
 *        clears it (and a screen reader is told so). No answer → the owner
 *        reads "The spotter withdrew it." The answers wrap at large text —
 *        never "…": the spotter must read what the owner will be told.
 *
 *        ⚠️ FIXED ANSWERS — AND ONE OPTIONAL NOTE, IN-APP ONLY (owner request,
 *        the same day). The answer reaches the owner's lock screen as a
 *        sentence built in SQL. Choosing "Something else" opens a short text
 *        box under it ("Tell the owner more", ≤200); the push only says a note
 *        exists, and the owner reads the words on their listing. It is
 *        unmoderated (SECURITY_AND_TRUST §3, §7), so the box says plainly who
 *        reads it. Switching to another answer hides the box but keeps the
 *        text; it is only ever sent with "Something else".
 * LINKS: ../lib/withdrawReasons.ts (the answers, the note's rules);
 *        ../screens/MySightingsScreen.tsx (opens it, sends the withdrawal);
 *        src/shared/ui/CardSelect.tsx (the constant-border select rule);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql;
 *        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql.
 */

import { Check } from 'lucide-react-native';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import {
  MAX_WITHDRAW_NOTE_LENGTH,
  WITHDRAW_REASONS,
  WITHDRAW_REASON_LABELS,
  type WithdrawReason,
} from '../lib/withdrawReasons';

export interface WithdrawSightingSheetRef {
  /** Open with no answer chosen. */
  open: () => void;
  close: () => void;
}

export interface WithdrawSightingSheetProps {
  ref?: Ref<WithdrawSightingSheetRef>;
  /** Confirmed — with the chosen answer (null when they skipped it) and,
   *  with "Something else" only, what they typed (null otherwise). */
  onConfirm: (reason: WithdrawReason | null, note: string | null) => void;
  /** Closed without taking it back (Cancel, swipe, scrim, Back). */
  onDismiss?: () => void;
}

const QUESTION = 'Why are you taking this back?';

/** The question, its answers and the decision — see the header. */
export function WithdrawSightingSheet({ ref, onConfirm, onDismiss }: WithdrawSightingSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const sheetRef = useRef<BottomSheetRef>(null);
  const [reason, setReason] = useState<WithdrawReason | null>(null);
  const [note, setNote] = useState('');
  // A confirm-close is not a dismissal: onDismiss is for "Cancel".
  const confirmed = useRef(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      confirmed.current = false;
      // Every report starts unanswered — never the last one's answer, nor
      // the last one's note.
      setReason(null);
      setNote('');
      sheetRef.current?.open();
    },
    close: () => sheetRef.current?.close(),
  }));

  return (
    <BottomSheet
      ref={sheetRef}
      onDismiss={() => {
        if (!confirmed.current) onDismiss?.();
      }}
    >
      <View style={styles.content}>
        {/* The sheet's own heading (BottomSheet's title style), with a small
            "Optional" tag ALWAYS beneath it. One element to a screen reader:
            "Why are you taking this back? Optional", heard once. */}
        <View
          style={styles.header}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${QUESTION} Optional`}
        >
          <Text style={styles.title}>{QUESTION}</Text>
          <View style={styles.tag}>
            <Text style={styles.tagText}>Optional</Text>
          </View>
        </View>

        <View style={styles.answers}>
          {/* Labelled by the question alone: the header above already said
              it is optional, once. */}
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={QUESTION}>
            {WITHDRAW_REASONS.map((value) => {
              const chosen = reason === value;
              return (
                <Pressable
                  key={value}
                  // Tap the chosen answer again to clear it — it is optional.
                  onPress={() => setReason((current) => (current === value ? null : value))}
                  accessibilityRole="radio"
                  accessibilityLabel={WITHDRAW_REASON_LABELS[value]}
                  accessibilityState={{ selected: chosen }}
                  accessibilityHint={
                    chosen
                      ? 'Double tap to clear'
                      : value === 'other'
                        ? 'Opens a box to tell the owner more'
                        : undefined
                  }
                  style={({ pressed }) => [
                    styles.option,
                    chosen && styles.optionChosen,
                    pressed && styles.optionPressed,
                  ]}
                  testID={`withdraw-reason-${value}`}
                >
                  <Text style={styles.optionLabel}>{WITHDRAW_REASON_LABELS[value]}</Text>
                  {chosen ? <Check size={sizes.iconSm} color={palette.textPrimary} /> : null}
                </Pressable>
              );
            })}
          </View>
          {/* "Something else", chosen: the note box directly beneath it —
              OUTSIDE the radio group, so a screen reader never counts a text
              field among the answers ("Something else" is last, so nothing
              moves). Fades in, as inline follow-ups do. */}
          {reason === 'other' ? (
            <Animated.View
              entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
            >
              <TextField
                label="Tell the owner more"
                variant="multiline"
                value={note}
                onChangeText={setNote}
                helperText="Only the owner sees this, in the app."
                counter={`${note.length}/${MAX_WITHDRAW_NOTE_LENGTH}`}
                // The counter is hidden from screen readers (TextField's
                // contract); the limit goes here instead. The helper text
                // already says who reads it.
                accessibilityHint={`Up to ${MAX_WITHDRAW_NOTE_LENGTH} characters.`}
                maxLength={MAX_WITHDRAW_NOTE_LENGTH}
                // A short note, one paragraph: "Done" puts the keyboard away
                // (a multiline iOS keyboard has no other way down) so Take it
                // back is never stranded beneath it.
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                testID="withdraw-note"
              />
            </Animated.View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            label="Take it back"
            variant="danger"
            onPress={() => {
              // One withdrawal per open: a quick double tap while the sheet
              // closes would send it twice (the second refused, with an error
              // toast after the success one).
              if (confirmed.current) return;
              confirmed.current = true;
              sheetRef.current?.close();
              // The note only ever goes with "Something else" — text typed
              // there and then left for another answer is not sent. Sent as
              // typed: withdrawSighting cleans and trims it (cleanWithdrawNote).
              onConfirm(reason, reason === 'other' && note.trim() !== '' ? note : null);
            }}
          />
          <Button label="Cancel" variant="subtle" onPress={() => sheetRef.current?.close()} />
        </View>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      gap: spacing.lg,
    },
    header: {
      alignItems: 'flex-start',
      gap: spacing.xs,
    },
    // BottomSheet's own title style, so the sheet reads as titled by the
    // question.
    title: {
      ...typography.heading,
      color: c.textPrimary,
    },
    // Small and quiet: a hint, not an instruction. StatusPill's size.
    tag: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    tagText: {
      ...typography.caption,
      color: c.textSecondary,
    },
    options: {
      gap: spacing.sm,
    },
    // The answers, then — with "Something else" — its note box, 8 below it
    // so the two read as one answer.
    answers: {
      gap: spacing.sm,
    },
    // The tag's grey, as a full-width rounded box (owner request). A
    // constant-width border, transparent at rest, so choosing one only
    // changes its colour — nothing reflows (CardSelect's rule).
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
    // Wraps at large text — never "…".
    optionLabel: {
      ...typography.body,
      color: c.textPrimary,
      flex: 1,
    },
    actions: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
  });

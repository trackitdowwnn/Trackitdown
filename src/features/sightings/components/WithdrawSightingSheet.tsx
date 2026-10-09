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
 *        ⚠️ FIXED ANSWERS, NO TEXT BOX. The answer reaches the owner's lock
 *        screen as a sentence built in SQL; a stranger's own words can't be
 *        moderated yet (SECURITY_AND_TRUST §3, §7).
 * LINKS: ../lib/withdrawReasons.ts (the answers);
 *        ../screens/MySightingsScreen.tsx (opens it, sends the withdrawal);
 *        src/shared/ui/CardSelect.tsx (the constant-border select rule);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql.
 */

import { Check } from 'lucide-react-native';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

import {
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
  /** Confirmed — with the chosen answer, or null when they skipped it. */
  onConfirm: (reason: WithdrawReason | null) => void;
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
  // A confirm-close is not a dismissal: onDismiss is for "Cancel".
  const confirmed = useRef(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      confirmed.current = false;
      // Every report starts unanswered — never the last one's answer.
      setReason(null);
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

        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel={`${QUESTION} Optional.`}
        >
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
                accessibilityHint={chosen ? 'Double tap to clear' : undefined}
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
              onConfirm(reason);
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

/**
 * WHAT:  WithdrawSightingSheet — "Why are you taking this back?" (with a small
 *        "Optional" tag), four fixed answers in a single column, then
 *        [Take it back] / [Keep it].
 * WHY:   2026-10-09 (owner request): the owner is now told when a sighting is
 *        taken back, and wanted to know why. It replaces the plain
 *        ConfirmDialog the withdraw flow used, keeping its destructive confirm.
 *
 *        ⚠️ THE QUESTION IS THE WHOLE SHEET (owner request, the same day):
 *        the "Take this report back?" title and its explanatory lines went,
 *        and the "Optional. If the owner was told…" sentence became a small
 *        "Optional" tag beside the question — the owner found the longer
 *        version too much to read for one tap. The irreversible facts (the
 *        owner stops seeing it; it can't be re-filed today) are still said by
 *        the destructive button and the toast that follows.
 *
 *        ⚠️ ONE COLUMN, NOT CHIPS (owner: the chips "looked jumbled"). Four
 *        sentence-length answers wrapped raggedly as chips; ListRow's chooser
 *        rows sit one per line with a check on the chosen one — the pattern
 *        CollectionPickerSheet uses for the same job.
 *
 *        ⚠️ OPTIONAL, AND NOTHING PRESELECTED. Taking back a report you doubt
 *        is the right thing to do; the sheet must not make it harder, nor
 *        put words in the spotter's mouth. Tapping the chosen answer again
 *        clears it (and a screen reader is told so). No answer → the owner
 *        reads "The spotter withdrew it."
 *
 *        ⚠️ FIXED ANSWERS, NO TEXT BOX. The answer reaches the owner's lock
 *        screen as a sentence built in SQL; a stranger's own words can't be
 *        moderated yet (SECURITY_AND_TRUST §3, §7).
 * LINKS: ../lib/withdrawReasons.ts (the answers);
 *        ../screens/MySightingsScreen.tsx (opens it, sends the withdrawal);
 *        src/shared/ui/ListRow.tsx (the chooser rows);
 *        src/features/watchlist/components/CollectionPickerSheet.tsx (the
 *          same single-column chooser in a sheet);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql.
 */

import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, ListRow, type BottomSheetRef } from '@/shared/ui';

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
  /** Closed without taking it back (Keep it, swipe, scrim, Back). */
  onDismiss?: () => void;
}

const QUESTION = 'Why are you taking this back?';

/** The question, its answers and the decision — see the header. */
export function WithdrawSightingSheet({ ref, onConfirm, onDismiss }: WithdrawSightingSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);
  const [reason, setReason] = useState<WithdrawReason | null>(null);
  // A confirm-close is not a dismissal: onDismiss is for "Keep it".
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
        {/* The sheet's own heading (BottomSheet's title style), with the
            "Optional" tag beside it rather than a sentence beneath. */}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {QUESTION}
          </Text>
          <View style={styles.tag} accessible accessibilityLabel="Optional">
            <Text style={styles.tagText}>Optional</Text>
          </View>
        </View>

        <View
          style={styles.list}
          accessibilityRole="radiogroup"
          accessibilityLabel={`${QUESTION} Optional.`}
        >
          {WITHDRAW_REASONS.map((value) => {
            const chosen = reason === value;
            return (
              <ListRow
                key={value}
                title={WITHDRAW_REASON_LABELS[value]}
                selected={chosen}
                // Tap the chosen answer again to clear it — it is optional.
                onPress={() => setReason((current) => (current === value ? null : value))}
                accessibilityHint={chosen ? 'Double tap to clear' : undefined}
                testID={`withdraw-reason-${value}`}
              />
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
          <Button label="Keep it" variant="ghost" onPress={() => sheetRef.current?.close()} />
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
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    // BottomSheet's own title style, so the sheet reads as titled by the
    // question.
    title: {
      ...typography.heading,
      color: c.textPrimary,
      flexShrink: 1,
    },
    // Small and quiet: a hint, not an instruction.
    tag: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.full,
      // StatusPill's padding: the app's one small-tag size.
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    tagText: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // ListRow insets its own content by `md`; pulling the list out by the
    // same amount lines each answer up with the question above it.
    list: {
      marginHorizontal: -spacing.md,
    },
    actions: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
  });

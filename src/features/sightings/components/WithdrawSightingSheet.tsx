/**
 * WHAT:  WithdrawSightingSheet — "Take this report back?": what taking it back
 *        means, an OPTIONAL "Why are you taking it back?" with four fixed
 *        answers, then [Take it back] / [Keep it].
 * WHY:   2026-10-09 (owner request): the owner is now told when a sighting is
 *        taken back, and wanted to know why. It replaces the plain
 *        ConfirmDialog the withdraw flow used, keeping its words and its
 *        destructive confirm — withdrawing still cannot be undone and still
 *        spends the day's slot for that car.
 *
 *        ⚠️ OPTIONAL, AND NOTHING PRESELECTED. Taking back a report you doubt
 *        is the right thing to do; the sheet must not make it harder, nor
 *        put words in the spotter's mouth. Tapping the chosen answer again
 *        clears it. No answer → the owner reads "The spotter withdrew it."
 *
 *        ⚠️ FIXED ANSWERS, NO TEXT BOX. The answer reaches the owner's lock
 *        screen as a sentence built in SQL; a stranger's own words can't be
 *        moderated yet (SECURITY_AND_TRUST §3, §7). The copy says the owner is
 *        told "if they were told about it": the notice only follows a
 *        sighting the owner heard about (the claim's notified_at gate), and a
 *        promise wider than that would be untrue.
 * LINKS: ../lib/withdrawReasons.ts (the answers);
 *        ../screens/MySightingsScreen.tsx (opens it, sends the withdrawal);
 *        src/shared/ui/ConfirmDialog.tsx (the shape it extends);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql.
 */

import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, CardSelect, type BottomSheetRef } from '@/shared/ui';

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

const QUESTION = 'Why are you taking it back?';

const OPTIONS = WITHDRAW_REASONS.map((value) => ({
  value,
  label: WITHDRAW_REASON_LABELS[value],
}));

/** "Take this report back?", with an optional why — see the header. */
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
      title="Take this report back?"
      onDismiss={() => {
        if (!confirmed.current) onDismiss?.();
      }}
    >
      <View style={styles.content}>
        <Text style={styles.body}>
          The owner will no longer see it, and you can’t re-file it for this car today.
        </Text>
        <Text style={styles.body}>
          If they were told about it, we’ll let them know it was taken back — and why, if you say.
        </Text>

        <View style={styles.question}>
          <Text style={styles.questionLabel} accessibilityRole="header">
            {QUESTION} <Text style={styles.optional}>(optional)</Text>
          </Text>
          <CardSelect
            options={OPTIONS}
            value={reason}
            // Tap the chosen answer again to clear it — it is optional.
            onSelect={(value) => setReason((current) => (current === value ? null : value))}
            accessibilityLabel={`${QUESTION} Optional.`}
          />
        </View>

        <Button
          label="Take it back"
          variant="danger"
          onPress={() => {
            confirmed.current = true;
            sheetRef.current?.close();
            onConfirm(reason);
          }}
        />
        <Button label="Keep it" variant="ghost" onPress={() => sheetRef.current?.close()} />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      gap: spacing.md,
    },
    body: {
      ...typography.body,
      color: c.textSecondary,
    },
    question: {
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    questionLabel: {
      ...typography.label,
      color: c.textPrimary,
    },
    optional: {
      color: c.textSecondary,
    },
  });

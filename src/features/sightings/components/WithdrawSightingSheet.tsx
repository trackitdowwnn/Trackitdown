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
 *        moderated yet (SECURITY_AND_TRUST §3, §7). The hint promises only
 *        what the server does: the notice follows a sighting the owner heard
 *        about, on a listing that is still up (the claim's notified_at and
 *        active gates).
 *
 *        Chips, not cards, and one body line (ui review of #150): as cards
 *        with a second paragraph the sheet reached ~660pt and pushed its
 *        buttons below the fold on a small phone (DESIGN_SYSTEM records the
 *        same failure at 740pt).
 * LINKS: ../lib/withdrawReasons.ts (the answers);
 *        ../screens/MySightingsScreen.tsx (opens it, sends the withdrawal);
 *        src/shared/ui/ConfirmDialog.tsx (the shape it extends);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql.
 */

import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, ChoiceChips, type BottomSheetRef } from '@/shared/ui';

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
      {/* Three blocks — the consequence, the question, the decision — 24pt
          apart, so "Take it back" never reads as a fifth answer. */}
      <View style={styles.content}>
        <Text style={styles.body}>
          The owner will no longer see it, and you can’t re-file it for this car today.
        </Text>

        <View style={styles.question}>
          <Text style={styles.questionLabel} accessibilityRole="header">
            {QUESTION}
          </Text>
          {/* ⚠️ Exactly as wide as the server's promise: the owner hears only
              if they were told of the sighting AND the listing is still up
              (the claim's notified_at + active gates). "Something else" sends
              no reason — the owner reads the same plain sentence as none. */}
          <Text style={styles.hint}>
            Optional. If the owner was told about it and the listing is still up, we’ll pass this
            on.
          </Text>
          {/* Chips, not cards (ui review of #150): the design system's
              control for an optional single answer — lighter than four
              bordered cards, and `clearable` tells a screen reader that the
              chosen answer can be tapped again to clear it. */}
          <ChoiceChips
            options={OPTIONS}
            value={reason}
            onSelect={(value) => setReason((current) => (current === value ? null : value))}
            clearable
            accessibilityLabel={`${QUESTION} Optional.`}
          />
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
      gap: spacing.xl,
    },
    body: {
      ...typography.body,
      color: c.textSecondary,
    },
    question: {
      gap: spacing.sm,
    },
    // A question header (DESIGN_SYSTEM: cardTitle, one step under the sheet's
    // title), with its grey hint beneath.
    questionLabel: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    hint: {
      ...typography.caption,
      color: c.textSecondary,
    },
    actions: {
      gap: spacing.md,
    },
  });

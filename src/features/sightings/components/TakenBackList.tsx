/**
 * WHAT:  TakenBackList — the owner's quiet "Taken back" list under their
 *        sighting activity: when each sighting was taken back, the sentence
 *        the notice gave, and — for "Something else" — the spotter's note,
 *        set apart and labelled "Written by the spotter".
 * WHY:   2026-10-09 (owner request): a spotter may say more when they take a
 *        sighting back, and the owner reads it HERE, in the app — never in a
 *        push (SECURITY_AND_TRUST §3). The "taken back" notice opens this
 *        listing, so this is where the owner lands.
 *
 *        ⚠️ THE NOTE IS A STRANGER'S, UNMODERATED (§7). It is labelled as the
 *        spotter's own words and set apart by the inline-quote rule (as
 *        "In their words" is on a sighting), so it never reads as ours. No
 *        name, photo or place sits beside it — the server sends none.
 *
 *        Quiet by design: secondary to the live sightings above it, so
 *        nothing renders when there is nothing to show; three newest, then
 *        "Show N more" in place.
 * LINKS: src/features/sightings/hooks/usePostWithdrawals.ts;
 *        src/features/sightings/lib/withdrawReasons.ts (withdrawalSentence);
 *        src/features/sightings/components/SightingSeenSection.tsx (the
 *        inline-quote form).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import { sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { withdrawalSentence } from '../lib/withdrawReasons';
import type { PostWithdrawal } from '../types';

/** Newest shown before "Show N more". */
const PREVIEW_LIMIT = 3;

export interface TakenBackListProps {
  withdrawals: PostWithdrawal[];
}

export function TakenBackList({ withdrawals }: TakenBackListProps) {
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  if (withdrawals.length === 0) return null;

  const shown = expanded ? withdrawals : withdrawals.slice(0, PREVIEW_LIMIT);
  const hidden = withdrawals.length - shown.length;

  return (
    <View style={styles.block} testID="taken-back">
      <Text style={styles.heading} accessibilityRole="header">
        Taken back
      </Text>
      {shown.map((withdrawal, index) => (
        <TakenBackRow key={`${withdrawal.withdrawnAt}-${index}`} withdrawal={withdrawal} />
      ))}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${hidden} more taken back`}
          onPress={() => setExpanded(true)}
          style={styles.linkRow}
          hitSlop={spacing.sm}
        >
          <Text style={styles.link}>Show {hidden} more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TakenBackRow({ withdrawal }: { withdrawal: PostWithdrawal }) {
  const styles = useThemedStyles(makeStyles);
  const when = useTimeAgo(withdrawal.withdrawnAt);
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Text style={styles.sentence}>{withdrawalSentence(withdrawal.reason)}</Text>
        <Text style={styles.when}>{when}</Text>
      </View>
      {withdrawal.note ? (
        // One element to a screen reader, so the label and the words are
        // never heard apart: "Written by the spotter: …".
        <View
          style={styles.note}
          accessible
          accessibilityLabel={`Written by the spotter: ${withdrawal.note}`}
          testID="taken-back-note"
        >
          <Text style={styles.noteLabel}>Written by the spotter</Text>
          <Text style={styles.noteText}>{withdrawal.note}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.md,
    },
    // The timeline's day-header voice: a quiet label, not a second title.
    heading: {
      ...typography.label,
      color: c.textSecondary,
    },
    row: {
      gap: spacing.sm,
    },
    line: {
      gap: spacing.xs,
    },
    sentence: {
      ...typography.body,
      color: c.textPrimary,
    },
    when: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // The design system's inline-quote form (SightingSeenSection's): their
    // words set apart by a rule rather than quote marks.
    note: {
      gap: spacing.xs,
      borderLeftWidth: sizes.followUpRule,
      borderLeftColor: c.border,
      paddingLeft: spacing.md,
    },
    noteLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    noteText: {
      ...typography.body,
      color: c.textPrimary,
    },
    linkRow: {
      alignSelf: 'flex-start',
      minHeight: sizes.touchTarget,
      justifyContent: 'center',
    },
    link: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });

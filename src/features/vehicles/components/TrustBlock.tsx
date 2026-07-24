/**
 * WHAT:  TrustBlock — the verification row on the post detail, in the
 *        reference's highlight anatomy: a 48pt icon tile, a headline fact,
 *        and one calm evidence line. Ownership verified / pending. (The
 *        listed-on date moved to the title block and "Active until" was
 *        dropped — product call 2026-07-23.)
 * WHY:   The trust anchor — the section that answers "is this real?", so it
 *        carries the page's richest row treatment (GAP_ANALYSIS B1 + F2).
 *        "Ownership verified" is DERIVED, not stored: a visible non-owner post
 *        is 'active', which by the anti-stalking rule means it passed V5C
 *        verification. An owner viewing their own draft / pending post sees
 *        the pending state instead. Evidence copy is procedural fact, never
 *        selling warmth (emotional translation, GAP_ANALYSIS).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        docs/DOMAIN.md (lifecycle); docs/SECURITY_AND_TRUST.md §2;
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §5.
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import type { PostStatus } from '@/shared/types';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** Statuses that have DEFINITELY passed ownership verification (all reachable
 *  only from 'active'). `cancelled` and `rejected` are excluded: a post can be
 *  cancelled straight from pending_verification, so "verified" can't be
 *  inferred; rejected never passed. */
const VERIFIED: PostStatus[] = [
  'active',
  'recovery_claimed',
  'recovered',
  'recovered_no_spotter',
  'expired',
];
const PENDING: PostStatus[] = ['draft', 'pending_verification'];

/** Whether TrustBlock renders anything for this status — lets the page skip
 *  the section (and its divider) instead of framing an empty block. */
export function hasTrustRow(status: PostStatus): boolean {
  return VERIFIED.includes(status) || PENDING.includes(status);
}

export interface TrustBlockProps {
  status: PostStatus;
}

type Tone = 'verified' | 'pending' | 'neutral';

interface Row {
  icon: FeatherName;
  label: string;
  /** One calm, procedural evidence line — only where there is a real fact to
   *  cite; never decorative filler. */
  evidence?: string;
  tone: Tone;
}

const TONE_COLOR: Record<Tone, string> = {
  // Affirmative green — a passive trust marker, NOT an action, so it must not
  // wear the `primary` CTA colour (ADR-0006: primary near-black = actions only).
  verified: colors.success,
  pending: colors.warning,
  neutral: colors.textSecondary,
};

export function TrustBlock({ status }: TrustBlockProps) {
  const rows: Row[] = [];

  if (PENDING.includes(status)) {
    rows.push({
      icon: 'clock',
      label: 'Pending verification',
      evidence: 'We’re checking the owner’s V5C logbook before this post goes live.',
      tone: 'pending',
    });
  } else if (VERIFIED.includes(status)) {
    rows.push({
      icon: 'check-circle',
      label: 'Ownership verified',
      evidence: 'The owner’s V5C logbook was checked before this post went live.',
      tone: 'verified',
    });
  }
  // cancelled / rejected → no verification row; the section disappears
  // rather than rendering an empty shell.
  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        // Evidence rows top-align text against the tile; single-line rows
        // centre against it (a 24pt label reads 8pt high otherwise).
        <View
          key={row.label}
          style={[styles.row, row.evidence ? styles.rowTop : styles.rowCentered]}
          accessible
        >
          <View style={styles.tile}>
            <Feather
              name={row.icon}
              size={sizes.icon}
              color={TONE_COLOR[row.tone]}
              importantForAccessibility="no"
            />
          </View>
          <View style={[styles.text, row.evidence ? styles.textTopPad : null]}>
            <Text style={styles.label}>{row.label}</Text>
            {row.evidence ? <Text style={styles.evidence}>{row.evidence}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  // Two-line evidence rows keep the tile level with the headline …
  rowTop: {
    alignItems: 'flex-start',
  },
  // … single-line rows centre against the 48pt tile.
  rowCentered: {
    alignItems: 'center',
  },
  tile: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  // Optical nudge for top-aligned evidence rows only.
  textTopPad: {
    paddingTop: spacing.xs,
  },
  label: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  evidence: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

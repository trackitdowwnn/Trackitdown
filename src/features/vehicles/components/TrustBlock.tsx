/**
 * WHAT:  TrustBlock — the quiet, factual verification/record rows on the post
 *        detail: ownership verified (or, for the owner's own unverified post,
 *        "Pending verification"), when it was posted, and when it expires.
 * WHY:   The trust anchor. "Ownership verified" is DERIVED, not stored: a
 *        visible non-owner post is 'active', which by the anti-stalking rule
 *        means it passed V5C verification. An owner viewing their own draft /
 *        pending post sees the pending state instead.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        docs/DOMAIN.md (lifecycle); docs/SECURITY_AND_TRUST.md §2 (verification).
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateLabel } from '@/shared/lib';
import { colors, sizes, spacing, typography } from '@/shared/theme';
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

export interface TrustBlockProps {
  status: PostStatus;
  createdAt: string;
  expiresAt?: string;
}

type Tone = 'verified' | 'pending' | 'neutral';

interface Row {
  icon: FeatherName;
  label: string;
  tone: Tone;
}

const TONE_COLOR: Record<Tone, string> = {
  verified: colors.primary, // sage — affirmative; success is reserved for payouts
  pending: colors.warning,
  neutral: colors.textSecondary,
};

export function TrustBlock({ status, createdAt, expiresAt }: TrustBlockProps) {
  const rows: Row[] = [];

  if (PENDING.includes(status)) {
    rows.push({ icon: 'clock', label: 'Pending verification', tone: 'pending' });
  } else if (VERIFIED.includes(status)) {
    rows.push({ icon: 'check-circle', label: 'Ownership verified', tone: 'verified' });
  }
  // cancelled / rejected → no verification row.

  rows.push({ icon: 'calendar', label: `Posted ${formatDateLabel(createdAt)}`, tone: 'neutral' });

  // "Active until" only matters while the post is live.
  if (status === 'active' && expiresAt) {
    rows.push({
      icon: 'clock',
      label: `Active until ${formatDateLabel(expiresAt)}`,
      tone: 'neutral',
    });
  }

  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        <View key={row.label} style={styles.row} accessible>
          <Feather
            name={row.icon}
            size={sizes.iconSm}
            color={TONE_COLOR[row.tone]}
            importantForAccessibility="no"
          />
          <Text style={styles.label}>{row.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});

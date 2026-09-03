/**
 * WHAT:  StillMissingBanner — the owner-only card on a live listing that asks
 *        "is this car still missing?" and offers both answers.
 * WHY:   ADR-0019. This is the DOOR, and the push is only a reminder that it
 *        exists — review finding #15 was a screen reachable only by
 *        notification, and the audience for this question is by definition
 *        someone who has stopped opening the app.
 *
 *        ⚠️ THE REGISTER IS THE DESIGN. The reader's car is stolen and we are
 *        interrupting them to ask about it, so: no exclamation, no "just
 *        checking in", no illustration, no countdown. It states why it is here
 *        in one line and puts both answers one tap away. `surfaceSubtle` rather
 *        than a warning hue for the same reason — nothing is wrong, nothing
 *        expires, and nothing about this is urgent to anyone but us.
 *
 *        Two buttons of EQUAL weight, both secondary. "I've found it" is the
 *        outcome everyone wants, but making it the primary would put a thumb on
 *        a scale that decides where real money goes — the recovery flow behind
 *        it releases escrow, and it must be chosen, not defaulted into.
 * LINKS: src/features/vehicles/hooks/useStillMissingAsk.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the mount);
 *        docs/decisions/ADR-0019-the-abandoned-post.md.
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button } from '@/shared/ui';

export interface StillMissingBannerProps {
  /** "Yes, still missing" — resets the clock. */
  onStillMissing: () => void;
  /** "I've found it" — into the existing recovery flow, unchanged. */
  onFound: () => void;
  /** Disables both while the confirm is in flight. */
  busy?: boolean;
}

export function StillMissingBanner({ onStillMissing, onFound, busy }: StillMissingBannerProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card} testID="still-missing-banner">
      <Text style={styles.title} accessibilityRole="header">
        Is this car still missing?
      </Text>
      {/* Says why we are asking, so the interruption is accounted for. It is
          also true: nothing else in the system knows unless the owner says. */}
      <Text style={styles.body}>
        We ask now and then so spotters aren’t looking for a car that’s already home.
      </Text>
      <View style={styles.actions}>
        <Button
          label="Yes, still missing"
          variant="secondary"
          onPress={onStillMissing}
          loading={busy}
        />
        <Button label="I’ve found it" variant="secondary" onPress={onFound} disabled={busy} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      padding: spacing.md,
      gap: spacing.xs,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
    },
    title: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    body: {
      ...typography.caption,
      color: c.textSecondary,
    },
    actions: {
      // Stacked, not side by side: at 200% type two labels this long on one row
      // either truncate or shrink the touch targets below the floor.
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
  });

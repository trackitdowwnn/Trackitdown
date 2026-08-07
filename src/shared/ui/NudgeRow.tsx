/**
 * WHAT:  NudgeRow — the feed's compact setup-offer row: a leading icon, one
 *        bold line, one supporting line, and an optional dismiss ×. The whole
 *        row is the action.
 * WHY:   The feed's nudges (location primer, garage — the alert-area one has
 *        since become a root sheet) were each
 *        a ~265dp card stacked above all content — whichever one showed, the
 *        Explore tab opened on a wall of setup rather than on cars. This is the
 *        same offer at ~64dp, so content leads and the offer rides alongside it.
 *        Shared rather than feature-local because both use it: the trigger
 *        SaveYourCarCard named ("promote to shared/ui only if a second
 *        dismissible card appears") has been met.
 *
 *        NOT ListRow — that is explicitly the settings-screen row (no borders,
 *        no radius, no dismiss) and would read as a settings row loose in a
 *        card feed.
 * LINKS: src/features/search-map/components/LocationPrimerCard.tsx;
 *        src/features/garage/components/SaveYourCarCard.tsx;
 *        docs/DESIGN_SYSTEM.md (feed-surface 16pt gutter exception).
 */

import { X, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

export interface NudgeRowProps {
  icon: LucideIcon;
  /** One bold line — the offer, named. */
  title: string;
  /** One supporting line — keep to ~38 characters so it fits on one line at
   *  default font scale. The detail belongs in the flow the row opens, not in
   *  the invitation to open it. */
  body: string;
  /** The whole row is the action. */
  onPress: () => void;
  /** Omit for a setup STEP (no ×); pass for a suggestion the user may refuse. */
  onDismiss?: () => void;
  testID?: string;
  dismissTestID?: string;
}

export const NudgeRow = memo(function NudgeRow({
  icon: Icon,
  title,
  body,
  onPress,
  onDismiss,
  testID,
  dismissTestID,
}: NudgeRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      // One object to a screen reader: the row reads as its offer, then the ×
      // is reached separately as its own control.
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={testID}
    >
      <Icon size={sizes.icon} color={colors.textPrimary} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {/* Two lines, not one: the copy is written to fit on one at default
            scale, but a user at a large font size must get the whole sentence
            rather than a word cut in half. */}
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={spacing.sm}
          onPress={onDismiss}
          style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
          testID={dismissTestID}
        >
          <X size={sizes.iconSm} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  text: {
    flex: 1,
  },
  title: {
    // Bold at body size — the offer is a card title, not a section header.
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dismiss: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the 44pt target back into the row's padding so the glyph still sits
    // on the edge without making the row taller than its content.
    marginVertical: -(sizes.touchTarget - sizes.iconSm) / 2,
    marginRight: -(sizes.touchTarget - sizes.iconSm) / 2,
  },
  dismissPressed: {
    opacity: opacity.pressed,
  },
});

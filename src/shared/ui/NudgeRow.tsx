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

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

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
  /**
   * Who owns the horizontal gutter. Default `'feed'` — the row insets itself by
   * the 16pt feed exception, which is what every original caller wants.
   *
   * ⚠️ PASS `'none'` INSIDE AN ALREADY-PADDED SCROLL. Forms and settings-shaped
   * screens pad at 24 (DESIGN_SYSTEM), so a self-inseting row lands at 40 and
   * is visibly narrower than everything beside it. A prop rather than a
   * negative margin at the call site: the negative margin is a lie in the
   * layout and silently breaks the day this constant moves.
   */
  gutter?: 'feed' | 'none';
  testID?: string;
  dismissTestID?: string;
}

export const NudgeRow = memo(function NudgeRow({
  icon: Icon,
  title,
  body,
  onPress,
  onDismiss,
  gutter = 'feed',
  testID,
  dismissTestID,
}: NudgeRowProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="button"
      // One object to a screen reader: the row reads as its offer, then the ×
      // is reached separately as its own control.
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        gutter === 'none' && styles.rowFlush,
        pressed && styles.rowPressed,
      ]}
      testID={testID}
    >
      <Icon size={sizes.icon} color={palette.textPrimary} />
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
          <X size={sizes.iconSm} color={palette.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The caller's scroll already owns the gutter — see the `gutter` prop.
    rowFlush: {
      marginHorizontal: 0,
    },
    row: {
      // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
    },
    rowPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    text: {
      flex: 1,
    },
    title: {
      // Bold at body size — the offer is a card title, not a section header.
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    body: {
      ...typography.caption,
      color: c.textSecondary,
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

/**
 * WHAT:  ListRow — the settings-style row: optional icon, title, optional
 *        value/subtitle, chevron when pressable, and a destructive variant.
 * WHY:   Every settings/hub screen (profile first; notifications, moderation
 *        later) needs the same calm row, so it lives here once: 52pt control
 *        height, body-weight title, quiet caption metadata, surfaceSubtle
 *        press feedback — no borders or shadows, just breathing room.
 *        Destructive rows (sign out is NOT one; delete account is) render in
 *        the muted danger tone, never alarm-red decoration.
 *
 *        Passing `selected` turns the row into a CHOOSER row: the chevron
 *        becomes a check (or a spacer), and the role becomes radio. That is one
 *        prop rather than a second component because the row itself — height,
 *        press feedback, title weight — is identical either way.
 * LINKS: src/features/profile (first consumer); src/features/watchlist
 *        (collection picker, the first chooser); docs/DESIGN_SYSTEM.md
 *        (Colour, Typography, Accessibility).
 *
 * Usage:
 *   <ListRow icon={Bell} title="Notifications" onPress={openNotifications} />
 *   <ListRow icon={Trash2} title="Delete account" destructive onPress={confirmDelete} />
 *   <ListRow title="My commute" selected={id === current} onPress={choose} />
 */

import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

export interface ListRowProps {
  title: string;
  icon?: LucideIcon;
  /** Small status text on the right (e.g. "Payouts ready"). */
  value?: string;
  /** Supporting line under the title. */
  subtitle?: string;
  onPress?: () => void;
  /** Muted danger tone for irreversible actions. */
  destructive?: boolean;
  /**
   * Marks this row as the current choice in a set: a check REPLACES the
   * chevron, since a row that is both "the answer" and "go deeper" reads as
   * neither. Rows in a group where nothing is chosen yet pass `false`, not
   * undefined, so the set stays a radio group to a screen reader.
   */
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function ListRow({
  title,
  icon: Icon,
  value,
  subtitle,
  onPress,
  destructive = false,
  selected,
  disabled = false,
  testID,
}: ListRowProps) {
  const titleColor = destructive ? colors.danger : colors.textPrimary;
  const iconColor = destructive ? colors.danger : colors.textSecondary;
  const pressable = Boolean(onPress) && !disabled;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && pressable && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      onPress={onPress}
      disabled={!pressable}
      // A row in a chooser is a radio, not a button: the role is what tells a
      // screen reader that `selected` means "this one of several" rather than
      // "this toggle is on".
      accessibilityRole={selected === undefined ? (onPress ? 'button' : undefined) : 'radio'}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      accessibilityLabel={[title, value, subtitle].filter(Boolean).join(', ')}
      testID={testID}
    >
      {Icon ? <Icon size={sizes.icon} color={iconColor} /> : null}
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {selected === undefined ? (
        pressable ? (
          <ChevronRight size={sizes.icon} color={colors.textSecondary} />
        ) : null
      ) : selected ? (
        <Check size={sizes.icon} color={colors.textPrimary} />
      ) : (
        // A same-size spacer, so the titles of chosen and unchosen rows line
        // up instead of shifting by an icon width down the list.
        <View style={styles.checkSpacer} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  rowDisabled: {
    opacity: opacity.disabled,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.body,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  value: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  checkSpacer: {
    width: sizes.icon,
    height: sizes.icon,
  },
});

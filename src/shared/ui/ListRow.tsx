/**
 * WHAT:  ListRow — the settings-style row: optional icon, title, optional
 *        value/subtitle, chevron when pressable, and a destructive variant.
 * WHY:   Every settings/hub screen (profile first; notifications, moderation
 *        later) needs the same calm row, so it lives here once: 52pt control
 *        height, body-weight title, quiet caption metadata, surfaceSubtle
 *        press feedback — no borders or shadows, just breathing room.
 *        Destructive rows (sign out is NOT one; delete account is) render in
 *        the muted danger tone, never alarm-red decoration.
 * LINKS: src/features/profile (first consumer); docs/DESIGN_SYSTEM.md
 *        (Colour, Typography, Accessibility).
 *
 * Usage:
 *   <ListRow icon={Bell} title="Notifications" onPress={openNotifications} />
 *   <ListRow icon={Trash2} title="Delete account" destructive onPress={confirmDelete} />
 */

import { ChevronRight, type LucideIcon } from 'lucide-react-native';
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
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
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
      {pressable ? <ChevronRight size={sizes.icon} color={colors.textSecondary} /> : null}
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
});

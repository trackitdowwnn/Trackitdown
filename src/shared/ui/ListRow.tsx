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
import type { ReactNode } from 'react';
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
  /**
   * Marks this row as a SWITCH: `toggled` drives the accessibility state and
   * the role, and the row's own press should flip it. Pass the Switch itself
   * as `trailing` — this prop is the semantics, that one is the pixels.
   *
   * Separate from `selected` because the two mean different things to a screen
   * reader: `selected` is "this one of several" (radio), `toggled` is "this is
   * on or off" (switch). A settings row that reads as a radio invites a hunt
   * for the other options.
   */
  toggled?: boolean;
  /**
   * Replaces the chevron/check at the row's end — for a Switch or any other
   * control that IS the row's answer. Rendered inert to assistive tech: the
   * row already carries the label, role and state, and a second focusable node
   * inside it would be announced twice.
   */
  trailing?: ReactNode;
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
  toggled,
  trailing,
  disabled = false,
  testID,
}: ListRowProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const titleColor = destructive ? palette.danger : palette.textPrimary;
  const iconColor = destructive ? palette.danger : palette.textSecondary;
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
      // Three different rows, three different roles. A chooser row is a RADIO
      // ("this one of several"), a settings row with a switch is a SWITCH
      // ("on or off"), and anything else that navigates is a button. Getting
      // this wrong sends a screen-reader user hunting for options that don't
      // exist, or reading a toggle as a link.
      accessibilityRole={
        toggled !== undefined
          ? 'switch'
          : selected !== undefined
            ? 'radio'
            : onPress
              ? 'button'
              : undefined
      }
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : { selected }),
        ...(toggled === undefined ? {} : { checked: toggled }),
      }}
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
      {trailing !== undefined ? (
        // Inert to assistive tech: the row above already carries the label,
        // the switch role and the on/off state, so a focusable control inside
        // it would announce the same thing a second time.
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {trailing}
        </View>
      ) : selected === undefined ? (
        pressable ? (
          <ChevronRight size={sizes.icon} color={palette.textSecondary} />
        ) : null
      ) : selected ? (
        <Check size={sizes.icon} color={palette.textPrimary} />
      ) : (
        // A same-size spacer, so the titles of chosen and unchosen rows line
        // up instead of shifting by an icon width down the list.
        <View style={styles.checkSpacer} />
      )}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
      backgroundColor: c.surfaceSubtle,
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
      color: c.textSecondary,
    },
    value: {
      ...typography.caption,
      color: c.textSecondary,
    },
    checkSpacer: {
      width: sizes.icon,
      height: sizes.icon,
    },
  });

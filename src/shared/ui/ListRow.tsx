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
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
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
  // `?? 1` because fontScale is absent in some environments (jest's mock) —
  // the house guard, same as WizardScreen's. An unknown scale must not cost
  // every row its side-by-side layout.
  const { fontScale } = useWindowDimensions();
  const stacked = (fontScale ?? 1) > listRowStackFontScale;
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
      // ⚠️ `disabled`, NOT `!pressable`. React Native's Pressable FOLDS this
      // prop into accessibilityState — "_accessibilityState = disabled != null
      // ? {..._accessibilityState, disabled}" — which overrides the explicit
      // `disabled: false` set below. So a row with no onPress (an informational
      // row: a fact, not a control) was announced as DIMMED by every screen
      // reader while rendering at full opacity, because rowDisabled is gated on
      // the disabled PROP. A row with nothing to press is not a broken control,
      // and it should not sound like one.
      disabled={disabled}
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
        {/* ⚠️ STACKED ABOVE listRowStackFontScale — and `flexShrink` alone was
            NOT enough, which the comment this replaces claimed it was. Yoga
            reads textBlock's `flex: 1` as basis 0, so the value takes its
            intrinsic width FIRST and the title grows into whatever is left;
            shrink only happens on overflow and is weighted by basis, which is
            zero here. At 200% text that rendered "Not allowed" in full beside
            "Notific…". Nothing announced changes — accessibilityLabel above
            already joins title, value and subtitle into one string. */}
        {value && stacked ? <Text style={styles.valueStacked}>{value}</Text> : null}
      </View>
      {value && !stacked ? (
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
    // ⚠️ flexShrink, or the VALUE crushes the TITLE. textBlock is `flex: 1`
    // and Text defaults to flexShrink 0, so without this the value took
    // whatever width it wanted and the title — pinned to numberOfLines={1} —
    // absorbed all of it. At 200% text a permission row rendered "Not allowed"
    // in full beside a setting called "Notific…", which is the wrong half to
    // lose: the status is meaningless without the name it belongs to.
    // flexShrink stops the value pushing the row past its own edge. It does
    // NOT protect the title — textBlock's `flex: 1` means basis 0, so it has
    // no shrink weight and the value never yields to it. That is what the
    // stacking is for; this is only the overflow guard, and an earlier comment
    // here wrongly claimed it was the whole fix.
    value: {
      ...typography.caption,
      color: c.textSecondary,
      flexShrink: 1,
    },
    // Under the title rather than beside it, above the threshold. No
    // numberOfLines: at that text size the value is the thing that stopped
    // fitting, so capping it would recreate the problem one line down.
    valueStacked: {
      ...typography.caption,
      color: c.textSecondary,
    },
    checkSpacer: {
      width: sizes.icon,
      height: sizes.icon,
    },
  });
